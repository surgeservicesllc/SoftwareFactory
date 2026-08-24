import type { CompiledNode } from "@/lib/graph/compiler";
import type { NodeExecutionResult } from "@/lib/graph/runner";

/**
 * The worker's anchor executor: observations by instruments that cannot be
 * persuaded.
 *
 * An ANCHOR node's whole purpose is evidence — "record the results rather
 * than describing them". This executor performs the three anchor jobs the
 * lifecycle templates declare, each the honest Phase-1 way:
 *
 *   * A TEST anchor (`qa`) does not re-run a thirty-minute suite inside an
 *     eight-minute node envelope and does not ask a model whether the tests
 *     pass. It reads the CI verdict for the exact commit this worker is
 *     running — the check runs GitHub recorded — and the evidence is that
 *     observation: sha, conclusions, URL. CI is the instrument; this node is
 *     the reading.
 *   * A MONITOR anchor (`synthesis`) probes the production URL and records
 *     what came back: status, latency, time. No URL configured means the
 *     instrument is Not Connected, and the node says so instead of inventing
 *     a healthy reading.
 *   * A DEPLOY anchor (`implementation`) is refused, permanently and by
 *     policy: Phase 1 keeps deployment owner-approved and wires this worker
 *     no deployment instrument. The refusal names the policy so the run's
 *     record shows a rule holding, not a fault.
 *
 * Every branch returns quickly, which is what lets these nodes keep the tight
 * default envelope — the graph budget estimator applies the slowest node to
 * every level, so a slow anchor would inflate every budget in the catalogue.
 */

export type AnchorExecutorOptions = Readonly<{
  repositoryFullName: string;
  /** The commit this worker checked out; the TEST anchor observes its CI. */
  headSha: string | null;
  /** Actions-injected token with checks:read; absent outside CI. */
  gitHubToken: string | null;
  /** The deployed product to probe; absent means Not Connected. */
  productionUrl: string | null;
  /**
   * The checks that ARE the verdict, when this repository has named them.
   *
   * `SOFTWAREFACTORY_REQUIRED_CHECKS` is the repository's own definition of
   * "CI passed" — the same names branch protection requires and the Phase 1C
   * worker waits for. Reading every check instead would let an unrelated
   * integration check (a preview environment that has been red for weeks on
   * every commit) veto a commit the repository itself considers verified.
   * Empty or absent means no such definition exists here, and every completed
   * non-skipped check counts.
   */
  requiredCheckNames?: readonly string[] | null;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}>;

type CheckRun = {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
};

const OBSERVATION_TIMEOUT_MS = 30_000;

function failed(error: string): NodeExecutionResult {
  return { status: "FAILED", retryable: false, error };
}

