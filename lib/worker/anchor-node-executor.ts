import type { CompiledNode } from "@/lib/graph/compiler";
import type { NodeExecutionResult } from "@/lib/graph/runner";
import { probeHttpTarget } from "@/lib/operations/probe-core";

/**
 * The worker's anchor executor: observations by instruments that cannot be
 * persuaded.
 *
 * An ANCHOR node's whole purpose is evidence — "record the results rather
 * than describing them". The full-lifecycle v2 anchors consume only the
 * durable graph-to-Phase-1C projection returned with this graph's claim:
 *
 *   * IMPLEMENT and REVIEW observe the exact Phase 1C run, produced commit,
 *     draft pull request, and latest deterministic validation round. They do
 *     not ask a model to claim that code or review exists.
 *   * A TEST anchor (`qa`) does not re-run a thirty-minute suite inside an
 *     eight-minute node envelope and does not ask a model whether the tests
 *     pass. It reads the CI verdict for an explicit produced-change SHA — the
 *     check runs GitHub recorded — and the evidence is that observation: sha,
 *     conclusions, URL. The graph worker's own checkout is not change
 *     lineage and must never satisfy this anchor.
 *   * A MONITOR anchor (`synthesis`) probes the exact deployment URL stored on
 *     that same bridge and records what came back: status, latency, time. An
 *     ambient URL is never accepted as this graph's deployment identity.
 *   * A DEPLOY anchor (`implementation`) does not deploy. Vercel's reviewed
 *     Git integration already performs that externally visible action when a
 *     commit reaches main. The anchor verifies GitHub's Vercel-bot Production
 *     deployment for an explicit merge-commit SHA reached `success`, then
 *     records that immutable identity. A HUMAN gate still decides whether the
 *     lifecycle may treat that observed release as accepted.
 *
 * Every branch returns quickly, which is what lets these nodes keep the tight
 * default envelope — the graph budget estimator applies the slowest node to
 * every level, so a slow anchor would inflate every budget in the catalogue.
 */

export type Phase1cValidationEvidence = Readonly<{
  agent_run_id: string;
  head_sha: string;
  validation_round: number | null;
  validations: readonly Readonly<{
    name: string;
    status: "passed" | "failed" | "skipped";
    duration_ms: number;
  }>[];
}>;

export type AnchorExecutorOptions = Readonly<{
  /** Durable graph-template identity, never an ambient worker setting. */
  templateKey: string | null;
  templateVersion: number | null;
  /** Repository/base identity captured when this graph was launched. */
  repositoryFullName: string | null;
  baseBranch: string | null;
  baseSha: string | null;
  /** Monotonic state of this graph's graph_phase1c_bridges row. */
  phase1cState: string | null;
  /**
   * Exact commit produced by the implementation path and persisted as change
   * lineage. This must never be populated from the graph worker's checkout.
   */
  producedChangeSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  validationEvidence: Phase1cValidationEvidence | null;
  /**
   * Exact merge commit persisted after the produced change was accepted.
   * Deployment evidence is not attributable without this separate identity.
   */
  mergeCommitSha: string | null;
  /** Internal deployment row identity and its exact provider URL. */
  deploymentId: string | null;
  deploymentUrl: string | null;
  /** Actions-injected token with checks:read; absent outside CI. */
  gitHubToken: string | null;
  /**
   * The checks that ARE the verdict, when this repository has named them.
   *
   * `SOFTWAREFACTORY_REQUIRED_CHECKS` is the repository's own definition of
   * "CI passed" — the same names branch protection requires and the Phase 1C
   * worker waits for. Reading every check instead would let an unrelated
   * integration check (a preview environment that has been red for weeks on
   * every commit) veto a commit the repository itself considers verified.
   * Empty or absent is Not Connected: without the repository's exact policy,
   * a partial check-run listing could be mistaken for the complete verdict.
   */
  requiredCheckNames?: readonly string[] | null;
  /** Bounded wait for the exact-head required checks to reach a verdict. */
  ciMaxAttempts?: number;
  ciPollMs?: number;
  /** Bounded warm-up observation for the exact recorded deployment URL. */
  monitorMaxAttempts?: number;
  monitorPollMs?: number;
  /** Bounded wait for Vercel's GitHub deployment status to become terminal. */
  deploymentMaxAttempts?: number;
  deploymentPollMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}>;

type CheckRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
};

type GitHubDeployment = {
  id?: number;
  sha?: string;
  ref?: string;
  environment?: string;
  task?: string;
  creator?: { login?: string } | null;
};

type GitHubDeploymentStatus = {
  state?: string;
  creator?: { login?: string } | null;
  environment_url?: string | null;
  description?: string | null;
};

type GitHubPullRequest = {
  number?: number;
  html_url?: string;
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  head?: { sha?: string; repo?: { full_name?: string } | null } | null;
  base?: { ref?: string; repo?: { full_name?: string } | null } | null;
};

const OBSERVATION_TIMEOUT_MS = 30_000;
const MONITOR_DEGRADED_LATENCY_MS = 2_000;
const DEFAULT_CI_MAX_ATTEMPTS = 48;
const DEFAULT_CI_POLL_MS = 10_000;
const DEFAULT_MONITOR_MAX_ATTEMPTS = 30;
const DEFAULT_MONITOR_POLL_MS = 10_000;
// Vercel production builds routinely take longer than a few seconds after the
// merge is visible. Attempts and the node's persisted timeout jointly bound
// the observation, while leaving a small margin for durable node completion.
const DEFAULT_DEPLOYMENT_MAX_ATTEMPTS = 30;
const DEFAULT_DEPLOYMENT_POLL_MS = 10_000;
const EXACT_COMMIT_SHA = /^[0-9a-f]{40}$/;
const EXACT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PHASE1C_STATE_RANK = Object.freeze({
  GRAPH_READY: 0,
  COMMAND_RECORDED: 1,
  PHASE1C_BOUND: 2,
  PULL_REQUEST_RECORDED: 3,
  MERGE_RECORDED: 4,
  DEPLOYMENT_RECORDED: 5,
  MONITORING_RECORDED: 6,
  VALIDATED: 7,
} as const);

type Phase1cState = keyof typeof PHASE1C_STATE_RANK;

type ChangeLineage = Readonly<{
  repository: string;
  baseBranch: string;
  baseSha: string;
  headSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  bridgeState: Phase1cState;
}>;

function failed(error: string): NodeExecutionResult {
  return { status: "FAILED", retryable: false, error };
}

