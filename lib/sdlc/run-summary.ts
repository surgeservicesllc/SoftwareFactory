import {
  SDLC_LIFECYCLE,
  SDLC_STAGES,
  stageDefinition,
  type SdlcStage,
} from "@/lib/sdlc/lifecycle";

/**
 * A run, summarised by lifecycle stage.
 *
 * The stage column was written by the backfill and read by exactly one place:
 * a per-node cell. That is data nobody consumes — a reader still has to hold
 * twelve node rows in their head to answer "where is this run?". This rolls
 * the nodes up into the eight stages so the question is answered by looking.
 *
 * Pure, and over nodes the caller already has. No fetch, no clock: a summary
 * computed from a different read than the table beneath it is a summary that
 * can disagree with it.
 *
 * Eight stages, not the goal document's ten. DISCOVER, EVALUATE and DECIDE
 * have nothing that produces them — no capability resolves to one — so a
 * tenth of this surface would be permanently empty by construction (ADR-136).
 */

export type SummarisableNode = Readonly<{
  node_key: string;
  state: string;
  lifecycle_stage?: string | null;
  gate_state?: string | null;
  gate_kind?: string | null;
  error_message?: string | null;
  latency_ms?: number | null;
}>;

/** What a stage is doing, derived from the nodes that carry it. */
export type StageStatus =
  | "NOT_STARTED"
  | "RUNNING"
  | "AWAITING_DECISION"
  | "FAILED"
  | "COMPLETE";

export type StageSummary = Readonly<{
  stage: SdlcStage;
  /** What the stage produces, from the lifecycle definition. */
  produces: string;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  /** Nodes whose gate is open — a person owes this stage a decision. */
  awaitingDecision: number;
  status: StageStatus;
  /** Summed node latency, or null when nothing has run. */
  elapsedMs: number | null;
  /** The first error in the stage, so a failure names itself in the rollup. */
  firstError: string | null;
}>;

export type RunSummary = Readonly<{
  stages: readonly StageSummary[];
  /**
   * The stage a reader should look at: the earliest one that is failed,
   * awaiting a decision, or running. Null when nothing is in flight.
   */
  currentStage: SdlcStage | null;
  /** Nodes carrying no stage at all — from a graph that predates the rule. */
  unstagedCount: number;
  /** Stages with at least one node, over the eight. */
  stagesWithWork: number;
  completedStages: number;
}>;

const SUCCEEDED = new Set(["SUCCEEDED", "COMPLETE", "COMPLETED", "PASSED"]);
const FAILED = new Set(["FAILED", "ERROR", "TIMED_OUT", "CANCELLED"]);
const RUNNING = new Set(["RUNNING", "CLAIMED", "DISPATCHED", "VERIFYING", "QUEUED", "READY"]);

function classify(state: string): "succeeded" | "failed" | "running" | "other" {
  const upper = state.toUpperCase();
  if (SUCCEEDED.has(upper)) return "succeeded";
  if (FAILED.has(upper)) return "failed";
  if (RUNNING.has(upper)) return "running";
  return "other";
}

function statusFor(counts: {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  awaitingDecision: number;
}): StageStatus {
  if (counts.total === 0) return "NOT_STARTED";
  /*
   * Order matters, and it is not arbitrary. A failure outranks everything
   * because it is the thing a reader has to act on; an open gate outranks
   * running because it is waiting on a *person* rather than on the machine.
   * Complete is last so a stage with one unfinished node never reads done.
   */
  if (counts.failed > 0) return "FAILED";
  if (counts.awaitingDecision > 0) return "AWAITING_DECISION";
  if (counts.running > 0) return "RUNNING";
  if (counts.succeeded === counts.total) return "COMPLETE";
  return "RUNNING";
}

export function summariseRunByStage(nodes: readonly SummarisableNode[]): RunSummary {
  const known = new Set<string>(SDLC_STAGES);
  const byStage = new Map<SdlcStage, SummarisableNode[]>();
  let unstagedCount = 0;

  for (const node of nodes) {
    const stage = node.lifecycle_stage;
    // A stage the application does not define is counted as unstaged rather
    // than silently dropped: an unrecognised value is a fact about the data.
    if (!stage || !known.has(stage)) {
      unstagedCount += 1;
      continue;
    }
    const bucket = byStage.get(stage as SdlcStage) ?? [];
    bucket.push(node);
    byStage.set(stage as SdlcStage, bucket);
  }

  const stages = SDLC_LIFECYCLE.map((definition) => {
    const bucket = byStage.get(definition.stage) ?? [];
    let succeeded = 0;
    let failed = 0;
    let running = 0;
    let awaitingDecision = 0;
    let elapsed = 0;
    let sawLatency = false;
    let firstError: string | null = null;

    for (const node of bucket) {
      const kind = classify(node.state);
      if (kind === "succeeded") succeeded += 1;
      else if (kind === "failed") failed += 1;
      else if (kind === "running") running += 1;
      if (node.gate_state === "OPEN") awaitingDecision += 1;
      if (typeof node.latency_ms === "number") {
        elapsed += node.latency_ms;
        sawLatency = true;
      }
      if (!firstError && node.error_message) firstError = node.error_message;
    }

    const counts = { total: bucket.length, succeeded, failed, running, awaitingDecision };
    return Object.freeze({
      stage: definition.stage,
      produces: stageDefinition(definition.stage).produces,
      ...counts,
      status: statusFor(counts),
      elapsedMs: sawLatency ? elapsed : null,
      firstError,
    });
  });

  const attention: readonly StageStatus[] = ["FAILED", "AWAITING_DECISION", "RUNNING"];
  const currentStage = stages.find((entry) => attention.includes(entry.status))?.stage ?? null;

  return Object.freeze({
    stages,
    currentStage,
    unstagedCount,
    stagesWithWork: stages.filter((entry) => entry.total > 0).length,
    completedStages: stages.filter((entry) => entry.status === "COMPLETE").length,
  });
}
