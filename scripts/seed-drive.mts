import type { NodeExecutionResult } from "@/lib/graph/runner";
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
  node: { nodeKey: string; executor: string },
): Promise<NodeExecutionResult> {
  if (node.executor === "ANCHOR") {
    return {
      status: "SUCCEEDED",
      output: { dev_seed: true, kind: "seed_observation", subject: node.nodeKey, verdict: "green" },
      tokensUsed: 0,
    };
  }
  return {
    status: "SUCCEEDED",
    output: { dev_seed: true, stage_product: node.nodeKey, note: "Development seed output — not real work." },
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
