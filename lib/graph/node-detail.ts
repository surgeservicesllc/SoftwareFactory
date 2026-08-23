import { SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * One node, as a reader needs it.
 *
 * `list_graph_runs` now projects what a node was asked to do, what it waited
 * for, when it moved, why it stopped and what it produced. This module turns
 * those raw columns into the few derived facts a panel needs — and refuses to
 * derive the ones the data cannot support.
 *
 * The refusals are the point. A node that started and never finished has no
 * duration; a node whose clocks disagree has no duration either. Both return
 * null here rather than a number, because a plausible-looking elapsed time is
 * far worse than a blank: nobody audits a number that looks right.
 */

/** The node shape this module reads, as the runs endpoint projects it. */
export type DetailedNode = {
  readonly node_key: string;
  readonly state: string;
  readonly job?: string | null;
  readonly capability?: string | null;
  readonly executor?: string | null;
  readonly lifecycle_stage?: string | null;
  readonly max_attempts?: number | null;
  readonly queued_at?: string | null;
  readonly node_started_at?: string | null;
  readonly node_completed_at?: string | null;
  readonly blocked_reason?: string | null;
  readonly error_message?: string | null;
  readonly depends_on?: readonly string[] | null;
  readonly artifact_counts?: Readonly<Record<string, number>> | null;
  readonly latency_ms?: number | null;
};

function parsed(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * How long the node actually ran, or null when that is not knowable.
 *
 * Null in three cases, each a real one: the node never started, it started and
 * has not finished, or the two timestamps are out of order (a clock adjustment
 * mid-run, which does happen). The third could be reported as 0 or as an
 * absolute value; both would be inventions, so it is null like the others.
 *
 * Deliberately not `latency_ms`. That is what the executor measured for its own
 * call — model time — and it is legitimately smaller than the wall time the
 * node occupied. Presenting either as the other would misattribute the gap.
 */
export function nodeElapsedMs(node: DetailedNode): number | null {
  const startedAt = parsed(node.node_started_at);
  const completedAt = parsed(node.node_completed_at);
  if (startedAt === null || completedAt === null) return null;
  const elapsed = completedAt - startedAt;
  return elapsed >= 0 ? elapsed : null;
}

/**
 * How long the node sat queued before it began, or null.
 *
 * The gap between "the graph was claimed" and "this node started" is the
 * clearest signal of a graph starved by its own dependency order, and it is
 * invisible in every other figure the panel shows.
 */
export function nodeQueuedMs(node: DetailedNode): number | null {
  const queuedAt = parsed(node.queued_at);
  const startedAt = parsed(node.node_started_at);
  if (queuedAt === null || startedAt === null) return null;
  const waited = startedAt - queuedAt;
  return waited >= 0 ? waited : null;
}

/**
 * A duration a person can read, from milliseconds.
 *
 * Sub-second work is reported in milliseconds rather than as "0s", because a
 * deterministic reducer finishing in 4ms and one finishing in 900ms are not the
 * same event, and rounding both to zero hides the only difference between them.
 */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  // 59.7s rounds to 60 and would print "3m 60s".
  if (remainder === 60) return `${minutes + 1}m`;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

/** Total artifacts this node produced, across every kind. */
export function nodeArtifactTotal(node: DetailedNode): number {
  const counts = node.artifact_counts;
  if (!counts || typeof counts !== "object") return 0;
  let total = 0;
  for (const value of Object.values(counts)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

/**
 * Why this node is where it is, in one line, or null when the node is not
 * stopped on anything.
 *
 * Order matters: `blocked_reason` outranks `error_message` because a node
 * blocked by an upstream failure did not itself fail, and showing it the
 * executor's error would blame the wrong node.
 */
export function nodeStoppedReason(node: DetailedNode): string | null {
  const blocked = node.blocked_reason?.trim();
  if (blocked) return blocked;
  const failed = node.error_message?.trim();
  return failed ? failed : null;
}

function isStage(value: string | null | undefined): value is SdlcStage {
  return typeof value === "string" && (SDLC_STAGES as readonly string[]).includes(value);
}

export type NodeDetail = {
  readonly nodeKey: string;
  readonly state: string;
  readonly job: string | null;
  readonly stage: SdlcStage | null;
  readonly capability: string | null;
  readonly executor: string | null;
  readonly dependsOn: readonly string[];
  readonly maxAttempts: number | null;
  readonly elapsedMs: number | null;
  readonly elapsed: string | null;
  readonly queuedMs: number | null;
  readonly queued: string | null;
  readonly artifactTotal: number;
  readonly artifactCounts: Readonly<Record<string, number>>;
  readonly stoppedReason: string | null;
};

/**
 * Everything about one node, derived once.
 *
 * A single call site so the panel and any future stage page cannot derive the
 * same node two ways — the mistake round 8 avoided by building the portfolio on
 * the existing summariser rather than beside it.
 */
export function describeNode(node: DetailedNode): NodeDetail {
  const elapsedMs = nodeElapsedMs(node);
  const queuedMs = nodeQueuedMs(node);
  const counts: Record<string, number> = {};
  if (node.artifact_counts && typeof node.artifact_counts === "object") {
    for (const [kind, value] of Object.entries(node.artifact_counts)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) counts[kind] = value;
    }
  }
  return {
    nodeKey: node.node_key,
    state: node.state,
    job: node.job?.trim() ? node.job.trim() : null,
    stage: isStage(node.lifecycle_stage) ? node.lifecycle_stage : null,
    capability: node.capability ?? null,
    executor: node.executor ?? null,
    dependsOn: Array.isArray(node.depends_on)
      ? node.depends_on.filter((key): key is string => typeof key === "string")
      : [],
    maxAttempts: typeof node.max_attempts === "number" ? node.max_attempts : null,
    elapsedMs,
    elapsed: formatDuration(elapsedMs),
    queuedMs,
    queued: formatDuration(queuedMs),
    artifactTotal: nodeArtifactTotal(node),
    artifactCounts: counts,
    stoppedReason: nodeStoppedReason(node),
  };
}
