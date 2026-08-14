import type { CompiledGraph } from "@/lib/graph/compiler";
import type { NodeState } from "@/lib/graph/types";

/**
 * Graph observability.
 *
 * The question a graph has to answer after it runs is not "did it finish" but
 * "was it worth it, and can I believe the answer". Those are different
 * measurements and this module keeps them apart:
 *
 * - **Efficiency** — critical path, achieved parallelism, latency, retries.
 *   Whether the graph was the right shape.
 * - **Trust** — verifier rejection rate, nodes that never reported, missing
 *   inputs. Whether the result is complete.
 *
 * Every metric here refuses to compute rather than guessing. A rate over zero
 * observations is `null`, not `0`, because "nothing was rejected" and "nothing
 * was checked" are opposite facts that a zero would render identically.
 */

export type NodeObservation = {
  readonly nodeKey: string;
  readonly state: NodeState;
  readonly attempts: number;
  /** Wall time across all attempts, or null if the node never ran. */
  readonly durationMs: number | null;
  /** Whether a verifier accepted this node's output. Null means unverified. */
  readonly verifierAccepted: boolean | null;
  /** Declared inputs that never arrived. */
  readonly missingInputs: readonly string[];
  /** Items produced before reduction, where the node produced a collection. */
  readonly itemsProduced: number | null;
  /** Items surviving reduction. */
  readonly itemsRetained: number | null;
};

export type GraphObservation = {
  readonly graph: CompiledGraph;
  readonly nodes: readonly NodeObservation[];
  /** Wall time for the whole run. */
  readonly totalDurationMs: number;
};

export type GraphMetrics = {
  /** Nodes on the longest dependent chain. */
  readonly criticalPath: readonly string[];
  readonly criticalPathDurationMs: number | null;
  /**
   * The lower bound on wall time set by the graph's shape. Everything above
   * this is scheduling overhead or contention, not work.
   */
  readonly theoreticalFloorMs: number | null;
  /** Width the plan allowed. */
  readonly plannedParallelism: number;
  /**
   * Width actually achieved: total node time divided by wall time. Below the
   * planned figure means nodes queued rather than overlapped.
   */
  readonly achievedParallelism: number | null;
  readonly totalDurationMs: number;
  readonly totalNodeTimeMs: number;
  readonly retryCount: number;
  /** Share of nodes that needed more than one attempt. Null with no nodes run. */
  readonly retryRate: number | null;
  /** Share of verified nodes a verifier rejected. Null if nothing was verified. */
  readonly verifierRejectionRate: number | null;
  readonly verifiedNodeCount: number;
  /** Items retained ÷ items produced. Null if no node reported a collection. */
  readonly reductionRatio: number | null;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly neverReportedCount: number;
  /** Share of nodes that completed. Counts completions only. */
  readonly completionRate: number;
  readonly nodesWithMissingInputs: readonly string[];
  /**
   * True only when every node completed and nothing is outstanding. A graph
   * that failed a node is not complete however much of it finished.
   */
  readonly wholeResult: boolean;
};

const TERMINAL_INCOMPLETE: readonly NodeState[] = ["FAILED", "BLOCKED", "CANCELLED", "SKIPPED"];

function edgeDurations(
  nodes: readonly NodeObservation[],
): Map<string, number> {
  const byKey = new Map<string, number>();
  for (const node of nodes) byKey.set(node.nodeKey, node.durationMs ?? 0);
  return byKey;
}

/**
 * The longest dependent chain, weighted by how long each node actually took.
 *
 * The unweighted path says which nodes are structurally serial; this says what
 * that structure cost. They differ whenever one slow node sits on a short chain,
 * which is the case where the useful optimization is speeding up a node rather
 * than reshaping the graph.
 */
export function weightedCriticalPath(
  graph: CompiledGraph,
  nodes: readonly NodeObservation[],
): { readonly path: readonly string[]; readonly durationMs: number | null } {
  const durations = edgeDurations(nodes);
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.nodeKey, []);
  for (const edge of graph.edges) incoming.get(edge.to)?.push(edge.from);

  const best = new Map<string, { cost: number; path: string[] }>();

  // Nodes are visited in dependency order; a compiled graph is acyclic, so a
  // repeated sweep until nothing changes settles in at most one pass per layer.
  const remaining = new Set(graph.nodes.map((node) => node.nodeKey));
  while (remaining.size > 0) {
    let progressed = false;
    for (const key of [...remaining]) {
      const parents = incoming.get(key) ?? [];
      if (parents.some((parent) => remaining.has(parent))) continue;

      const own = durations.get(key) ?? 0;
      let bestParent: { cost: number; path: string[] } = { cost: 0, path: [] };
      for (const parent of parents) {
        const candidate = best.get(parent);
        if (candidate && candidate.cost > bestParent.cost) bestParent = candidate;
      }

      best.set(key, { cost: bestParent.cost + own, path: [...bestParent.path, key] });
      remaining.delete(key);
      progressed = true;
    }
    // Defensive: a cycle would stall this loop, and a compiled graph cannot
    // contain one. Stopping beats spinning.
    if (!progressed) break;
  }

  let winner: { cost: number; path: string[] } | null = null;
  for (const entry of best.values()) {
    if (!winner || entry.cost > winner.cost) winner = entry;
  }

  if (!winner) return { path: [], durationMs: null };
  const anyTimed = nodes.some((node) => node.durationMs !== null);
  return { path: winner.path, durationMs: anyTimed ? winner.cost : null };
}

