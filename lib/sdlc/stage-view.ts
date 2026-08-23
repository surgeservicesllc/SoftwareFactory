import {
  isSdlcStage,
  isTerminalStatus,
  nextStage,
  nodeDisplayStatus,
  previousStage,
  REJECTION_RETURNS_TO,
  SDLC_STAGES,
  stageDefinition,
  stageStatus,
  type GateKind,
  type GateState,
  type NodeDisplayStatus,
  type SdlcStage,
  type StageStatus,
} from "@/lib/sdlc/lifecycle";

/**
 * What one lifecycle stage looks like, derived from what a run actually
 * recorded.
 *
 * Kept pure and kept here, away from the component, for the usual reason: the
 * interesting mistakes are derivation mistakes — a stage reported green while a
 * node in it failed, a "waiting" that is really "never started", a parallel
 * count that counts nodes rather than nodes that can run at once — and every
 * one of those is catchable by a unit test and invisible in a screenshot.
 *
 * Nothing here invents a number. Where a run recorded nothing, the field is
 * empty or null and the page says so; there is no default that would let an
 * unstarted stage render as a working one.
 */

/** One node of a run, exactly as `list_graph_runs` projects it. */
export type RunNode = {
  readonly node_id?: string | null;
  readonly node_key: string;
  readonly job?: string | null;
  readonly executor?: string | null;
  readonly capability?: string | null;
  readonly state: string;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly latency_ms?: number | null;
  readonly error_message?: string | null;
  readonly blocked_reason?: string | null;
  readonly lifecycle_stage?: string | null;
  readonly gate_kind?: string | null;
  readonly gate_id?: string | null;
  readonly gate_state?: string | null;
  readonly gate_anchor_count?: number | null;
  readonly gate_reason?: string | null;
  readonly attempt?: number | null;
  readonly attempts?: number | null;
  readonly max_attempts?: number | null;
  readonly confidence?: number | null;
  readonly queued_at?: string | null;
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
  readonly anchor_count?: number | null;
  readonly artifact_count?: number | null;
  readonly depends_on?: readonly string[] | null;
};

export type RunEdge = {
  readonly from_node_key: string;
  readonly to_node_key: string;
  readonly reason: string;
  readonly detail: string;
  readonly is_feedback: boolean;
};

export type GraphRunSummary = {
  readonly graphRunId: string;
  readonly graphId: string;
  readonly goal: string;
  readonly topology: string;
  readonly riskLevel: string;
  readonly projectId: string;
  readonly state: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly nodes: readonly RunNode[];
  readonly edges?: readonly RunEdge[];
  readonly artifactCounts?: Readonly<Record<string, number>>;
  readonly isLifecycle: boolean;
  readonly iteration: number;
  readonly maxIterations: number;
};

export type StageGate = {
  readonly id: string;
  readonly nodeKey: string;
  readonly kind: GateKind;
  readonly state: GateState;
  readonly anchorCount: number;
  readonly reason: string | null;
};

export type StageNodeView = {
  readonly nodeKey: string;
  readonly job: string | null;
  readonly executor: string | null;
  readonly capability: string | null;
  readonly status: NodeDisplayStatus;
  readonly provider: string | null;
  readonly model: string | null;
  readonly latencyMs: number | null;
  readonly attempt: number;
  readonly attempts: number;
  readonly maxAttempts: number | null;
  readonly anchorCount: number;
  readonly artifactCount: number;
  readonly dependsOn: readonly string[];
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** The node's own words for why it is not progressing, never paraphrased. */
  readonly error: string | null;
  readonly blockedReason: string | null;
  readonly gate: StageGate | null;
  /** Which parallel band this node sits in, counted inside the stage only. */
  readonly depth: number;
};

export type StageIssue = {
  readonly nodeKey: string;
  readonly detail: string;
};

export type StageHandoff = {
  readonly stage: SdlcStage;
  readonly number: number;
  readonly title: string;
  readonly slug: string;
  readonly artifact: string;
  readonly nodes: readonly { readonly nodeKey: string; readonly status: NodeDisplayStatus }[];
};

