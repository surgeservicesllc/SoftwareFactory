import type { NodeExecutionResult } from "@/lib/graph/runner";
import type { CompiledNode } from "@/lib/graph/compiler";
import {
  compileClaimedGraph,
  parseClaimedGraph,
  runClaimedGraph,
  type GraphRunStore,
} from "@/lib/worker/graph-run";

/**
 * The development seed's drive loop, as a module both the script and a test
 * can call.
 *
 * It lives apart from `seed-dev-lifecycle.mts` for one reason: a seed whose
 * walk is only ever exercised by running it against a live stack is a seed
 * nobody checks. Here the same loop — the real one, not a parallel
 * reimplementation — runs against real PostgreSQL in
 * `tests/integration/dev-seed-drive.behavior.test.ts`, so "the seed completes
 * the ten steps" is a claim with a test behind it rather than an intention.
 *
 * Everything the loop needs from the outside is a parameter: the store, the
 * gate reads and decisions, and where to log. The script wires supabase-js
 * into them; the test wires PGlite. Neither substitutes for the loop itself.
 */

export type SeedGate = Readonly<{
  id: string;
  kind: string;
  node_id: string;
  stage: string;
}>;

export type SeedDriveDeps = Readonly<{
  /** The worker's own store, plus the claim the drain performs. */
  store: GraphRunStore & { claimPlannedGraph: () => Promise<unknown | null> };
  /** The graph the seed planted. A claim of anything else stops the drive. */
  graphId: string;
  /** Approve gates and walk to COMPLETED, or halt at the first decision. */
  drain: boolean;
  listOpenGates: (graphId: string) => Promise<readonly SeedGate[]>;
  approveHumanGate: (gate: SeedGate) => Promise<void>;
  decideAutomaticGate: (gate: SeedGate) => Promise<void>;
  log: (line: string) => void;
  /** Bounded so a loop that stops converging ends rather than spins. */
  maxWindows?: number;
}>;

export type SeedDriveOutcome = Readonly<{
  /** How the last claimed run closed, or null when nothing was claimable. */
  finalState: string | null;
  windows: number;
  /** True when the drive stopped to let a person decide (no --drain). */
  haltedForDecision: boolean;
}>;