export function computeGraphMetrics(observation: GraphObservation): GraphMetrics {
  const { graph, nodes, totalDurationMs } = observation;

  const ran = nodes.filter((node) => node.durationMs !== null);
  const totalNodeTimeMs = ran.reduce((sum, node) => sum + (node.durationMs ?? 0), 0);

  // Always populated for a non-empty graph: a compiled graph is acyclic, so
  // every node is assigned a path.
  const weighted = weightedCriticalPath(graph, nodes);

  const completed = nodes.filter((node) => node.state === "COMPLETED");
  const failed = nodes.filter((node) => TERMINAL_INCOMPLETE.includes(node.state));
  // A node that never reached a terminal state is not a failure and not a
  // success; conflating it with either is how a graph decides it is finished.
  const neverReported = nodes.filter(
    (node) => node.state !== "COMPLETED" && !TERMINAL_INCOMPLETE.includes(node.state),
  );

  const verified = nodes.filter((node) => node.verifierAccepted !== null);
  const rejected = verified.filter((node) => node.verifierAccepted === false);

  const retried = ran.filter((node) => node.attempts > 1);
  const retryCount = ran.reduce((sum, node) => sum + Math.max(0, node.attempts - 1), 0);

  const withItems = nodes.filter(
    (node) => node.itemsProduced !== null && node.itemsRetained !== null,
  );
  const produced = withItems.reduce((sum, node) => sum + (node.itemsProduced ?? 0), 0);
  const retained = withItems.reduce((sum, node) => sum + (node.itemsRetained ?? 0), 0);

  return {
    criticalPath: weighted.path,
    criticalPathDurationMs: weighted.durationMs,
    theoreticalFloorMs: weighted.durationMs,
    plannedParallelism: graph.maxParallelism,
    achievedParallelism:
      totalDurationMs > 0 && ran.length > 0
        ? Number((totalNodeTimeMs / totalDurationMs).toFixed(2))
        : null,
    totalDurationMs,
    totalNodeTimeMs,
    retryCount,
    retryRate: ran.length > 0 ? Number((retried.length / ran.length).toFixed(2)) : null,
    verifierRejectionRate:
      verified.length > 0 ? Number((rejected.length / verified.length).toFixed(2)) : null,
    verifiedNodeCount: verified.length,
    reductionRatio: produced > 0 ? Number((retained / produced).toFixed(2)) : null,
    completedCount: completed.length,
    failedCount: failed.length,
    neverReportedCount: neverReported.length,
    completionRate:
      nodes.length > 0 ? Number((completed.length / nodes.length).toFixed(2)) : 0,
    nodesWithMissingInputs: nodes
      .filter((node) => node.missingInputs.length > 0)
      .map((node) => node.nodeKey),
    wholeResult:
      nodes.length > 0 &&
      completed.length === nodes.length &&
      nodes.every((node) => node.missingInputs.length === 0),
  };
}

/**
 * A plain-language reading of the metrics.
 *
 * Deliberately states the uncomfortable ones first. A graph that ran fast and
 * verified nothing is a worse outcome than a slow one that verified everything,
 * and a summary that leads with the latency would mislead.
 */
export function describeMetrics(metrics: GraphMetrics): readonly string[] {
  const lines: string[] = [];

  if (!metrics.wholeResult) {
    const parts: string[] = [];
    if (metrics.failedCount > 0) parts.push(`${metrics.failedCount} failed`);
    if (metrics.neverReportedCount > 0) {
      parts.push(`${metrics.neverReportedCount} never reported`);
    }
    if (metrics.nodesWithMissingInputs.length > 0) {
      parts.push(`${metrics.nodesWithMissingInputs.length} ran without declared input`);
    }
    lines.push(
      parts.length > 0
        ? `This result is not whole: ${parts.join(", ")}. It must not be presented as a complete answer.`
        : "This result is not whole.",
    );
  }

  if (metrics.verifierRejectionRate === null) {
    lines.push("Nothing was independently verified, so nothing here is confirmed.");
  } else if (metrics.verifierRejectionRate > 0) {
    lines.push(
      `A verifier rejected ${Math.round(metrics.verifierRejectionRate * 100)}% of the ${
        metrics.verifiedNodeCount
      } verified nodes.`,
    );
  }

  if (metrics.achievedParallelism !== null) {
    lines.push(
      `Achieved ${metrics.achievedParallelism}× parallelism against a planned width of ${metrics.plannedParallelism}.`,
    );
  }

  if (metrics.criticalPathDurationMs !== null) {
    lines.push(
      `The critical path (${metrics.criticalPath.join(" → ")}) accounts for ${metrics.criticalPathDurationMs}ms of the ${metrics.totalDurationMs}ms run.`,
    );
  }

  if (metrics.retryCount > 0) {
    lines.push(`${metrics.retryCount} retry attempt(s) across the run.`);
  }

  if (metrics.reductionRatio !== null) {
    lines.push(
      `Reduction kept ${Math.round(metrics.reductionRatio * 100)}% of produced items.`,
    );
  }

  return lines;
}
