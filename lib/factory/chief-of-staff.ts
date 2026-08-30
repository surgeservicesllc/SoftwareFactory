import { specialistForNode, type Specialist } from "@/lib/factory/specialists";

/**
 * The Chief of Staff, named.
 *
 * The directive asks for a primary orchestrator that converts intent into
 * requirements, tasks, a dependency graph, agent assignments, an execution
 * plan and QA gates, then delegates. That orchestrator EXISTS in this
 * repository as the graph engine's compiler (goal → typed nodes and edges),
 * scheduler (dependency-aware, parallel, claim-locked execution), router
 * (provider/model assignment under policy), and verifier loop (gates +
 * graph_verifications + bounded iterations). This module gives that
 * machinery its name and one composed view — it invents nothing and runs
 * nothing. Every field of a composed plan is derived from records the
 * engine already made: the goal verbatim, the nodes as compiled, the edges
 * as stored, the gates as declared, the states as executed.
 */

export type PlanNodeInput = Readonly<{
  node_key: string;
  capability?: string | null;
  lifecycle_stage?: string | null;
  state?: string | null;
  gate_kind?: string | null;
}>;

export type PlanEdgeInput = Readonly<{ from: string; to: string }>;

export type PlanTask = Readonly<{
  key: string;
  specialist: Specialist | null;
  stage: string | null;
  gated: boolean;
  state: string | null;
}>;

export type ComposedPlan = Readonly<{
  /** The intent, verbatim — requirements begin as exactly what was asked. */
  requirements: string;
  /** Dependency-ordered layers: everything in one layer may run in parallel. */
  layers: readonly (readonly string[])[];
  tasks: readonly PlanTask[];
  /** The QA gates the plan carries, by node key. */
  gatedTasks: readonly string[];
  /** The widest layer — the plan's real parallelism, not a claim. */
  maxParallelism: number;
  /** Whole-number percent of tasks completed or skipped; null with no tasks. */
  progressPercent: number | null;
}>;

/**
 * Compose the plan view from the engine's own records.
 *
 * Layering is Kahn's algorithm over the stored edges. A dependency that
 * names a node the run does not carry is ignored (the run is the truth),
 * and if anything remains unplaced — which a compiled DAG should make
 * impossible — the remainder becomes one honest final layer rather than
 * disappearing.
 */
export function composePlan(input: Readonly<{
  goal: string;
  nodes: readonly PlanNodeInput[];
  edges: readonly PlanEdgeInput[];
}>): ComposedPlan {
  const keys = input.nodes.map((node) => node.node_key);
  const keySet = new Set(keys);
  const inDegree = new Map<string, number>(keys.map((key) => [key, 0]));
  const dependents = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (!keySet.has(edge.from) || !keySet.has(edge.to)) continue;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    const list = dependents.get(edge.from) ?? [];
    list.push(edge.to);
    dependents.set(edge.from, list);
  }

  const layers: string[][] = [];
  const placed = new Set<string>();
  let frontier = keys.filter((key) => (inDegree.get(key) ?? 0) === 0);
  while (frontier.length > 0) {
    layers.push(frontier);
    for (const key of frontier) placed.add(key);
    for (const key of frontier) {
      for (const dependent of dependents.get(key) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 0) - 1);
      }
    }
    frontier = keys.filter(
      (key) => !placed.has(key) && (inDegree.get(key) ?? 0) === 0,
    );
  }
  const unplaced = keys.filter((key) => !placed.has(key));
  if (unplaced.length > 0) layers.push(unplaced);

  const tasks: PlanTask[] = input.nodes.map((node) => ({
    key: node.node_key,
    specialist: specialistForNode(node),
    stage: node.lifecycle_stage ?? null,
    gated: node.gate_kind != null,
    state: node.state ?? null,
  }));

  const done = tasks.filter(
    (task) => task.state === "COMPLETED" || task.state === "SKIPPED",
  ).length;

  return {
    requirements: input.goal,
    layers,
    tasks,
    gatedTasks: tasks.filter((task) => task.gated).map((task) => task.key),
    maxParallelism: layers.reduce((widest, layer) => Math.max(widest, layer.length), 0),
    progressPercent: tasks.length === 0 ? null : Math.round((done / tasks.length) * 100),
  };
}
