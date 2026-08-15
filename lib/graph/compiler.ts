import type { NodeContract } from "@/lib/graph/contracts";
import { modelTierFor } from "@/lib/graph/contracts";
import { findCycle, type ProposedEdge } from "@/lib/graph/dependencies";
import { selectTopology, type TopologyDecision } from "@/lib/graph/topology";
import type { GraphEdge, RiskLevel } from "@/lib/graph/types";

/**
 * The graph compiler.
 *
 * Orchestration is data, not a conversation. A plan arrives as nodes and
 * proposed edges; this turns it into a definition the scheduler can execute
 * from persisted rows, so a node never needs the transcript that produced it —
 * only its own contract and its inputs.
 *
 * Compilation is where a plan is rejected. A graph with a cycle, a dangling
 * dependency, or a node whose contract cannot be satisfied should fail here,
 * loudly and before anything is spent, rather than deadlocking at run time
 * when half its budget is gone.
 */

export const COMPILE_ERROR_CODES = [
  "DUPLICATE_NODE_KEY",
  "UNKNOWN_DEPENDENCY",
  "CYCLE",
  "NO_ENTRY_NODE",
  "EMPTY_GRAPH",
  "WRITE_CONFLICT_UNRESOLVED",
] as const;
export type CompileErrorCode = (typeof COMPILE_ERROR_CODES)[number];

export type CompileError = {
  readonly code: CompileErrorCode;
  readonly detail: string;
  readonly nodes?: readonly string[];
};

/** The durable shape. Everything the scheduler needs and nothing it does not. */
export type CompiledGraph = {
  readonly goal: string;
  readonly topology: TopologyDecision["topology"];
  readonly topologyReasons: TopologyDecision["reasons"];
  readonly nodes: readonly CompiledNode[];
  readonly edges: readonly GraphEdge[];
  readonly removedEdges: TopologyDecision["analysis"]["removed"];
  readonly writeConflicts: TopologyDecision["analysis"]["writeConflicts"];
  readonly maxParallelism: number;
  readonly sequentialDepth: number;
  readonly risk: RiskLevel;
  readonly requiresOwnerApproval: boolean;
};

export type CompiledNode = {
  readonly nodeKey: string;
  readonly job: string;
  readonly executor: NodeContract["executor"];
  readonly capability: NodeContract["capability"];
  readonly modelTier: ReturnType<typeof modelTierFor>;
  readonly risk: RiskLevel;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly allowProviderFallback: boolean;
  readonly reads: NodeContract["reads"];
  readonly writes: NodeContract["writes"];
};

export type CompileResult =
  | { readonly ok: true; readonly graph: CompiledGraph }
  | { readonly ok: false; readonly errors: readonly CompileError[] };

export type CompileInput = {
  readonly goal: string;
  readonly nodes: readonly NodeContract[];
  readonly proposedEdges: readonly ProposedEdge[];
  readonly risk?: RiskLevel;
  readonly discovery?: boolean;
  readonly iterative?: boolean;
  /**
   * Resources the caller has already arranged to serialize or lock. A write
   * conflict on one of these is accepted; anything else fails compilation,
   * because silently letting two nodes write the same file is the failure the
   * conflict detection exists to prevent.
   */
  readonly resolvedWriteConflicts?: readonly string[];
};