export type StageRunView = {
  readonly graphRunId: string;
  readonly graphId: string;
  readonly goal: string;
  readonly projectId: string;
  readonly runState: string;
  readonly isLifecycle: boolean;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly status: StageStatus;
  readonly nodes: readonly StageNodeView[];
  /** Terminal nodes over total nodes. Never a percentage of nothing. */
  readonly progress: { readonly done: number; readonly total: number };
  /** The widest band of nodes in this stage that can run at the same time. */
  readonly parallelism: number;
  readonly gates: readonly StageGate[];
  readonly issues: readonly StageIssue[];
  readonly anchorCount: number;
  readonly artifactCount: number;
  /** Distinct provider/model pairs the run actually recorded for this stage. */
  readonly agents: readonly { readonly provider: string; readonly model: string | null }[];
  readonly dependencies: readonly RunEdge[];
  readonly input: StageHandoff | null;
  readonly output: StageHandoff | null;
  /** True when a later stage's rejection routes work back to this one. */
  readonly repairing: boolean;
};

function asStage(value: unknown): SdlcStage | null {
  return isSdlcStage(value) ? value : null;
}

function gateOf(node: RunNode): StageGate | null {
  if (!node.gate_id || !node.gate_state || !node.gate_kind) return null;
  const kind = node.gate_kind === "HUMAN" ? "HUMAN" : "AUTOMATIC";
  const state = node.gate_state as GateState;
  return {
    id: node.gate_id,
    nodeKey: node.node_key,
    kind,
    state,
    anchorCount: node.gate_anchor_count ?? 0,
    reason: node.gate_reason ?? null,
  };
}

/**
 * How deep inside its own stage a node sits.
 *
 * Depth is computed over the stage's *internal* dependencies only. A stage's
 * first band all depend on the previous stage and can therefore run together;
 * counting their cross-stage edges would put every node at a different depth
 * and report a parallelism of one for a stage that fans out three ways.
 */
function depthsWithinStage(nodes: readonly RunNode[]): Map<string, number> {
  const keys = new Set(nodes.map((node) => node.node_key));
  const depths = new Map<string, number>();

  const resolve = (node: RunNode, seen: ReadonlySet<string>): number => {
    const cached = depths.get(node.node_key);
    if (cached !== undefined) return cached;
    // A cycle cannot reach here through a compiled graph, but this function is
    // also handed rows straight from a database that a future template could
    // populate differently. Stopping is better than recursing forever.
    if (seen.has(node.node_key)) return 0;

    const inside = (node.depends_on ?? []).filter((key) => keys.has(key));
    const nextSeen = new Set(seen).add(node.node_key);
    const depth = inside.length === 0
      ? 0
      : Math.max(
        ...inside.map((key) => {
          const upstream = nodes.find((candidate) => candidate.node_key === key);
          return upstream ? resolve(upstream, nextSeen) + 1 : 0;
        }),
      );
    depths.set(node.node_key, depth);
    return depth;
  };

  for (const node of nodes) resolve(node, new Set());
  return depths;
}

function handoff(stage: SdlcStage | null, nodes: readonly RunNode[]): StageHandoff | null {
  if (stage === null) return null;
  const definition = stageDefinition(stage);
  return {
    stage,
    number: definition.number,
    title: definition.title,
    slug: definition.slug,
    artifact: definition.artifact,
    nodes: nodes
      .filter((node) => asStage(node.lifecycle_stage) === stage)
      .map((node) => ({
        nodeKey: node.node_key,
        status: nodeDisplayStatus({
          state: node.state,
          stage,
          gateOpen: node.gate_state === "OPEN",
        }),
      })),
  };
}

/**
 * One stage, as one run recorded it. Null when the run has no node in the stage
 * at all — which is a real answer and not an empty one: it means this run's
 * plan never included the stage.
 */
