import { compileGraph, type CompiledGraph } from "@/lib/graph/compiler";
import { templateNodeContracts, templateStageFor, type GraphTemplate } from "@/lib/graph/templates";
import { isFeedbackTransition, type GateKind, type SdlcStage } from "@/lib/sdlc/lifecycle";
import type { GraphBudget } from "@/lib/graph/budgets";

/**
 * Turn a template into the payload `create_graph_from_plan` expects.
 *
 * This is the seam that was missing. Phase 2B built an engine, a schema and a
 * write boundary, and nothing joined them: no code anywhere called
 * `create_graph_from_plan`, so no graph could ever reach the database. The
 * scorecard called goal 33 "unexercised" for a while, which was wrong — it was
 * unbuilt.
 *
 * Kept pure, and separate from the route, for the usual reason: the interesting
 * failures here are shape failures, and a shape failure should be catchable by a
 * unit test rather than only by a `22P02` from Postgres at run time.
 *
 * The conversion is deliberately mechanical. It does not choose a topology,
 * resolve a conflict, or decide risk — `compileGraph` does all of that, and this
 * copies its answers into the column names the function uses. Anything that
 * looked like a second opinion here would be a second planner, disagreeing
 * silently with the first.
 */

/** The exact JSON shape the SECURITY DEFINER function reads. */
export type PlanNodePayload = {
  readonly node_key: string;
  readonly job: string;
  readonly executor: string;
  readonly capability: string;
  readonly model_tier: string;
  readonly tolerates_partial_inputs: boolean;
  readonly timeout_ms: number;
  readonly max_attempts: number;
  readonly input_schema: Record<string, unknown>;
  readonly output_schema: Record<string, unknown>;
  readonly reads: readonly { kind: string; id: string }[];
  readonly writes: readonly { kind: string; id: string }[];
  /** Null on a template that does not stage its nodes, which is most of them. */
  readonly lifecycle_stage: SdlcStage | null;
  readonly gate_kind: GateKind | null;
};

export type PlanEdgePayload = {
  readonly from_node_key: string;
  readonly to_node_key: string;
  readonly reason: string;
  readonly detail: string;
  /**
   * A feedback edge points backwards through the lifecycle. It is recorded
   * alongside the forward edges but never took part in compilation, so the
   * scheduler still sees an acyclic graph and no node waits on one.
   */
  readonly is_feedback: boolean;
};

export type LaunchPlan = {
  readonly goal: string;
  readonly topology: string;
  /** `risk_level` is a lowercase enum in the database; the engine speaks uppercase. */
  readonly riskLevel: string;
  readonly requiresOwnerApproval: boolean;
  readonly topologyReasons: readonly { code: string; detail: string }[];
  readonly nodes: readonly PlanNodePayload[];
  readonly edges: readonly PlanEdgePayload[];
  readonly budget: Record<string, number>;
  /** True when the template staged its nodes, which is what makes it a lifecycle. */
  readonly isLifecycle: boolean;
  /** Kept so a caller can report what the compiler decided without recompiling. */
  readonly compiled: CompiledGraph;
};

export type LaunchPlanResult =
  | { readonly ok: true; readonly plan: LaunchPlan }
  | { readonly ok: false; readonly errors: readonly string[] };

function resourcePayload(
  refs: readonly { readonly kind: string; readonly id: string }[],
): readonly { kind: string; id: string }[] {
  return refs.map((ref) => ({ kind: ref.kind, id: ref.id }));
}

/**
 * Compile a template and render it as the function's arguments.
 *
 * Returns errors rather than throwing, because a template that will not compile
 * is a 400 for the caller and not a fault in the server.
 */