export function compileGraph(input: CompileInput): CompileResult {
  const errors: CompileError[] = [];

  if (input.nodes.length === 0) {
    return {
      ok: false,
      errors: [{ code: "EMPTY_GRAPH", detail: "A graph needs at least one node." }],
    };
  }

  const seen = new Set<string>();
  for (const node of input.nodes) {
    if (seen.has(node.nodeId)) {
      errors.push({
        code: "DUPLICATE_NODE_KEY",
        detail: `Node key ${node.nodeId} appears more than once.`,
        nodes: [node.nodeId],
      });
    }
    seen.add(node.nodeId);
  }

  for (const node of input.nodes) {
    for (const dependency of node.dependsOn) {
      if (!seen.has(dependency)) {
        errors.push({
          code: "UNKNOWN_DEPENDENCY",
          detail: `${node.nodeId} depends on ${dependency}, which is not in the graph.`,
          nodes: [node.nodeId, dependency],
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const decision = selectTopology({
    nodes: input.nodes,
    proposedEdges: input.proposedEdges,
    discovery: input.discovery,
    iterative: input.iterative,
    risk: input.risk,
  });

  const cycle = findCycle(input.nodes, decision.analysis.edges);
  if (cycle) {
    errors.push({
      code: "CYCLE",
      detail: `These nodes wait on each other: ${cycle.join(" → ")}.`,
      nodes: cycle,
    });
  }

  // Something has to be able to start. A graph where every node has an
  // unsatisfied dependency would sit at PENDING forever.
  const hasEntry = input.nodes.some(
    (node) => !decision.analysis.edges.some((edge) => edge.to === node.nodeId),
  );
  if (!hasEntry) {
    errors.push({
      code: "NO_ENTRY_NODE",
      detail: "Every node depends on another, so nothing can start.",
    });
  }

  const resolved = new Set(input.resolvedWriteConflicts ?? []);
  for (const conflict of decision.analysis.writeConflicts) {
    const key = `${conflict.resource.kind}:${conflict.resource.id}`;
    if (resolved.has(key)) continue;
    errors.push({
      code: "WRITE_CONFLICT_UNRESOLVED",
      detail: `${conflict.nodes[0]} and ${conflict.nodes[1]} both write ${key}. Serialize them or declare the conflict resolved before running.`,
      nodes: [...conflict.nodes],
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    graph: {
      goal: input.goal,
      topology: decision.topology,
      topologyReasons: decision.reasons,
      nodes: input.nodes.map((node) => ({
        nodeKey: node.nodeId,
        job: node.job,
        executor: node.executor,
        capability: node.capability,
        modelTier: modelTierFor(node),
        risk: node.risk,
        timeoutMs: node.timeoutMs,
        maxAttempts: node.retry.maxAttempts,
        allowProviderFallback: node.retry.allowProviderFallback,
        reads: node.reads,
        writes: node.writes,
      })),
      edges: decision.analysis.edges,
      removedEdges: decision.analysis.removed,
      writeConflicts: decision.analysis.writeConflicts,
      maxParallelism: decision.maxParallelism,
      sequentialDepth: decision.sequentialDepth,
      risk: input.risk ?? "GREEN",
      requiresOwnerApproval: decision.requiresOwnerApproval,
    },
  };
}

/**
 * A short human summary of what running this graph would involve.
 *
 * This is what the Bot Manager shows before spending anything: topology, width,
 * depth, and — importantly — how many proposed dependencies turned out to be
 * imaginary, since that is usually the difference between a fast graph and a
 * slow one.
 */
export function describeCompiledGraph(graph: CompiledGraph): string {
  const lines = [
    `Topology: ${graph.topology}`,
    `Nodes: ${graph.nodes.length}`,
    `Parallel workers: ${graph.maxParallelism}`,
    `Sequential depth: ${graph.sequentialDepth}`,
    `Risk: ${graph.risk}`,
  ];

  if (graph.removedEdges.length > 0) {
    lines.push(
      `Removed ${graph.removedEdges.length} unjustified dependenc${
        graph.removedEdges.length === 1 ? "y" : "ies"
      }, which is what allows the parallelism above.`,
    );
  }

  const modelNodes = graph.nodes.filter((node) => node.modelTier !== "NONE");
  lines.push(
    `Model calls: ${modelNodes.length} of ${graph.nodes.length} nodes; the rest run deterministically.`,
  );

  if (graph.requiresOwnerApproval) {
    lines.push("Owner approval required before this graph may run.");
  }

  return lines.join("\n");
}