/** Deterministic, clearly-labelled output. Development seed, not real work. */
export async function seedExecutor(
  node: Pick<CompiledNode, "nodeKey" | "executor" | "capability">,
): Promise<NodeExecutionResult> {
  if (node.executor === "ANCHOR") {
    const observedAt = new Date().toISOString();
    if (node.nodeKey === "implement") {
      return {
        status: "SUCCEEDED",
        output: {
          observation: "phase1c_change_lineage",
          repository: "demo-data/example",
          baseBranch: "main",
          baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          pullRequestNumber: 1,
          pullRequestUrl: "https://github.com/demo-data/example/pull/1",
          bridgeState: "PULL_REQUEST_RECORDED",
          observedAt,
          latencyMs: 0,
          dev_seed: true,
        },
        tokensUsed: 0,
      };
    }
    if (node.nodeKey === "review") {
      return {
        status: "SUCCEEDED",
        output: {
          observation: "phase1c_pull_request_review",
          repository: "demo-data/example",
          agentRunId: "10000000-0000-4000-8000-000000000001",
          headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          baseBranch: "main",
          pullRequestNumber: 1,
          pullRequestUrl: "https://github.com/demo-data/example/pull/1",
          state: "open",
          draft: true,
          validationRound: 1,
          validations: [{ name: "diff-check", status: "passed", durationMs: 0 }],
          observedAt,
          latencyMs: 0,
          dev_seed: true,
        },
        tokensUsed: 0,
      };
    }
    if (node.capability === "qa") {
      return {
        status: "SUCCEEDED",
        output: {
          observation: "ci_check_runs",
          sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          repository: "demo-data/example",
          total: 1,
          checks: [{
            name: "CI",
            conclusion: "success",
            url: "https://github.com/demo-data/example/actions/runs/1",
          }],
          failing: [],
          observedAt,
          latencyMs: 0,
          dev_seed: true,
        },
        tokensUsed: 0,
      };
    }
    if (node.capability === "implementation") {
      return {
        status: "SUCCEEDED",
        output: {
          observation: "github_production_deployment",
          repository: "demo-data/example",
          sha: "cccccccccccccccccccccccccccccccccccccccc",
          ref: "main",
          deploymentId: null,
          environment: "Production",
          state: "success",
          environmentUrl: "https://dev-seed.invalid",
          bridgeDeploymentId: null,
          observedAt,
          latencyMs: 0,
          dev_seed: true,
        },
        tokensUsed: 0,
      };
    }
    return {
      status: "SUCCEEDED",
      output: {
        observation: "production_http_probe",
        deploymentId: "20000000-0000-4000-8000-000000000001",
        url: "https://dev-seed.invalid",
        status: 200,
        healthy: true,
        observedAt,
        latencyMs: 0,
        postDeployValidation: "inconclusive",
        observationWindowComplete: false,
        missingValidationStages: ["data_integration", "quality_security", "observation"],
        dev_seed: true,
      },
      tokensUsed: 0,
    };
  }

  if (node.executor === "DETERMINISTIC") {
    return {
      status: "SUCCEEDED",
      output: {
        findings: [{
          title: `Seed result for ${node.nodeKey}`,
          severity: "INFO",
          source: "dev-seed",
        }],
        stats: { inputCount: 1, outputCount: 1, reductionRatio: 0 },
        sources: ["dev-seed"],
        unusable_rows: 0,
        unusable_inputs: [],
        missing_inputs: [],
        dev_seed: true,
      },
      tokensUsed: 0,
    };
  }

  if (node.capability === "planning" || node.capability === "architecture") {
    return {
      status: "SUCCEEDED",
      output: {
        steps: [{
          description: `Seed step for ${node.nodeKey}`,
          rationale: "Development seed output — not real work.",
        }],
        dev_seed: true,
      },
      tokensUsed: 0,
    };
  }

  if (node.capability === "discovery") {
    return {
      status: "SUCCEEDED",
      output: {
        schemaVersion: 1,
        searchAreas: ["Demo Data"],
        candidates: [{
          name: "Seed candidate",
          summary: "Development seed output — not a live discovery.",
          source: "REPOSITORY",
          evidence: "Demo Data",
          verification: "VERIFIED_IN_REPO",
          matchScore: 100,
          strengths: ["Deterministic"],
          limitations: ["Not real work"],
        }],
        keyFindings: ["Demo Data"],
        recommendedNextSteps: ["Run the real worker."],
        dev_seed: true,
      },
      tokensUsed: 0,
    };
  }

  if (node.capability === "evaluation") {
    const scores = {
      licenseLegal: 10,
      securitySafety: 10,
      maintenanceActivity: 10,
      featureCompleteness: 10,
      performanceScalability: 10,
      documentation: 10,
      communityEcosystem: 10,
      easeOfIntegration: 10,
      reliabilityTesting: 10,
      codeQuality: 10,
    };
    return {
      status: "SUCCEEDED",
      output: {
        schemaVersion: 1,
        candidates: [{
          name: "Seed candidate",
          scores,
          riskLevel: "LOW",
          recommendation: "STRONGLY_CONSIDER",
          redFlags: [],
          rationale: "Development seed output — not a live evaluation.",
        }],
        ranking: ["Seed candidate"],
        topCandidate: {
          name: "Seed candidate",
          strengths: ["Deterministic"],
          limitations: ["Not real work"],
        },
        recommendationSummary: "Demo Data",
        assumptions: ["This is a development seed."],
        dev_seed: true,
      },
      tokensUsed: 0,
    };
  }

  if (node.capability === "decision") {
    const paths = ["USE", "CONNECT", "ADAPT", "FORK", "BUILD"].map((path) => ({
      path,
      score: path === "BUILD" ? 100 : 0,
      pros: ["Demonstrates the contract"],
      cons: ["Demo Data only"],
      fitNotes: "Development seed output — not a real decision.",
    }));
    return {
      status: "SUCCEEDED",
      output: {
        schemaVersion: 1,
        paths,
        chosenPath: "BUILD",
        subject: "",
        rationale: ["Exercise the development seed."],
        executionPlan: [{ step: "Seed", detail: "Record Demo Data." }],
        integrationBoundaries: { weOwn: ["Demo Data"], counterpartOwns: [] },
        risks: [{ risk: "Mistaken for real work", mitigation: "Carry dev_seed=true." }],
        openQuestions: [],
        dev_seed: true,
      },
      tokensUsed: 0,
    };
  }

  if (node.capability === "synthesis" || node.capability === "reporting") {
    return {
      status: "SUCCEEDED",
      output: {
        summary: `Seed report for ${node.nodeKey}`,
        findings: [{ title: "Demo Data", severity: "INFO" }],
        recommendation: "Run the real worker.",
        dev_seed: true,
      },
      tokensUsed: 0,
    };
  }

  return {
    status: "SUCCEEDED",
    output: {
      findings: [{
        title: `Seed result for ${node.nodeKey}`,
        severity: "INFO",
        location: "Demo Data",
        evidence: "Development seed output — not real work.",
      }],
      dev_seed: true,
    },
    tokensUsed: 0,
  };
}