function isCheckRun(value: unknown): value is CheckRun {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const check = value as Partial<CheckRun>;
  if (
    !Number.isSafeInteger(check.id)
    || (check.id ?? 0) <= 0
    || typeof check.name !== "string"
    || check.name.length < 1
    || check.name.length > 255
    || typeof check.status !== "string"
    || !(typeof check.conclusion === "string" || check.conclusion === null)
    || typeof check.html_url !== "string"
  ) return false;
  try {
    const url = new URL(check.html_url);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function buildAnchorNodeExecutor(options: AnchorExecutorOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep
    ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));

  const gitHubHeaders = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${options.gitHubToken ?? ""}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  function notConnected(node: CompiledNode, detail: string): NodeExecutionResult {
    return failed(
      `Anchor node ${node.nodeKey}: ${detail} The durable Phase 1C instrument is `
      + "Not Connected, so no evidence was invented.",
    );
  }

  function changeLineage(
    node: CompiledNode,
    minimumState: Phase1cState,
  ): ChangeLineage | NodeExecutionResult {
    if (options.templateKey !== "full_lifecycle" || options.templateVersion !== 2) {
      return notConnected(
        node,
        "the claim is not for the exact full_lifecycle v2 bridge contract.",
      );
    }

    const repository = options.repositoryFullName?.trim() ?? "";
    const baseBranch = options.baseBranch?.trim() ?? "";
    const baseSha = options.baseSha?.trim().toLowerCase() ?? "";
    const headSha = options.producedChangeSha?.trim().toLowerCase() ?? "";
    const bridgeState = options.phase1cState as Phase1cState | null;
    const bridgeRank = bridgeState ? PHASE1C_STATE_RANK[bridgeState] : undefined;
    const pullRequestNumber = options.pullRequestNumber ?? 0;
    const pullRequestUrl = options.pullRequestUrl?.trim() ?? "";

    if (!REPOSITORY_FULL_NAME.test(repository)) {
      return notConnected(node, "no valid graph-scoped repository is recorded.");
    }
    if (!baseBranch || baseBranch.length > 255) {
      return notConnected(node, "no valid graph-scoped base branch is recorded.");
    }
    if (!EXACT_COMMIT_SHA.test(baseSha)) {
      return notConnected(node, "no valid graph-scoped base SHA is recorded.");
    }
    if (bridgeRank === undefined || bridgeRank < PHASE1C_STATE_RANK[minimumState]) {
      return notConnected(
        node,
        `the bridge has not reached ${minimumState} for this graph.`,
      );
    }
    if (!EXACT_COMMIT_SHA.test(headSha)) {
      return notConnected(node, "no valid produced-change SHA is recorded.");
    }
    if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
      return notConnected(node, "no valid pull-request number is recorded.");
    }
    const canonicalPullRequestUrl = `https://github.com/${repository}/pull/${pullRequestNumber}`;
    if (pullRequestUrl.replace(/\/$/, "").toLowerCase() !== canonicalPullRequestUrl.toLowerCase()) {
      return notConnected(node, "the pull-request URL does not match its repository and number.");
    }

    return {
      repository,
      baseBranch,
      baseSha,
      headSha,
      pullRequestNumber,
      pullRequestUrl: pullRequestUrl.replace(/\/$/, ""),
      bridgeState: bridgeState!,
    };
  }

  function validationFor(
    node: CompiledNode,
    lineage: ChangeLineage,
  ): Phase1cValidationEvidence | NodeExecutionResult {
    const evidence = options.validationEvidence;
    if (
      !evidence
      || !EXACT_UUID.test(evidence.agent_run_id)
      || evidence.head_sha.trim().toLowerCase() !== lineage.headSha
      || !Number.isInteger(evidence.validation_round)
      || (evidence.validation_round ?? 0) < 1
      || (evidence.validation_round ?? 0) > 3
      || evidence.validations.length < 1
      || evidence.validations.length > 50
    ) {
      return notConnected(
        node,
        "the latest bounded validation evidence is absent or is not tied to this run and head SHA.",
      );
    }
    const invalid = evidence.validations.some((check) => (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(check.name)
      || !["passed", "failed", "skipped"].includes(check.status)
      || !Number.isInteger(check.duration_ms)
      || check.duration_ms < 0
      || check.duration_ms > 3_600_000
    ));
    const diffCheck = evidence.validations.find((check) => check.name === "diff-check");
    if (invalid || evidence.validations.some((check) => check.status === "failed") || diffCheck?.status !== "passed") {
      return failed(
        `Anchor node ${node.nodeKey}: Phase 1C validation for ${lineage.headSha.slice(0, 8)} `
        + "is incomplete or failed; review cannot be recorded.",
      );
    }
    return evidence;
  }

  function isNodeFailure(
    value: ChangeLineage | Phase1cValidationEvidence | NodeExecutionResult,
  ): value is NodeExecutionResult {
    return "status" in value;
  }

  async function observeImplementation(node: CompiledNode): Promise<NodeExecutionResult> {
    const startedAt = Date.now();
    const lineage = changeLineage(node, "PULL_REQUEST_RECORDED");
    if (isNodeFailure(lineage)) return lineage;
    return {
      status: "SUCCEEDED",
      output: {
        observation: "phase1c_change_lineage",
        repository: lineage.repository,
        baseBranch: lineage.baseBranch,
        baseSha: lineage.baseSha,
        headSha: lineage.headSha,
        pullRequestNumber: lineage.pullRequestNumber,
        pullRequestUrl: lineage.pullRequestUrl,
        bridgeState: lineage.bridgeState,
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      },
      latencyMs: Date.now() - startedAt,
      tokensUsed: 0,
    };
  }

  async function observeReview(node: CompiledNode): Promise<NodeExecutionResult> {
    const startedAt = Date.now();
    const lineage = changeLineage(node, "PULL_REQUEST_RECORDED");
    if (isNodeFailure(lineage)) return lineage;
    const validation = validationFor(node, lineage);
    if (isNodeFailure(validation)) return validation;
    if (!options.gitHubToken) {
      return notConnected(node, "the read-scoped GitHub token is absent.");
    }

    let response: Response;
    try {
      response = await fetchImpl(
        `https://api.github.com/repos/${lineage.repository}/pulls/${lineage.pullRequestNumber}`,
        {
          headers: gitHubHeaders,
          signal: AbortSignal.timeout(OBSERVATION_TIMEOUT_MS),
        },
      );
    } catch (error) {
      return failed(
        `Anchor node ${node.nodeKey}: the pull-request observation failed `
        + `(${error instanceof Error ? error.message : "unreachable"}); no review was invented.`,
      );
    }
    if (!response.ok) {
      return failed(
        `Anchor node ${node.nodeKey}: the pull-request observation answered HTTP ${response.status}; `
        + "no review was invented.",
      );
    }
    let pullRequest: GitHubPullRequest;
    try {
      const body = await response.json() as unknown;
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("unexpected response shape");
      pullRequest = body as GitHubPullRequest;
    } catch (error) {
      return failed(
        `Anchor node ${node.nodeKey}: GitHub returned unusable pull-request evidence `
        + `(${error instanceof Error ? error.message : "invalid JSON"}); no review was invented.`,
      );
    }
    const headSha = pullRequest.head?.sha?.trim().toLowerCase() ?? "";
    const baseBranch = pullRequest.base?.ref?.trim() ?? "";
    const headRepository = pullRequest.head?.repo?.full_name?.trim() ?? "";
    const baseRepository = pullRequest.base?.repo?.full_name?.trim() ?? "";
    const pullRequestUrl = pullRequest.html_url?.replace(/\/$/, "") ?? "";
    if (
      pullRequest.number !== lineage.pullRequestNumber
      || pullRequestUrl.toLowerCase() !== lineage.pullRequestUrl.toLowerCase()
      || headSha !== lineage.headSha
      || baseBranch !== lineage.baseBranch
      || headRepository.toLowerCase() !== lineage.repository.toLowerCase()
      || baseRepository.toLowerCase() !== lineage.repository.toLowerCase()
      || pullRequest.state !== "open"
      || pullRequest.merged_at !== null
      || typeof pullRequest.draft !== "boolean"
    ) {
      return failed(
        `Anchor node ${node.nodeKey}: GitHub's pull request does not match the durable Phase 1C `
        + `run/head/base identity for ${lineage.headSha.slice(0, 8)}; review stops closed.`,
      );
    }

    const latencyMs = Date.now() - startedAt;
    return {
      status: "SUCCEEDED",
      output: {
        observation: "phase1c_pull_request_review",
        repository: lineage.repository,
        agentRunId: validation.agent_run_id,
        headSha: lineage.headSha,
        baseBranch: lineage.baseBranch,
        pullRequestNumber: lineage.pullRequestNumber,
        pullRequestUrl: lineage.pullRequestUrl,
        state: "open",
        draft: pullRequest.draft,
        validationRound: validation.validation_round,
        validations: validation.validations.map((check) => ({
          name: check.name,
          status: check.status,
          durationMs: check.duration_ms,
        })),
        observedAt: new Date().toISOString(),
        latencyMs,
      },
      latencyMs,
      tokensUsed: 0,
    };
  }

  async function observeCi(node: CompiledNode): Promise<NodeExecutionResult> {
    const lineage = changeLineage(node, "PULL_REQUEST_RECORDED");
    if (isNodeFailure(lineage)) return lineage;
    if (!options.gitHubToken) return notConnected(node, "the read-scoped GitHub token is absent.");
    const required = (options.requiredCheckNames ?? []).filter((name) => name.trim().length > 0);
    if (required.length === 0) {
      return notConnected(node, "the repository's exact required-check policy is absent.");
    }
    const producedChangeSha = lineage.headSha;
    const startedAt = Date.now();
    const attemptLimit = Math.max(1, options.ciMaxAttempts ?? DEFAULT_CI_MAX_ATTEMPTS);
    const pollMs = Math.max(0, options.ciPollMs ?? DEFAULT_CI_POLL_MS);
    const deadlineAt = startedAt + Math.max(1_000, node.timeoutMs - 5_000);
    let attemptsMade = 0;
    let lastDetail = "The required checks have not reported a verdict yet.";

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        lastDetail = "The bounded CI-observation window elapsed before every required check reported.";
        break;
      }
      attemptsMade = attempt;

      let response: Response;
      try {
        response = await fetchImpl(
          `https://api.github.com/repos/${lineage.repository}/commits/${producedChangeSha}/check-runs?per_page=100`,
          {
            headers: gitHubHeaders,
            signal: AbortSignal.timeout(Math.max(1, Math.min(OBSERVATION_TIMEOUT_MS, remainingMs))),
          },
        );
      } catch (error) {
        lastDetail = "the CI observation failed "
          + `(${error instanceof Error ? error.message : "unreachable"}); no verdict was invented.`;
        if (attempt < attemptLimit && pollMs > 0) {
          await sleep(Math.min(pollMs, Math.max(0, deadlineAt - Date.now())));
        }
        continue;
      }

      if (!response.ok) {
        const detail = `the CI observation failed with HTTP ${response.status}; no verdict was invented in its place.`;
        // Authorization and identity failures do not become truer by polling.
        if (response.status >= 400 && response.status < 500) {
          return failed(`Anchor node ${node.nodeKey}: ${detail}`);
        }
        lastDetail = detail;
      } else {
        let allRuns: CheckRun[] | null = null;
        try {
          const body = await response.json() as { check_runs?: unknown };
          if (!Array.isArray(body?.check_runs)) throw new Error("check_runs is not an array");
          if (!body.check_runs.every(isCheckRun)) throw new Error("check_runs contains unusable evidence");
          allRuns = body.check_runs;
        } catch (error) {
          lastDetail = "GitHub returned unusable CI evidence "
            + `(${error instanceof Error ? error.message : "invalid JSON"}); no verdict was invented.`;
        }

        if (allRuns !== null) {
          // The verdict is the required checks, each read at its latest
          // attempt. A re-run leaves the earlier row in the listing, but its
          // earlier answer is no longer the repository's verdict.
          const latestByName = new Map<string, CheckRun>();
          for (const run of allRuns) {
            if (!required.includes(run.name)) continue;
            const known = latestByName.get(run.name);
            if (!known || run.id >= known.id) latestByName.set(run.name, run);
          }
          const unreported = required.filter((name) => {
            const run = latestByName.get(name);
            return !run || run.status !== "completed";
          });
          if (unreported.length > 0) {
            lastDetail = `required check(s) not yet reported for ${producedChangeSha.slice(0, 8)}: `
              + `${unreported.join(", ")}. There is no verdict to record yet.`;
          } else {
            const checkRuns = required.map((name) => latestByName.get(name)!);
            const failing = checkRuns.filter((run) => run.conclusion !== "success");
            const evidence = {
              observation: "ci_check_runs",
              sha: producedChangeSha,
              repository: lineage.repository,
              total: checkRuns.length,
              checks: checkRuns.map((run) => ({
                name: run.name,
                conclusion: "success" as const,
                url: run.html_url,
              })),
              failing: failing.map((run) => ({ name: run.name, conclusion: run.conclusion, url: run.html_url })),
              observedAt: new Date().toISOString(),
              latencyMs: Date.now() - startedAt,
            };
            if (failing.length > 0) {
              return failed(
                `Anchor node ${node.nodeKey}: CI records ${failing.length} non-success check run(s) `
                + `for ${producedChangeSha.slice(0, 8)}: ${failing.map((run) => run.name).join(", ")}. `
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
        }
      }

      if (attempt < attemptLimit && pollMs > 0) {
        await sleep(Math.min(pollMs, Math.max(0, deadlineAt - Date.now())));
      }
    }

    return {
      status: "FAILED",
      retryable: true,
      error: `Anchor node ${node.nodeKey}: ${lastDetail} `
        + `No verdict was invented after ${attemptsMade} observation attempt(s).`,
    };
  }

  async function observeProduction(node: CompiledNode): Promise<NodeExecutionResult> {
    const lineage = changeLineage(node, "DEPLOYMENT_RECORDED");
    if (isNodeFailure(lineage)) return lineage;
    const deploymentId = options.deploymentId?.trim().toLowerCase() ?? "";
    const deploymentUrl = options.deploymentUrl?.trim().replace(/\/$/, "") ?? "";
    if (!EXACT_UUID.test(deploymentId) || !/^https:\/\/[^\s]{1,2039}$/.test(deploymentUrl)) {
      return notConnected(
        node,
        "the exact bridge deployment identity and URL are absent or invalid.",
      );
    }
    const startedAt = Date.now();
    const attemptLimit = Math.max(1, options.monitorMaxAttempts ?? DEFAULT_MONITOR_MAX_ATTEMPTS);
    const pollMs = Math.max(0, options.monitorPollMs ?? DEFAULT_MONITOR_POLL_MS);
    const deadlineAt = startedAt + Math.max(1_000, node.timeoutMs - 5_000);
    let attemptsMade = 0;
    let lastDetail = `the production probe of ${deploymentUrl} has not returned a healthy response.`;

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        lastDetail = "the bounded production-health observation window elapsed.";
        break;
      }
      attemptsMade = attempt;
      const probe = await probeHttpTarget(
        {
          targetUrl: deploymentUrl,
          expectedStatusCode: 200,
          degradedLatencyMs: MONITOR_DEGRADED_LATENCY_MS,
          timeoutMs: Math.max(1, Math.min(OBSERVATION_TIMEOUT_MS, remainingMs)),
        },
        (input, init) => fetchImpl(input, init),
      );
      const evidence = {
        observation: "production_http_probe",
        deploymentId,
        url: deploymentUrl,
        status: probe.statusCode,
        healthy: probe.outcome === "pass",
        observedAt: new Date().toISOString(),
        latencyMs: probe.latencyMs,
        postDeployValidation: "inconclusive" as const,
        observationWindowComplete: false,
        missingValidationStages: ["data_integration", "quality_security", "observation"] as const,
      };
      if (probe.outcome === "pass" && probe.statusCode !== null && probe.latencyMs !== null) {
        return {
          status: "SUCCEEDED",
          output: evidence,
          latencyMs: probe.latencyMs,
          tokensUsed: 0,
        };
      }
      lastDetail = probe.failureReason
        ? `${probe.failureReason} Evidence: ${JSON.stringify(evidence)}`
        : `production probe outcome was ${probe.outcome}. Evidence: ${JSON.stringify(evidence)}`;
      if (probe.outcome === "unknown" || probe.outcome === "degraded") {
        return failed(`Anchor node ${node.nodeKey}: ${lastDetail}`);
      }
      // A missing or forbidden route is a stable contract mismatch. Startup
      // errors, rate limits, and network failures may clear inside the
      // bounded warm-up window and are observed again.
      if (probe.statusCode !== null
        && probe.statusCode >= 300
        && probe.statusCode < 500
        && probe.statusCode !== 408
        && probe.statusCode !== 429) {
        return failed(`Anchor node ${node.nodeKey}: ${lastDetail}`);
      }
      if (attempt < attemptLimit && pollMs > 0) {
        await sleep(Math.min(pollMs, Math.max(0, deadlineAt - Date.now())));
      }
    }

    return {
      status: "FAILED",
      retryable: true,
      error: `Anchor node ${node.nodeKey}: ${lastDetail} `
        + `No healthy result was invented after ${attemptsMade} observation attempt(s).`,
    };
  }

  async function observeDeployment(node: CompiledNode): Promise<NodeExecutionResult> {
    const lineage = changeLineage(node, "MERGE_RECORDED");
    if (isNodeFailure(lineage)) return lineage;
    const mergeCommitSha = options.mergeCommitSha?.trim().toLowerCase() ?? null;
    const baseBranch = lineage.baseBranch;
    if (
      !options.gitHubToken
      || !mergeCommitSha
      || !EXACT_COMMIT_SHA.test(mergeCommitSha)
    ) {
      const detail = !options.gitHubToken
        ? "the read-scoped GitHub token is absent."
        : "no valid merge-commit SHA is recorded.";
      return notConnected(node, detail);
    }

    const recordedDeploymentId = options.deploymentId?.trim().toLowerCase() ?? null;
    const recordedDeploymentUrl = options.deploymentUrl?.trim().replace(/\/$/, "") ?? null;
    if ((recordedDeploymentId === null) !== (recordedDeploymentUrl === null)) {
      return notConnected(node, "the bridge contains only part of a deployment identity.");
    }
    if (
      recordedDeploymentId !== null
      && (!EXACT_UUID.test(recordedDeploymentId) || !/^https:\/\/[^\s]{1,2039}$/.test(recordedDeploymentUrl ?? ""))
    ) {
      return notConnected(node, "the bridge deployment identity is malformed.");
    }
    if (
      (PHASE1C_STATE_RANK[lineage.bridgeState] >= PHASE1C_STATE_RANK.DEPLOYMENT_RECORDED)
      && (recordedDeploymentId === null || recordedDeploymentUrl === null)
    ) {
      return notConnected(node, "the bridge state claims a deployment but its identity is absent.");
    }

    const wantedSha = mergeCommitSha;
    const attemptLimit = Math.max(1, options.deploymentMaxAttempts ?? DEFAULT_DEPLOYMENT_MAX_ATTEMPTS);
    const pollMs = Math.max(0, options.deploymentPollMs ?? DEFAULT_DEPLOYMENT_POLL_MS);
    const startedAt = Date.now();
    const deadlineAt = startedAt + Math.max(1_000, node.timeoutMs - 5_000);
    let lastDetail = "No exact-SHA Vercel Production deployment appeared.";
    let attemptsMade = 0;

    const requestSignal = (): AbortSignal | null => {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) return null;
      return AbortSignal.timeout(Math.max(1, Math.min(OBSERVATION_TIMEOUT_MS, remainingMs)));
    };
    const pauseBeforeRetry = async (attempt: number) => {
      if (attempt >= attemptLimit || pollMs <= 0) return;
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) return;
      await sleep(Math.min(pollMs, remainingMs));
    };

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      const deploymentsSignal = requestSignal();
      if (deploymentsSignal === null) {
        lastDetail = "The bounded deployment-observation window elapsed.";
        break;
      }
      attemptsMade = attempt;
      let deploymentsResponse: Response;
      try {
        deploymentsResponse = await fetchImpl(
          `https://api.github.com/repos/${lineage.repository}/deployments?environment=Production&per_page=100`,
          {
            headers: gitHubHeaders,
            signal: deploymentsSignal,
          },
        );
      } catch (error) {
        lastDetail = `GitHub's deployment observation failed (${error instanceof Error ? error.message : "unreachable"}).`;
        await pauseBeforeRetry(attempt);
        continue;
      }
      if (!deploymentsResponse.ok) {
        lastDetail = `GitHub's deployment observation answered HTTP ${deploymentsResponse.status}.`;
        if (deploymentsResponse.status >= 400 && deploymentsResponse.status < 500) {
          return failed(`Anchor node ${node.nodeKey}: ${lastDetail} No deployment success was invented.`);
        }
      } else {
        let deploymentsBody: unknown;
        try {
          deploymentsBody = await deploymentsResponse.json() as unknown;
        } catch (error) {
          lastDetail = `GitHub returned unusable deployment evidence (${error instanceof Error ? error.message : "invalid JSON"}).`;
          await pauseBeforeRetry(attempt);
          continue;
        }
        const deployments = Array.isArray(deploymentsBody)
          ? deploymentsBody as GitHubDeployment[]
          : [];
        const deployment = deployments.find((candidate) => (
          candidate.environment === "Production"
          && candidate.task === "deploy"
          && candidate.creator?.login === "vercel[bot]"
          && candidate.sha?.toLowerCase() === wantedSha
          && candidate.ref === baseBranch
          && Number.isSafeInteger(candidate.id)
          && (candidate.id ?? 0) > 0
        ));

        if (!deployment?.id) {
          lastDetail = `No Vercel-bot Production deployment matches exact SHA ${mergeCommitSha.slice(0, 8)} on ${baseBranch}.`;
        } else {
          // Construct this GitHub URL ourselves. Following a response-provided
          // URL while attaching the workflow token would turn malformed
          // provider data into a credential-forwarding primitive.
          const statusesSignal = requestSignal();
          if (statusesSignal === null) {
            lastDetail = "The bounded deployment-observation window elapsed before status verification.";
            break;
          }
          let statusesResponse: Response;
          try {
            statusesResponse = await fetchImpl(
              `https://api.github.com/repos/${lineage.repository}/deployments/${deployment.id}/statuses?per_page=1`,
              {
                headers: gitHubHeaders,
                signal: statusesSignal,
              },
            );
          } catch (error) {
            lastDetail = `GitHub's deployment-status observation failed (${error instanceof Error ? error.message : "unreachable"}).`;
            await pauseBeforeRetry(attempt);
            continue;
          }
          if (!statusesResponse.ok) {
            lastDetail = `GitHub's deployment-status observation answered HTTP ${statusesResponse.status}.`;
            if (statusesResponse.status >= 400 && statusesResponse.status < 500) {
              return failed(`Anchor node ${node.nodeKey}: ${lastDetail} No deployment success was invented.`);
            }
          } else {
            let statusesBody: unknown;
            try {
              statusesBody = await statusesResponse.json() as unknown;
            } catch (error) {
              lastDetail = `GitHub returned unusable deployment-status evidence (${error instanceof Error ? error.message : "invalid JSON"}).`;
              await pauseBeforeRetry(attempt);
              continue;
            }
            const status = Array.isArray(statusesBody)
              ? statusesBody[0] as GitHubDeploymentStatus | undefined
              : undefined;
            const state = status?.state ?? "missing";
            const environmentUrl = status?.environment_url ?? null;
            const evidence = {
              // Avoid the provider-token prefix `vercel_`: artifact storage
              // correctly rejects secret-shaped strings, and an observation
              // label must not resemble a credential.
              observation: "github_production_deployment",
              repository: lineage.repository,
              sha: mergeCommitSha,
              ref: deployment.ref,
              deploymentId: deployment.id ?? null,
              environment: deployment.environment,
              state,
              environmentUrl,
              bridgeDeploymentId: recordedDeploymentId,
              observedAt: new Date().toISOString(),
              latencyMs: Date.now() - startedAt,
            };

            if (
              state === "success"
              && status?.creator?.login === "vercel[bot]"
              && typeof environmentUrl === "string"
              && environmentUrl.startsWith("https://")
              && (
                recordedDeploymentUrl === null
                || environmentUrl.replace(/\/$/, "").toLowerCase() === recordedDeploymentUrl.toLowerCase()
              )
            ) {
              return {
                status: "SUCCEEDED",
                output: evidence,
                latencyMs: evidence.latencyMs,
                tokensUsed: 0,
              };
            }
            if (
              state === "success"
              && recordedDeploymentUrl !== null
              && (
                typeof environmentUrl !== "string"
                || environmentUrl.replace(/\/$/, "").toLowerCase() !== recordedDeploymentUrl.toLowerCase()
              )
            ) {
              return failed(
                `Anchor node ${node.nodeKey}: GitHub's exact-SHA deployment URL does not match `
                + "the durable bridge deployment URL; release observation stops closed.",
              );
            }
            if (["error", "failure", "inactive"].includes(state)) {
              return failed(
                `Anchor node ${node.nodeKey}: the exact-SHA Vercel Production deployment ended `
                + `${state}. Evidence: ${JSON.stringify(evidence)}`,
              );
            }
            lastDetail = `The exact-SHA Vercel Production deployment is ${state}; it is not ready yet.`;
          }
        }
      }

      await pauseBeforeRetry(attempt);
    }

    return {
      status: "FAILED",
      retryable: true,
      error: `Anchor node ${node.nodeKey}: ${lastDetail} No deployment success was invented after `
        + `${attemptsMade} observation attempt(s).`,
    };
  }

  return async function executeAnchorNode(node: CompiledNode): Promise<NodeExecutionResult> {
    // Full Lifecycle v2 is keyed deliberately. IMPLEMENT and DEPLOYMENT both
    // use the implementation capability, but they observe different facts;
    // capability-only dispatch would silently turn one into the other.
    if (node.nodeKey === "implement") return observeImplementation(node);
    if (node.nodeKey === "review") return observeReview(node);
    switch (node.capability) {
      case "qa":
        return observeCi(node);
      case "synthesis":
        return observeProduction(node);
      case "implementation":
        return observeDeployment(node);
      default:
        return failed(
          `Anchor node ${node.nodeKey} has no observation instrument for capability ${node.capability}.`,
        );
    }
  };
}