export function buildLaunchPlan(
  template: GraphTemplate,
  budget: GraphBudget,
  options: {
    /**
     * The request in the person's own words.
     *
     * Absent, the goal is the template's summary — a description of the
     * machinery, which is the right thing to record when someone launched a
     * template rather than asked for something. Present, it is what they typed,
     * stored verbatim in `graphs.goal`, because that column is what every
     * downstream surface shows as "what this run is for" and a paraphrase there
     * would be this system telling someone what they meant.
     */
    readonly goal?: string;
  } = {},
): LaunchPlanResult {
  const requested = options.goal?.trim();
  const result = compileGraph({
    goal: requested && requested.length > 0 ? requested : template.summary,
    nodes: templateNodeContracts(template),
    proposedEdges: template.proposedEdges,
    risk: template.risk,
  });

  if (!result.ok) {
    return { ok: false, errors: result.errors.map((error) => error.detail) };
  }

  const graph = result.graph;
  const nodeKeys = new Set(graph.nodes.map((node) => node.nodeKey));
  const isLifecycle = template.nodes.some((node) => node.lifecycleStage !== undefined);

  /*
   * A feedback edge is checked against the lifecycle before it is recorded.
   *
   * The compiler never sees these — that is the whole reason they are a
   * separate list — so this is the only place a template's claim that an edge
   * points backwards is tested against where its stages actually sit. An edge
   * labelled feedback that runs forwards would be an ordinary dependency the
   * scheduler never enforces: work that silently never waits.
   */
  const feedbackErrors: string[] = [];
  const feedbackEdges: PlanEdgePayload[] = [];
  for (const edge of template.feedbackEdges ?? []) {
    if (!nodeKeys.has(edge.from) || !nodeKeys.has(edge.to)) {
      feedbackErrors.push(`Feedback edge ${edge.from} -> ${edge.to} names a node the graph does not have.`);
      continue;
    }
    const from = templateStageFor(template, edge.from).stage;
    const to = templateStageFor(template, edge.to).stage;
    if (from === null || to === null) {
      feedbackErrors.push(`Feedback edge ${edge.from} -> ${edge.to} joins a node with no lifecycle stage.`);
      continue;
    }
    if (!isFeedbackTransition(from, to)) {
      feedbackErrors.push(`Feedback edge ${edge.from} -> ${edge.to} runs forwards, from ${from} to ${to}.`);
      continue;
    }
    feedbackEdges.push({
      from_node_key: edge.from,
      to_node_key: edge.to,
      reason: edge.reason ?? "DATA",
      detail: edge.detail ?? `${edge.from} reports back to ${edge.to}.`,
      is_feedback: true,
    });
  }
  if (feedbackErrors.length > 0) {
    return { ok: false, errors: feedbackErrors };
  }

  return {
    ok: true,
    plan: {
      goal: graph.goal,
      topology: graph.topology,
      // The engine's `RiskLevel` is uppercase and the `risk_level` enum is
      // lowercase. Getting this backwards produces `invalid input value for
      // enum risk_level`, which names the value but not the layer that sent it.
      riskLevel: graph.risk.toLowerCase(),
      requiresOwnerApproval: graph.requiresOwnerApproval,
      topologyReasons: graph.topologyReasons.map((reason) => ({
        code: reason.code,
        detail: reason.detail,
      })),
      nodes: graph.nodes.map((node) => ({
        node_key: node.nodeKey,
        job: node.job,
        executor: node.executor,
        capability: node.capability,
        model_tier: node.modelTier,
        tolerates_partial_inputs: node.toleratesPartialInputs,
        // The compiled contract's execution envelope. Omitting these let the
        // database defaults silently override what the planner decided.
        timeout_ms: node.timeoutMs,
        max_attempts: node.maxAttempts,
        // The contracts live in the engine's Zod schemas rather than in the
        // database. Sending `{}` records that a contract exists without
        // pretending the database can enforce it — a serialized Zod schema that
        // nothing validates against would be decoration.
        input_schema: {},
        output_schema: {},
        reads: resourcePayload(node.reads),
        writes: resourcePayload(node.writes),
        lifecycle_stage: templateStageFor(template, node.nodeKey).stage,
        gate_kind: templateStageFor(template, node.nodeKey).gate,
      })),
      edges: [
        ...graph.edges.map((edge) => ({
          from_node_key: edge.from,
          to_node_key: edge.to,
          reason: edge.reason,
          detail: edge.detail,
          is_feedback: false,
        })),
        ...feedbackEdges,
      ],
      budget: {
        max_nodes: budget.maxNodes,
        max_concurrent_nodes: budget.maxConcurrentNodes,
        max_duration_ms: budget.maxDurationMs,
        max_retries: budget.maxRetries,
        max_discovery_rounds: budget.maxDiscoveryRounds,
      },
      isLifecycle,
      compiled: graph,
    },
  };
}