export function stageRunView(stage: SdlcStage, run: GraphRunSummary): StageRunView | null {
  const definition = stageDefinition(stage);
  const inStage = run.nodes.filter((node) => asStage(node.lifecycle_stage) === stage);
  if (inStage.length === 0) return null;

  const depths = depthsWithinStage(inStage);
  const nodes: StageNodeView[] = inStage.map((node) => {
    const gate = gateOf(node);
    return {
      nodeKey: node.node_key,
      job: node.job ?? null,
      executor: node.executor ?? null,
      capability: node.capability ?? null,
      status: nodeDisplayStatus({
        state: node.state,
        stage,
        gateOpen: gate?.state === "OPEN",
      }),
      provider: node.provider ?? null,
      model: node.model ?? null,
      latencyMs: node.latency_ms ?? null,
      attempt: node.attempt ?? 0,
      attempts: node.attempts ?? 1,
      maxAttempts: node.max_attempts ?? null,
      anchorCount: node.anchor_count ?? 0,
      artifactCount: node.artifact_count ?? 0,
      dependsOn: node.depends_on ?? [],
      startedAt: node.started_at ?? null,
      completedAt: node.completed_at ?? null,
      error: node.error_message ?? null,
      blockedReason: node.blocked_reason ?? null,
      gate,
      depth: depths.get(node.node_key) ?? 0,
    };
  });

  const bands = new Map<number, number>();
  for (const node of nodes) bands.set(node.depth, (bands.get(node.depth) ?? 0) + 1);

  /*
   * A stage is repairing when a *later* stage was rejected and the return table
   * sends that work back here. Asked of the table rather than of a flag,
   * because the flag would have to be written by whoever rejected the gate and
   * a rejection is not always followed by a write.
   */
  const repairing = run.nodes.some((node) => {
    const from = asStage(node.lifecycle_stage);
    if (from === null || from === stage) return false;
    if (node.gate_state !== "REJECTED") return false;
    return REJECTION_RETURNS_TO[from] === stage;
  });

  const agents = new Map<string, { provider: string; model: string | null }>();
  for (const node of nodes) {
    if (!node.provider) continue;
    agents.set(`${node.provider}::${node.model ?? ""}`, {
      provider: node.provider,
      model: node.model,
    });
  }

  const issues: StageIssue[] = [];
  for (const node of nodes) {
    if (node.error) issues.push({ nodeKey: node.nodeKey, detail: node.error });
    else if (node.blockedReason) issues.push({ nodeKey: node.nodeKey, detail: node.blockedReason });
  }
  for (const gate of nodes.map((node) => node.gate)) {
    if (gate?.state === "REJECTED") {
      issues.push({
        nodeKey: gate.nodeKey,
        detail: gate.reason
          ?? `Rejected at the ${definition.title} gate, which returns the work to `
            + `${stageDefinition(REJECTION_RETURNS_TO[stage]).title}.`,
      });
    }
  }

  const keys = new Set(nodes.map((node) => node.nodeKey));
  const dependencies = (run.edges ?? []).filter(
    (edge) => keys.has(edge.from_node_key) || keys.has(edge.to_node_key),
  );

  return {
    graphRunId: run.graphRunId,
    graphId: run.graphId,
    goal: run.goal,
    projectId: run.projectId,
    runState: run.state,
    isLifecycle: run.isLifecycle,
    iteration: run.iteration,
    maxIterations: run.maxIterations,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: stageStatus({
      statuses: nodes.map((node) => node.status),
      repairing,
      isFinalStage: nextStage(stage) === null,
    }),
    nodes,
    progress: {
      done: nodes.filter((node) => isTerminalStatus(node.status)).length,
      total: nodes.length,
    },
    parallelism: Math.max(...bands.values()),
    gates: nodes.map((node) => node.gate).filter((gate) => gate !== null),
    issues,
    anchorCount: nodes.reduce((total, node) => total + node.anchorCount, 0),
    artifactCount: nodes.reduce((total, node) => total + node.artifactCount, 0),
    agents: [...agents.values()],
    dependencies,
    input: handoff(previousStage(stage), run.nodes),
    output: handoff(nextStage(stage), run.nodes),
    repairing,
  };
}

export type StagePageView = {
  readonly definition: ReturnType<typeof stageDefinition>;
  /** The most recent run that includes this stage, or null if none does. */
  readonly current: StageRunView | null;
  /** Earlier runs that included it, newest first, for the history list. */
  readonly earlier: readonly StageRunView[];
  /** The stage's status, which is "Not Started" when no run has reached it. */
  readonly status: StageStatus;
};

/**
 * The whole page, from the runs the organization has recorded.
 *
 * `runs` arrives newest-first from `list_graph_runs`; the first one that
 * actually contains this stage is the current one. A run that never planned the
 * stage is not evidence about it either way, so it is skipped rather than
 * counted as a stage that did not start.
 */
export function stagePageView(
  stage: SdlcStage,
  runs: readonly GraphRunSummary[],
): StagePageView {
  const views = runs
    .map((run) => stageRunView(stage, run))
    .filter((view) => view !== null);

  return {
    definition: stageDefinition(stage),
    current: views[0] ?? null,
    earlier: views.slice(1),
    status: views[0]?.status ?? "Not Started",
  };
}

/**
 * Every stage's status in one pass, for the navigation and the overview.
 *
 * Uses the same derivation as the stage page, so the badge beside "6 Build" in
 * the sidebar and the heading on the Build page cannot disagree.
 */
export function lifecycleStatuses(
  runs: readonly GraphRunSummary[],
): Readonly<Record<SdlcStage, StageStatus>> {
  const statuses = {} as Record<SdlcStage, StageStatus>;
  for (const stage of SDLC_STAGES) {
    statuses[stage] = stagePageView(stage, runs).status;
  }
  return statuses;
}