/**
 * Claim, execute, decide, repeat — the production drain's shape, with the
 * gate decisions a person and an anchor would make.
 */
export async function driveSeedLifecycle(deps: SeedDriveDeps): Promise<SeedDriveOutcome> {
  const maxWindows = deps.maxWindows ?? 8;
  let finalState: string | null = null;
  let windows = 0;

  /*
   * A halted seed is resumed, not stared at. Running the seed once leaves an
   * OPEN gate and a PARTIAL run, and a graph in that state is deliberately
   * unclaimable — it is waiting for a decision, not a worker. So a `--drain`
   * re-run must decide what is already open before it asks for work, or the
   * obvious two-step usage ("seed, look at it, then drain it") would claim
   * nothing and exit having done nothing at all.
   */
  if (deps.drain) {
    for (const gate of await deps.listOpenGates(deps.graphId)) {
      if (gate.kind === "HUMAN") {
        await deps.approveHumanGate(gate);
        deps.log(`Approved the ${gate.stage} human gate left open by an earlier run.`);
      } else {
        await deps.decideAutomaticGate(gate);
        deps.log(`The ${gate.stage} automatic gate left open by an earlier run decided itself.`);
      }
    }
  }

  for (let window = 1; window <= maxWindows; window += 1) {
    // Null before parse, as the production worker does: an empty queue is an
    // idle answer, and parsing it reports a malformed projection instead.
    const claim = await deps.store.claimPlannedGraph();
    if (claim === null) {
      deps.log("Nothing left to claim.");
      break;
    }
    const claimed = parseClaimedGraph(claim);
    if (!claimed.ok) throw new Error(`The claim did not parse: ${claimed.detail}`);
    if (claimed.graph.graph_id !== deps.graphId) {
      throw new Error("The claim returned a graph the seed did not plant; refusing to continue.");
    }
    const compiled = compileClaimedGraph(claimed.graph);
    if (!compiled.ok) throw new Error(`The claimed graph did not compile: ${compiled.detail}`);

    windows = window;
    const summary = await runClaimedGraph(claimed.graph, compiled.graph, deps.store, seedExecutor);
    finalState = summary.finalState;
    deps.log(
      `Window ${window}: ${summary.nodesSucceeded} node(s) completed, `
      + `${summary.reusedNodes.length} reused, run closed ${summary.finalState}.`,
    );
    if (summary.finalState === "COMPLETED") break;

    const gates = await deps.listOpenGates(deps.graphId);
    if (gates.length === 0) continue;

    if (!deps.drain) {
      deps.log(
        `Halted at ${gates.map((gate) => `${gate.stage} (${gate.kind})`).join(", ")}. `
        + "The factory pages now show this decision. Re-run with --drain to approve the gates "
        + "and complete all ten steps.",
      );
      return { finalState, windows, haltedForDecision: true };
    }

    for (const gate of gates) {
      if (gate.kind === "HUMAN") {
        await deps.approveHumanGate(gate);
        deps.log(`Approved the ${gate.stage} human gate as the seed owner.`);
      } else {
        await deps.decideAutomaticGate(gate);
        deps.log(`The ${gate.stage} automatic gate decided itself on its anchored evidence.`);
      }
    }
  }

  return { finalState, windows, haltedForDecision: false };
}
