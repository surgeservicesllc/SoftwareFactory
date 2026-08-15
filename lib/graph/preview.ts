import { compileGraph, describeCompiledGraph, type CompiledGraph } from "@/lib/graph/compiler";
import { assessBudget, type GraphBudget } from "@/lib/graph/budgets";
import { isolatedWorkspaceCount } from "@/lib/graph/fan-out";
import { planLockWaves } from "@/lib/graph/locks";
import { templateNodeContracts, type GraphTemplate } from "@/lib/graph/templates";

/**
 * The execution summary shown *before* anything runs.
 *
 * This is the answer to "what is about to happen, and what will it cost" — the
 * thing the Bot Manager has to be able to show a person before spending their
 * money. Everything in it is derived by compiling the plan, which is pure and
 * needs no credential, so the preview is exact rather than an estimate of the
 * shape.
 *
 * What it deliberately does *not* claim is cost. Token counts are not knowable
 * before a run, and a confident wrong number is worse than an absent one
 * because it gets believed and budgeted against.
 */

export type PreviewNode = {
  readonly nodeKey: string;
  readonly job: string;
  readonly executor: string;
  readonly capability: string;
  readonly modelTier: string;
  readonly risk: string;
  readonly dependsOn: readonly string[];
  /** Layer index, so a UI can lay the graph out without a layout engine. */
  readonly layer: number;
  readonly maxAttempts: number;
  readonly writes: readonly string[];
};

export type PreviewEdge = {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly detail: string;
};

/** A dependency the analysis removed, and why it was not real. */
export type RemovedPreviewEdge = {
  readonly from: string;
  readonly to: string;
  readonly why: string;
};

export type GraphPreview = {
  readonly ok: true;
  readonly goal: string;
  readonly topology: string;
  readonly topologyReasons: readonly { code: string; detail: string }[];
  readonly nodes: readonly PreviewNode[];
  readonly edges: readonly PreviewEdge[];
  /** Proposed dependencies the analysis found to be imaginary. */
  readonly removedEdges: readonly RemovedPreviewEdge[];
  readonly layers: readonly (readonly string[])[];
  readonly lockWaves: readonly (readonly string[])[];
  /** Isolated checkouts this graph would need at full width. */
  readonly isolatedWorkspaces: number;
  readonly maxParallelism: number;
  readonly sequentialDepth: number;
  readonly modelNodeCount: number;
  readonly deterministicNodeCount: number;
  readonly anchorNodeCount: number;
  readonly risk: string;
  readonly requiresOwnerApproval: boolean;
  readonly summary: string;
  readonly costNote: string;
  readonly budgetNote: string | null;
};

export type PreviewFailure = {
  readonly ok: false;
  readonly errors: readonly { code: string; detail: string }[];
};

export type PreviewResult = GraphPreview | PreviewFailure;

/** Assign each node to the earliest layer all of its dependencies allow. */
export function layerNodes(graph: CompiledGraph): readonly (readonly string[])[] {
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.nodeKey, []);
  for (const edge of graph.edges) incoming.get(edge.to)?.push(edge.from);

  const layerOf = new Map<string, number>();
  const remaining = new Set(graph.nodes.map((node) => node.nodeKey));

  while (remaining.size > 0) {
    let progressed = false;
    for (const key of [...remaining]) {
      const parents = incoming.get(key) ?? [];
      if (parents.some((parent) => remaining.has(parent))) continue;
      const depth = parents.reduce(
        (deepest, parent) => Math.max(deepest, (layerOf.get(parent) ?? 0) + 1),
        0,
      );
      layerOf.set(key, depth);
      remaining.delete(key);
      progressed = true;
    }
    if (!progressed) break;
  }

  const layers: string[][] = [];
  for (const node of graph.nodes) {
    const depth = layerOf.get(node.nodeKey) ?? 0;
    while (layers.length <= depth) layers.push([]);
    layers[depth].push(node.nodeKey);
  }
  return layers;
}

