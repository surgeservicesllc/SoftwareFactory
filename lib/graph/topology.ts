import type { NodeContract } from "@/lib/graph/contracts";
import { analyzeDependencies, criticalPath, type ProposedEdge } from "@/lib/graph/dependencies";
import type { DependencyAnalysis } from "@/lib/graph/dependencies";
import type { GraphTopology, RiskLevel } from "@/lib/graph/types";

/**
 * Topology selection.
 *
 * The bias here is deliberate and runs against the instinct of the thing:
 * **most work is not a graph.** A graph costs a planner call, a scheduler, a
 * verification pass, and a synthesis step, and it buys nothing at all unless
 * there is genuine independent work to overlap. So `SINGLE_AGENT` is the
 * default and every richer topology has to be earned by evidence in the node
 * set — not by the goal sounding complicated.
 *
 * The decision is returned with its reasons so a reviewer can see why the
 * engine chose to spend, or not spend, on parallelism.
 */

export type TopologyReasonCode =
  | "SINGLE_NODE"
  | "NO_INDEPENDENT_WORK"
  | "PURELY_SEQUENTIAL"
  | "INDEPENDENT_BRANCHES"
  | "FAN_OUT_WITH_REDUCE"
  | "UNBOUNDED_DISCOVERY"
  | "ITERATIVE_REFINEMENT"
  | "OVERHEAD_NOT_JUSTIFIED";

export type TopologyReason = {
  readonly code: TopologyReasonCode;
  readonly detail: string;
};

export type TopologyDecision = {
  readonly topology: GraphTopology;
  readonly reasons: readonly TopologyReason[];
  readonly analysis: DependencyAnalysis;
  /** How many nodes could run at once, given the surviving edges. */
  readonly maxParallelism: number;
  /** Longest dependent chain. */
  readonly sequentialDepth: number;
  readonly requiresOwnerApproval: boolean;
};

export type TopologyInput = {
  readonly nodes: readonly NodeContract[];
  readonly proposedEdges: readonly ProposedEdge[];
  /** The work is an open-ended search whose size is not known up front. */
  readonly discovery?: boolean;
  /** The work is one job repeated until a condition holds. */
  readonly iterative?: boolean;
  readonly risk?: RiskLevel;
};

/**
 * Below this many nodes, a graph's fixed overhead outweighs any overlap it
 * could buy. Two nodes that could run in parallel still finish faster as a
 * short sequence than as a scheduled graph with a reduce step.
 */
const MIN_NODES_FOR_GRAPH = 3;

/** Width at which a fan-out genuinely wants a reduce layer rather than a plain DAG. */
const MIN_WIDTH_FOR_DIAMOND = 4;

function widthByLayer(
  nodes: readonly NodeContract[],
  analysis: DependencyAnalysis,
): number {
  const indegree = new Map<string, number>();
  for (const node of nodes) indegree.set(node.nodeId, 0);
  for (const edge of analysis.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const outgoing = new Map<string, string[]>();
  for (const node of nodes) outgoing.set(node.nodeId, []);
  for (const edge of analysis.edges) outgoing.get(edge.from)?.push(edge.to);

  let frontier = nodes
    .filter((node) => (indegree.get(node.nodeId) ?? 0) === 0)
    .map((node) => node.nodeId);
  let widest = frontier.length;
  const remaining = new Map(indegree);

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of outgoing.get(id) ?? []) {
        const left = (remaining.get(child) ?? 0) - 1;
        remaining.set(child, left);
        if (left === 0) next.push(child);
      }
    }
    widest = Math.max(widest, next.length);
    frontier = next;
  }

  return widest;
}

export function selectTopology(input: TopologyInput): TopologyDecision {
  const { nodes } = input;
  const analysis = analyzeDependencies(nodes, input.proposedEdges);
  const path = criticalPath(nodes, analysis.edges);
  const sequentialDepth = path.length;
  const maxParallelism = widthByLayer(nodes, analysis);
  const reasons: TopologyReason[] = [];
  const requiresOwnerApproval = input.risk === "RED";

  if (nodes.length <= 1) {
    return {
      topology: "SINGLE_AGENT",
      reasons: [
        {
          code: "SINGLE_NODE",
          detail: "One node. A graph would add a scheduler and buy nothing.",
        },
      ],
      analysis,
      maxParallelism: nodes.length,
      sequentialDepth: nodes.length,
      requiresOwnerApproval,
    };
  }

  if (input.iterative) {
    return {
      topology: "LOOP",
      reasons: [
        {
          code: "ITERATIVE_REFINEMENT",
          detail: "The same job repeats until a condition holds, so this is a loop rather than a fan-out.",
        },
      ],
      analysis,
      maxParallelism: 1,
      sequentialDepth,
      requiresOwnerApproval,
    };
  }

  if (input.discovery) {
    return {
      topology: "DISCOVERY_GRAPH",
      reasons: [
        {
          code: "UNBOUNDED_DISCOVERY",
          detail:
            "The work is a search whose size is not known up front, so rounds are generated until a stop condition fires.",
        },
      ],
      analysis,
      maxParallelism,
      sequentialDepth,
      requiresOwnerApproval,
    };
  }

  // No overlap available: a graph would schedule a queue.
  if (maxParallelism <= 1) {
    reasons.push({
      code: "PURELY_SEQUENTIAL",
      detail: "Every node depends on the one before it, so there is nothing to overlap.",
    });
    return {
      topology: nodes.length <= MIN_NODES_FOR_GRAPH ? "SINGLE_AGENT" : "SEQUENTIAL",
      reasons:
        nodes.length <= MIN_NODES_FOR_GRAPH
          ? [
              ...reasons,
              {
                code: "OVERHEAD_NOT_JUSTIFIED",
                detail: `${nodes.length} sequential nodes are cheaper as one agent's job than as a scheduled graph.`,
              },
            ]
          : reasons,
      analysis,
      maxParallelism: 1,
      sequentialDepth,
      requiresOwnerApproval,
    };
  }

  if (nodes.length < MIN_NODES_FOR_GRAPH) {
    return {
      topology: "SINGLE_AGENT",
      reasons: [
        {
          code: "OVERHEAD_NOT_JUSTIFIED",
          detail: `${nodes.length} nodes do not justify a scheduler, a reduce step, and a synthesis pass.`,
        },
      ],
      analysis,
      maxParallelism,
      sequentialDepth,
      requiresOwnerApproval,
    };
  }

  // A wide independent layer that converges is the diamond: plan, fan out,
  // reduce, verify, synthesize.
  const hasReduce = nodes.some(
    (node) => node.capability === "synthesis" || node.executor === "DETERMINISTIC",
  );
  if (maxParallelism >= MIN_WIDTH_FOR_DIAMOND && hasReduce) {
    reasons.push({
      code: "FAN_OUT_WITH_REDUCE",
      detail: `${maxParallelism} independent nodes converge on a reduce or synthesis step.`,
    });
    return {
      topology: "DIAMOND",
      reasons,
      analysis,
      maxParallelism,
      sequentialDepth,
      requiresOwnerApproval,
    };
  }

  reasons.push({
    code: "INDEPENDENT_BRANCHES",
    detail: `${maxParallelism} nodes can run concurrently after fake edges were removed.`,
  });
  if (analysis.removed.length > 0) {
    reasons.push({
      code: "NO_INDEPENDENT_WORK",
      detail: `${analysis.removed.length} proposed edge(s) were removed as unjustified, which is what made this parallel.`,
    });
  }

  return {
    topology: "DAG",
    reasons,
    analysis,
    maxParallelism,
    sequentialDepth,
    requiresOwnerApproval,
  };
}