export function buildAnchorNodeExecutor(options: AnchorExecutorOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function observeCi(node: CompiledNode): Promise<NodeExecutionResult> {
    if (!options.gitHubToken || !options.headSha) {
      return failed(
        `Anchor node ${node.nodeKey} observes CI check runs, and this worker has `
        + `no ${options.gitHubToken ? "commit to observe" : "GitHub token"} — the `
        + "instrument is Not Connected, so there is no reading to record.",
      );
    }
    const startedAt = Date.now();
    const response = await fetchImpl(
      `https://api.github.com/repos/${options.repositoryFullName}/commits/${options.headSha}/check-runs?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${options.gitHubToken}`,
        },
        signal: AbortSignal.timeout(OBSERVATION_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return failed(
        `Anchor node ${node.nodeKey}: the CI observation failed with HTTP ${response.status}; `
        + "no verdict was invented in its place.",
      );
    }
    const body = (await response.json()) as { check_runs?: CheckRun[] };
    const allRuns = body.check_runs ?? [];
    const required = (options.requiredCheckNames ?? []).filter((name) => name.length > 0);

    let checkRuns: CheckRun[];
    if (required.length > 0) {
      // The verdict is the required checks, each read at its latest attempt —
      // a re-run leaves the earlier check run in the listing, and the earlier
      // answer is not the answer any more.
      const latestByName = new Map<string, CheckRun>();
      for (const run of allRuns) {
        if (!required.includes(run.name)) continue;
        const known = latestByName.get(run.name);
        if (!known || (run.id ?? 0) >= (known.id ?? 0)) latestByName.set(run.name, run);
      }
      const unreported = required.filter((name) => {
        const run = latestByName.get(name);
        return !run || run.status !== "completed";
      });
      if (unreported.length > 0) {
        return failed(
          `Anchor node ${node.nodeKey}: required check(s) not yet reported for `
          + `${options.headSha.slice(0, 8)}: ${unreported.join(", ")}. `
          + "There is no verdict to record yet.",
        );
      }
      checkRuns = required.map((name) => latestByName.get(name)!);
    } else {
      checkRuns = allRuns.filter(
        // Skipped checks (a migration workflow that did not apply) are not
        // verdicts about this commit's correctness either way.
        (run) => run.status === "completed" && run.conclusion !== "skipped",
      );
      if (checkRuns.length === 0) {
        return failed(
          `Anchor node ${node.nodeKey}: no completed CI check runs exist for `
          + `${options.headSha.slice(0, 8)}; there is no verdict to record yet.`,
        );
      }
    }
    const failing = checkRuns.filter((run) => run.conclusion !== "success");
    const evidence = {
      observation: "ci_check_runs",
      sha: options.headSha,
      repository: options.repositoryFullName,
      total: checkRuns.length,
      failing: failing.map((run) => ({ name: run.name, conclusion: run.conclusion, url: run.html_url })),
      observedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    if (failing.length > 0) {
      return failed(
        `Anchor node ${node.nodeKey}: CI records ${failing.length} non-success check run(s) `
        + `for ${options.headSha.slice(0, 8)}: ${failing.map((run) => run.name).join(", ")}. `
        + `Evidence: ${JSON.stringify(evidence)}`,
      );
    }
    return {
      status: "SUCCEEDED",
      output: evidence,
      latencyMs: evidence.latencyMs,
      tokensUsed: 0,
    };
  }

  async function observeProduction(node: CompiledNode): Promise<NodeExecutionResult> {
    if (!options.productionUrl) {
      return failed(
        `Anchor node ${node.nodeKey} observes the running system, and no production URL `
        + "is configured for this worker — the monitoring instrument is Not Connected.",
      );
    }
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(options.productionUrl, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(OBSERVATION_TIMEOUT_MS),
      });
    } catch (error) {
      return failed(
        `Anchor node ${node.nodeKey}: the production probe of ${options.productionUrl} failed `
        + `(${error instanceof Error ? error.message : "unreachable"}). That is the observation.`,
      );
    }
    const evidence = {
      observation: "production_http_probe",
      url: options.productionUrl,
      status: response.status,
      healthy: response.ok,
      observedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    if (!response.ok) {
      return failed(
        `Anchor node ${node.nodeKey}: production answered HTTP ${response.status}. `
        + `Evidence: ${JSON.stringify(evidence)}`,
      );
    }
    return {
      status: "SUCCEEDED",
      output: evidence,
      latencyMs: evidence.latencyMs,
      tokensUsed: 0,
    };
  }

  return async function executeAnchorNode(node: CompiledNode): Promise<NodeExecutionResult> {
    switch (node.capability) {
      case "qa":
        return observeCi(node);
      case "synthesis":
        return observeProduction(node);
      default:
        // The deploy-shaped anchor, and anything new until it earns a branch.
        return failed(
          `Anchor node ${node.nodeKey} (${node.capability}) would act outside this worker's `
          + "authority: deployment execution is owner-approved in Phase 1 and no deployment "
          + "instrument is wired. This refusal is the policy holding, not a fault.",
        );
    }
  };
}