export function previewGraph(
  graph: CompiledGraph,
  budget?: GraphBudget,
): GraphPreview {
  const layers = layerNodes(graph);
  const layerIndex = new Map<string, number>();
  layers.forEach((layer, index) => {
    for (const key of layer) layerIndex.set(key, index);
  });

  const dependsOn = new Map<string, string[]>();
  for (const node of graph.nodes) dependsOn.set(node.nodeKey, []);
  for (const edge of graph.edges) dependsOn.get(edge.to)?.push(edge.from);

  const modelNodes = graph.nodes.filter((node) => node.executor === "MODEL");
  const anchorNodes = graph.nodes.filter((node) => node.executor === "ANCHOR");

  let budgetNote: string | null = null;
  if (budget) {
    // Assessed against zero spend: this states the ceiling the run will be held
    // to, not a prediction of what it will use.
    const assessment = assessBudget(budget, {
      nodesStarted: 0,
      elapsedMs: 0,
      retriesUsed: 0,
      discoveryRounds: 0,
    });
    budgetNote =
      `Concurrency is capped at ${assessment.allowedConcurrency}, ` +
      `nodes at ${budget.maxNodes}, retries at ${budget.maxRetries}, ` +
      `and wall time at ${Math.round(budget.maxDurationMs / 60_000)} minutes.` +
      (graph.nodes.length > budget.maxNodes
        ? ` This graph declares ${graph.nodes.length} nodes, which is already above the node ceiling.`
        : "");
  }

  return {
    ok: true,
    goal: graph.goal,
    topology: graph.topology,
    topologyReasons: graph.topologyReasons.map((reason) => ({
      code: reason.code,
      detail: reason.detail,
    })),
    nodes: graph.nodes.map((node) => ({
      nodeKey: node.nodeKey,
      job: node.job,
      executor: node.executor,
      capability: node.capability,
      modelTier: node.modelTier,
      risk: node.risk,
      dependsOn: dependsOn.get(node.nodeKey) ?? [],
      layer: layerIndex.get(node.nodeKey) ?? 0,
      maxAttempts: node.maxAttempts,
      writes: node.writes.map((write) => `${write.kind}:${write.id}`),
    })),
    edges: graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      reason: edge.reason,
      detail: edge.detail,
    })),
    removedEdges: graph.removedEdges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      why: edge.why,
    })),
    layers,
    lockWaves: planLockWaves(graph.nodes),
    isolatedWorkspaces: isolatedWorkspaceCount(graph.nodes),
    maxParallelism: graph.maxParallelism,
    sequentialDepth: graph.sequentialDepth,
    modelNodeCount: modelNodes.length,
    deterministicNodeCount: graph.nodes.length - modelNodes.length - anchorNodes.length,
    anchorNodeCount: anchorNodes.length,
    risk: graph.risk,
    requiresOwnerApproval: graph.requiresOwnerApproval,
    summary: describeCompiledGraph(graph),
    // Stated rather than computed, deliberately. See the module comment.
    costNote:
      modelNodes.length === 0
        ? "No node calls a model, so this graph costs nothing beyond compute."
        : `${modelNodes.length} node(s) call a model. Cost cannot be stated before the run because token counts are not knowable in advance; the budget ceiling is what bounds it.`,
    budgetNote,
  };
}

/** Compile a template and describe what running it would involve. */
export function previewTemplate(
  template: GraphTemplate,
  budget?: GraphBudget,
): PreviewResult {
  const result = compileGraph({
    goal: template.summary,
    nodes: templateNodeContracts(template),
    proposedEdges: template.proposedEdges,
    risk: template.risk,
    discovery: template.discovery,
    resolvedWriteConflicts: template.resolvedWriteConflicts,
  });

  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map((error) => ({ code: error.code, detail: error.detail })),
    };
  }

  return previewGraph(result.graph, budget);
}
