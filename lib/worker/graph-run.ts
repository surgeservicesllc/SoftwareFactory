import { z } from "zod";

import { DEFAULT_BACKOFF, realSleep, retryDelayMs, type BackoffPolicy, type Sleep } from "@/lib/graph/backoff";
import { compileGraph, type CompiledGraph, type CompiledNode } from "@/lib/graph/compiler";
import type { GraphBudget } from "@/lib/graph/budgets";
import { defineNode } from "@/lib/graph/contracts";
import type { ProposedEdge } from "@/lib/graph/dependencies";
import { runGraph, type NodeExecutionResult, type RunResult } from "@/lib/graph/runner";
import { DEFAULT_RETRY_POLICY, type ResourceRef } from "@/lib/graph/types";
import type { VerificationLens, VerificationVerdict } from "@/lib/graph/verification";
import { validateStageArtifact } from "@/lib/sdlc/artifacts";
import { isSdlcStage, nodeDisplayStatus, stageDefinition } from "@/lib/sdlc/lifecycle";
import {
  decideNextAction,
  type OrchestratorDecision,
  type OrchestratorNode,
} from "@/lib/sdlc/orchestrator";
import { deriveVerdict, verificationLensFor } from "@/lib/worker/verification-from-node";

/**
 * From a claimed graph to a finished, persisted run.
 *
 * `claim_planned_graph` hands the worker everything in one projection — run,
 * budget, nodes with contracts and node_run ids, edges — so this module can
 * be pure: it parses that projection, compiles it back through the same
 * compiler the console previews with, and drives the engine's runner with an
 * injected executor, persisting every node transition through an injected
 * store. No hidden context crosses the boundary; the projection IS the edge.
 */

const resourceSchema = z.object({ kind: z.string(), id: z.string() });

const claimedNodeSchema = z.object({
  node_run_id: z.string().uuid(),
  node_key: z.string().min(1),
  job: z.string().min(1),
  executor: z.enum(["DETERMINISTIC", "MODEL", "ANCHOR"]),
  capability: z.string().min(1),
  model_tier: z.string().nullish(),
  risk_level: z.string().nullish(),
  timeout_ms: z.number().int().positive(),
  max_attempts: z.number().int().positive(),
  allow_provider_fallback: z.boolean(),
  // .catch(false): a projection from before the column existed simply has
  // no tolerance, which is exactly what false says.
  tolerates_partial_inputs: z.boolean().catch(false),
  /*
   * The lifecycle fields, all tolerant of a projection that predates them.
   *
   * `node_id` rather than only `node_run_id` because a gate is keyed to the
   * graph node: the run id changes on every claim and the node id does not,
   * which is what lets an approval outlive the run that asked for it.
   */
  node_id: z.string().uuid().nullish(),
  lifecycle_stage: z
    .enum(["REQUIREMENT", "DISCOVER", "EVALUATE", "DECIDE", "ARCHITECT", "BUILD", "REVIEW", "TEST", "DEPLOY", "MONITOR"])
    .nullish()
    .catch(null),
  gate_kind: z.enum(["AUTOMATIC", "HUMAN"]).nullish().catch(null),
  gate_state: z.enum(["OPEN", "APPROVED", "REJECTED"]).nullish().catch(null),
  input_schema: z.unknown().nullish(),
  output_schema: z.unknown().nullish(),
  reads: z.array(resourceSchema).nullish(),
  writes: z.array(resourceSchema).nullish(),
  acceptance_criteria: z.unknown().nullish(),
});

const claimedEdgeSchema = z.object({
  from_node_key: z.string().min(1),
  to_node_key: z.string().min(1),
  reason: z.string().nullish(),
  detail: z.string().nullish(),
});

const claimedGraphSchema = z.object({
  graph_run_id: z.string().uuid(),
  graph_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  goal: z.string().min(1),
  topology: z.string(),
  risk_level: z.string(),
  // Null when the project has no repository linked; absent in a projection
  // from before the column existed. Both mean "nothing to contradict".
  project_repository: z.string().nullish(),
  budget: z.object({
    max_nodes: z.number().int().positive().catch(50),
    max_concurrent_nodes: z.number().int().positive().catch(8),
    max_duration_ms: z.number().int().positive().catch(1_800_000),
    max_retries: z.number().int().nonnegative().catch(10),
    max_discovery_rounds: z.number().int().nonnegative().catch(5),
    max_tokens: z.number().int().positive().nullish(),
    max_cost_micros: z.number().int().positive().nullish(),
  }).nullish(),
  nodes: z.array(claimedNodeSchema).min(1),
  edges: z.array(claimedEdgeSchema),
  /*
   * The lifecycle's own counters, all tolerant of a projection that predates
   * them for the same reason the node's lifecycle fields are: a worker running
   * against a database where 20260821000200 has not been applied must drive the
   * graph rather than refuse to parse it. A graph that says nothing is not a
   * lifecycle, which is what these defaults say.
   */
  is_lifecycle: z.boolean().nullish().catch(false),
  iteration: z.number().int().positive().nullish().catch(1),
  max_iterations: z.number().int().positive().nullish().catch(1),
});

export type ClaimedGraph = z.infer<typeof claimedGraphSchema>;

export function parseClaimedGraph(claim: unknown):
  | { readonly ok: true; readonly graph: ClaimedGraph }
  | { readonly ok: false; readonly detail: string } {
  const parsed = claimedGraphSchema.safeParse(claim);
  if (!parsed.success) {
    return { ok: false, detail: `The claim projection is not usable: ${parsed.error.issues[0]?.message ?? "unknown shape"}.` };
  }
  return { ok: true, graph: parsed.data };
}

const RISKS = new Set(["GREEN", "YELLOW", "RED"]);

function riskFrom(value: string | null | undefined): "GREEN" | "YELLOW" | "RED" {
  const upper = (value ?? "GREEN").toUpperCase();
  return (RISKS.has(upper) ? upper : "GREEN") as "GREEN" | "YELLOW" | "RED";
}

/**
 * Recompile the stored rows through the same compiler the console previews
 * with. Dependencies are recovered from the stored edges — an edge exists
 * only because a downstream node consumes upstream output, so `dependsOn`
 * is exactly the set of incoming edges.
 */
export function compileClaimedGraph(claim: ClaimedGraph):
  | { readonly ok: true; readonly graph: CompiledGraph }
  | { readonly ok: false; readonly detail: string } {
  const dependsOn = new Map<string, string[]>();
  for (const edge of claim.edges) {
    const into = dependsOn.get(edge.to_node_key) ?? [];
    into.push(edge.from_node_key);
    dependsOn.set(edge.to_node_key, into);
  }

  const nodes = claim.nodes.map((node) =>
    defineNode({
      nodeId: node.node_key,
      job: node.job,
      executor: node.executor,
      capability: node.capability as Parameters<typeof defineNode>[0]["capability"],
      inputSchema: z.unknown(),
      // Output validation for worker-executed nodes is the provider's
      // structured-output contract; the stored jsonb schema is display
      // metadata here, not a second validator pretending to be one.
      outputSchema: z.unknown(),
      dependsOn: dependsOn.get(node.node_key) ?? [],
      reads: (node.reads ?? []) as readonly ResourceRef[],
      writes: (node.writes ?? []) as readonly ResourceRef[],
      risk: riskFrom(node.risk_level),
      timeoutMs: node.timeout_ms,
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: node.max_attempts },
      toleratesPartialInputs: node.tolerates_partial_inputs,
    }),
  );

  const proposedEdges: ProposedEdge[] = claim.edges.map((edge) => ({
    from: edge.from_node_key,
    to: edge.to_node_key,
  }));

  const compiled = compileGraph({
    goal: claim.goal,
    nodes,
    proposedEdges,
    risk: riskFrom(claim.risk_level),
  });
  if (!compiled.ok) {
    const first = compiled.errors[0];
    return { ok: false, detail: `The stored graph no longer compiles: ${first?.detail ?? first?.code ?? "unknown error"}.` };
  }
  return { ok: true, graph: compiled.graph };
}

export function budgetFromClaim(claim: ClaimedGraph): GraphBudget {
  const budget = claim.budget;
  return {
    maxNodes: budget?.max_nodes ?? 50,
    maxConcurrentNodes: budget?.max_concurrent_nodes ?? 8,
    maxDurationMs: budget?.max_duration_ms ?? 1_800_000,
    maxRetries: budget?.max_retries ?? 10,
    maxDiscoveryRounds: budget?.max_discovery_rounds ?? 5,
    maxTokens: budget?.max_tokens ?? undefined,
    maxCostMicros: budget?.max_cost_micros ?? undefined,
  };
}

/**
 * Whether the tree this worker is checked out on is the wrong one for a
 * claimed graph.
 *
 * A read-only analysis worker reads whatever repository it was checked out
 * on. If the graph's project is bound to a different one, running it anyway
 * produces confident findings about the wrong codebase filed under this
 * project — a wrong answer shaped exactly like a right one. A project with
 * no repository linked has nothing to contradict, and a worker that cannot
 * name its own checkout cannot claim a mismatch either; both proceed.
 */
export function repositoryMismatch(
  projectRepository: string | null | undefined,
  checkoutRepository: string | null | undefined,
): string | null {
  const wanted = (projectRepository ?? "").trim();
  const checkout = (checkoutRepository ?? "").trim();
  if (!wanted || !checkout) return null;
  if (wanted.toLowerCase() === checkout.toLowerCase()) return null;
  return `This graph's project is bound to ${wanted}, but the worker is checked out on ${checkout}. `
    + "A read-only analysis of the wrong repository would be a wrong answer, so the run stops here.";
}

/**
 * Which kind of artifact a node's output is.
 *
 * The schema distinguishes RAW evidence from a REDUCED (lossy) view and a
 * SYNTHESIS built on top of both, and labelling everything RAW throws that
 * distinction away — a reviewer auditing a run could no longer tell which
 * rows are the original findings and which are derived from them. The node's
 * own declaration answers it: an anchor produces measured evidence, a
 * deterministic extraction is exactly the reduce step, and synthesis or
 * reporting nodes produce the written-up view.
 */
export function artifactKindForNode(
  node: Pick<CompiledNode, "executor" | "capability">,
): "RAW" | "REDUCED" | "SYNTHESIS" | "ANCHOR" {
  if (node.executor === "ANCHOR") return "ANCHOR";
  if (node.capability === "synthesis" || node.capability === "reporting") return "SYNTHESIS";
  if (node.executor === "DETERMINISTIC" && node.capability === "extraction") return "REDUCED";
  return "RAW";
}

/** The persistence the runner needs, injected so this module stays pure. */
export type GraphRunStore = {
  readonly recordNodeState: (
    nodeRunId: string,
    state: "RUNNING" | "COMPLETED" | "VERIFYING" | "FAILED" | "CANCELLED" | "SKIPPED",
    detail?: string | null,
    execution?: {
      provider?: string;
      model?: string;
      latencyMs?: number;
      confidence?: number;
    },
  ) => Promise<void>;
  readonly recordArtifact: (
    graphRunId: string,
    kind: "RAW" | "REDUCED" | "SYNTHESIS" | "ANCHOR",
    payload: unknown,
    nodeRunId?: string | null,
  ) => Promise<void>;
  /**
   * A reviewing node's verdict about one subject it consumed. Optional so a
   * store written before verification existed still satisfies this contract
   * rather than failing a run over a capability it never had.
   */
  readonly recordVerification?: (
    subjectNodeRunId: string,
    lens: VerificationLens,
    verdict: VerificationVerdict,
    evidence: readonly string[],
    verifierProvider: string | null,
  ) => Promise<void>;
  /**
   * Open the gate a finished node waits at, and report how it stands.
   *
   * Optional for the same reason `recordVerification` is: a store written
   * before gates existed still satisfies this contract rather than failing a
   * run over a capability it never had.
   */
  readonly openGate?: (
    nodeId: string,
    graphRunId: string,
    anchorCount: number,
  ) => Promise<void>;
  /**
   * Record what one stage handed the next, and whether it satisfied the
   * receiving node's contract at the moment it was handed over.
   *
   * Optional for the same reason `openGate` is: a store written before handoffs
   * existed still satisfies this contract rather than failing a run over a
   * capability it never had.
   */
  readonly recordHandoff?: (input: {
    readonly graphRunId: string;
    readonly toNodeId: string;
    readonly fromNodeRunId: string | null;
    readonly contractValid: boolean;
    readonly validationIssues: readonly string[];
    readonly payload: unknown;
    readonly nextAction: string | null;
  }) => Promise<void>;
  readonly completeRun: (
    graphRunId: string,
    state: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED" | "BUDGET_STOPPED",
    hadPartialInput: boolean,
    detail?: string | null,
    usage?: { readonly tokensUsed?: number; readonly costMicros?: number },
  ) => Promise<void>;
};

export type GraphRunSummary = {
  readonly outcome: RunResult["outcome"];
  readonly finalState: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED" | "BUDGET_STOPPED";
  readonly nodesSucceeded: number;
  readonly nodesFailed: number;
  readonly incompleteness: string | null;
  /**
   * True when the run produced nothing because the provider refused every
   * attempt (session/rate limit). The run closed CANCELLED — void, not a
   * consumed chance — and the caller should stop draining rather than burn
   * further graphs against a credential that will refuse them too.
   */
  readonly capacityWithheld: boolean;
  /**
   * Node keys left waiting at a gate. Non-empty means the run stopped because
   * a decision is owed, not because anything went wrong.
   */
  readonly awaitingGate: readonly string[];
  /**
   * What the lifecycle should do next, and whether it has earned the right to
   * be called complete.
   *
   * Present for every graph, lifecycle or not — an audit template's answer is
   * simply `COMPLETE` or `HALTED` with a vacuous acceptance report, which is a
   * true statement about a graph with no stages rather than an absence.
   */
  readonly orchestration: OrchestratorDecision;
};

/**
 * What a node's incoming edges delivered. An edge is a data dependency, so
 * the executor receives the actual upstream outputs — not just the fact that
 * they exist — and an explicit list of dependencies that contributed nothing,
 * so a fan-in can state its own incompleteness instead of running blind.
 */
export type NodeInputs = Readonly<{
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly missing: readonly string[];
}>;

/**
 * Drive one claimed graph to a persisted conclusion.
 *
 * Failure containment lives in the engine (a failed node blocks only its
 * dependents; independent branches keep running) — this layer's job is to
 * make every transition durable and to close the run with the same honesty
 * rules the member path enforces: a run that lost inputs is PARTIAL, never
 * COMPLETED.
 */
export type RunClaimedGraphOptions = {
  /**
   * The wait between a failed attempt and the next one.
   *
   * Injected, and injected *here* rather than in `lib/graph/runner.ts`, which is
   * deliberately free of I/O — and where a wait would sit inside the scheduling
   * round and make independent work queue behind a retry. At this layer the
   * delay is inside one node's promise, and `Promise.all` keeps its siblings
   * running beside it.
   */
  readonly sleep?: Sleep;
  readonly backoff?: BackoffPolicy;
  /** Returns [0, 1). A parameter so a test can pin the jitter. */
  readonly random?: () => number;
};

export async function runClaimedGraph(
  claim: ClaimedGraph,
  compiled: CompiledGraph,
  store: GraphRunStore,
  executeNode: (node: CompiledNode, attempt: number, inputs: NodeInputs) => Promise<NodeExecutionResult>,
  options: RunClaimedGraphOptions = {},
): Promise<GraphRunSummary> {
  const sleep = options.sleep ?? realSleep;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const random = options.random ?? Math.random;
  const nodeRunIds = new Map(claim.nodes.map((node) => [node.node_key, node.node_run_id]));
  const started = Date.now();

  // Incoming edges per node: the data each node is owed by its upstreams.
  const incoming = new Map<string, string[]>();
  // And outgoing, which is what a handoff travels along.
  const outgoing = new Map<string, string[]>();
  for (const edge of claim.edges) {
    const into = incoming.get(edge.to_node_key) ?? [];
    into.push(edge.from_node_key);
    incoming.set(edge.to_node_key, into);

    const outOf = outgoing.get(edge.from_node_key) ?? [];
    outOf.push(edge.to_node_key);
    outgoing.set(edge.from_node_key, outOf);
  }
  const claimedByKey = new Map(claim.nodes.map((node) => [node.node_key, node]));
  const completedOutputs = new Map<string, unknown>();
  /*
   * Observations per node, recorded as they happen.
   *
   * The orchestrator asks this at the end, and it cannot be recovered then:
   * `anchorsFor` needs the node's *output*, which is gone once the run has
   * moved on. Counted here, where the output is still in hand.
   */
  const anchorsByNode = new Map<string, number>();

  // Final-attempt failures, split by kind: a run whose every failure was a
  // capacity refusal never truly executed and must not spend a chance.
  let finalFailures = 0;
  let capacityFinalFailures = 0;
  const awaitingGate: string[] = [];

  const result = await runGraph(compiled, budgetFromClaim(claim), {
    executeNode: async (node, attempt) => {
      const nodeRunId = nodeRunIds.get(node.nodeKey);
      if (attempt === 1) {
        if (nodeRunId) await store.recordNodeState(nodeRunId, "RUNNING");
      } else {
        /*
         * A retry waits before it runs.
         *
         * The engine bounds how many times a node may attempt its work and
         * bounded nothing about how fast. Against the two faults that actually
         * happen — a rate limit and a provider outage — every retry arrived
         * while the cause was still true and burned an attempt proving it.
         *
         * The wait is recorded as its own RUNNING transition rather than being
         * silent, because a node that is deliberately pausing and a node that
         * has hung look identical from the outside otherwise, and
         * `graph_events` is where someone would go to tell them apart.
         */
        const delayMs = retryDelayMs(attempt, backoff, random);
        if (nodeRunId) {
          await store.recordNodeState(
            nodeRunId,
            "RUNNING",
            `Attempt ${attempt} of ${node.maxAttempts}, after ${delayMs}ms of backoff.`,
          );
        }
        await sleep(delayMs);
      }
      const outputs: Record<string, unknown> = {};
      const missing: string[] = [];
      for (const dependency of incoming.get(node.nodeKey) ?? []) {
        if (completedOutputs.has(dependency)) {
          outputs[dependency] = completedOutputs.get(dependency);
        } else {
          missing.push(dependency);
        }
      }
      const outcome = await executeNode(node, attempt, { outputs, missing });
      if (outcome.status === "SUCCEEDED") {
        completedOutputs.set(node.nodeKey, outcome.output);
        anchorsByNode.set(node.nodeKey, anchorsFor(node, outcome.output));
      }
      if (nodeRunId) {
        if (outcome.status === "SUCCEEDED") {
          /*
           * A gated node does not complete on its own say-so.
           *
           * Its work is done and its output is recorded — that much is real and
           * must survive — but the stage is not finished until the gate is
           * decided. So the artifact is written first, the node goes to
           * VERIFYING rather than COMPLETED, the gate opens, and the node is
           * reported to the engine as not-completed so nothing downstream
           * starts on an undecided result.
           *
           * `gate_state` comes from the claim, which reads the gate keyed to
           * the graph node. APPROVED means a person already said yes on an
           * earlier run and this one may pass straight through. REJECTED means
           * they said no, and the node fails so its dependents block.
           */
          const claimed = claim.nodes.find((entry) => entry.node_key === node.nodeKey);
          const gateKind = claimed?.gate_kind ?? null;
          const gateState = claimed?.gate_state ?? null;

          if (gateKind !== null && gateState !== "APPROVED") {
            await store.recordArtifact(
              claim.graph_run_id, artifactKindForNode(node), outcome.output, nodeRunId,
            );

            if (gateState === "REJECTED") {
              finalFailures += 1;
              await store.recordNodeState(
                nodeRunId,
                "FAILED",
                `${claimed?.lifecycle_stage ?? "This stage"} was rejected at its gate.`,
              );
              return {
                status: "FAILED",
                error: "Rejected at its lifecycle gate.",
                retryable: false,
              };
            }

            await store.recordNodeState(nodeRunId, "VERIFYING", null, {
              provider: outcome.provider,
              model: outcome.model,
              latencyMs: outcome.latencyMs,
              // The node did its work; only the decision is outstanding. Its
              // confidence belongs to the work, so it is recorded here rather
              // than held back until someone answers the gate.
              confidence: outcome.confidence,
            });
            if (claimed?.node_id && store.openGate) {
              await store.openGate(
                claimed.node_id,
                claim.graph_run_id,
                anchorsFor(node, outcome.output),
              );
            }
            awaitingGate.push(node.nodeKey);
            return {
              status: "FAILED",
              error: `Awaiting a ${gateKind === "HUMAN" ? "human" : "automatic"} decision at the `
                + `${claimed?.lifecycle_stage ?? "lifecycle"} gate.`,
              retryable: false,
              gateHeld: true,
            };
          }

          await store.recordNodeState(nodeRunId, "COMPLETED", null, {
            provider: outcome.provider,
            model: outcome.model,
            latencyMs: outcome.latencyMs,
            confidence: outcome.confidence,
          });
          await store.recordArtifact(claim.graph_run_id, artifactKindForNode(node), outcome.output, nodeRunId);

          /*
           * A handoff is an edge that leaves the stage.
           *
           * An edge between two nodes of the same stage is internal plumbing —
           * DISCOVER's shortlist reducing its three observers — and recording
           * one as a handoff would bury the boundary that matters under the
           * ones that do not. A stage handoff is where a *different* stage
           * starts working from this output, and that is the moment worth
           * being able to reconstruct after a restart.
           *
           * `contract_valid` is decided here and stored, not recomputed later.
           * The receiving stage's input contract is the sending stage's
           * package, and checking it later would test today's schema against
           * yesterday's payload — a different question whose answer changes
           * every time a contract is edited.
           *
           * A run whose provider is not connected produces nothing that
           * satisfies these schemas, and it is recorded as invalid with the
           * reasons rather than skipped: "this stage handed the next one
           * something the next one cannot read" is the finding, not an
           * omission.
           */
          const senderStage = claimedByKey.get(node.nodeKey)?.lifecycle_stage ?? null;
          if (store.recordHandoff && isSdlcStage(senderStage)) {
            const validation = validateStageArtifact(senderStage, outcome.output);
            for (const downstreamKey of outgoing.get(node.nodeKey) ?? []) {
              const downstream = claimedByKey.get(downstreamKey);
              const receiverStage = downstream?.lifecycle_stage ?? null;
              if (!downstream?.node_id) continue;
              if (receiverStage === senderStage) continue;

              await store.recordHandoff({
                graphRunId: claim.graph_run_id,
                toNodeId: downstream.node_id,
                fromNodeRunId: nodeRunId,
                contractValid: validation.valid,
                validationIssues: validation.issues,
                payload: outcome.output,
                nextAction: isSdlcStage(receiverStage)
                  ? `${stageDefinition(receiverStage).title}: ${downstream.job}`
                  : downstream.job,
              });
            }
          }

          // A reviewing node has just judged its inputs. Recording that as a
          // verification — of which subject, under which lens, with the
          // evidence it cited — is what makes the judgement auditable later.
          // It is derived from the answer already given, never a second call:
          // asking again would pay twice for one opinion.
          const lens = verificationLensFor(node);
          if (lens && store.recordVerification) {
            const derived = deriveVerdict(outcome.output);
            if (derived) {
              for (const dependency of incoming.get(node.nodeKey) ?? []) {
                const subject = nodeRunIds.get(dependency);
                // Only subjects that actually produced something can be
                // judged; a dependency that never answered was not reviewed.
                if (!subject || !completedOutputs.has(dependency)) continue;
                await store.recordVerification(
                  subject, lens, derived.verdict, derived.evidence, outcome.provider ?? null,
                );
              }
            }
          }
        } else if (
          !outcome.retryable
          || attempt >= (compiled.nodes.find((n) => n.nodeKey === node.nodeKey)?.maxAttempts ?? 1)
        ) {
          // Only the final attempt's failure is terminal; a retry in flight
          // is still a RUNNING node, and marking it FAILED early would make
          // the recovery invisible. A non-retryable failure IS the final
          // attempt, whatever the attempt counter says.
          // A gate-held node reported FAILED so the engine would stop its
          // dependents; it is not a failure and must not be counted as one.
          if (outcome.gateHeld !== true) {
            finalFailures += 1;
            if (outcome.capacityWithheld === true) capacityFinalFailures += 1;
          }
          await store.recordNodeState(nodeRunId, "FAILED", outcome.error, {
            provider: outcome.provider,
            model: outcome.model,
            latencyMs: outcome.latencyMs,
          });
        }
      }
      return outcome;
    },
    elapsedMs: () => Date.now() - started,
  });

  // Nodes the engine never dispatched (blocked by failed dependencies,
  // budget stops) are closed as SKIPPED so the run accounts for every node —
  // fan-in honesty made durable.
  for (const [nodeKey, nodeState] of result.states) {
    const nodeRunId = nodeRunIds.get(nodeKey);
    if (!nodeRunId) continue;
    if (nodeState === "PENDING" || nodeState === "READY" || nodeState === "BLOCKED") {
      await store.recordNodeState(
        nodeRunId,
        "SKIPPED",
        "Never dispatched: an upstream dependency failed or the budget stopped the run.",
      );
    }
  }

  let failed = 0;
  let succeeded = 0;
  for (const [nodeKey, state] of result.states) {
    if (state === "COMPLETED") succeeded += 1;
    // A gate-held node is FAILED in the engine's map because that is the only
    // way to stop its dependents, but reporting it as a failure would tell a
    // reader something went wrong when a decision is simply owed.
    if (state === "FAILED" && !awaitingGate.includes(nodeKey)) failed += 1;
  }

  // A run in which nothing succeeded and every terminal failure was a
  // provider capacity refusal never truly executed: it closes CANCELLED so
  // the graph keeps its chances for a worker the provider will actually
  // fuel. If anything succeeded, the run is a real (partial) answer and is
  // judged as one.
  const capacityVoided = succeeded === 0
    && finalFailures > 0
    && capacityFinalFailures === finalFailures;

  const finalState: GraphRunSummary["finalState"] = capacityVoided
    ? "CANCELLED"
    : result.outcome === "COMPLETED"
      ? "COMPLETED"
      : result.outcome === "FAILED"
        ? "FAILED"
        : result.outcome === "BUDGET_STOPPED"
          ? "BUDGET_STOPPED"
          : "PARTIAL";

  /*
   * What the lifecycle should do next, decided rather than assumed.
   *
   * The orchestrator existed and nothing called it, which meant the rule it
   * enforces — that a lifecycle is not done because its nodes finished, and
   * every stage needing anchored evidence must have some — was written down and
   * unapplied. This is the call. Its answer is recorded in the run's closing
   * sentence and returned to the caller.
   *
   * What it deliberately does not do is *act*. `advance_graph_iteration` is
   * granted to `authenticated` and to nobody else — the worker holds
   * `service_role` and cannot execute it — so an ITERATE decision is reported
   * here and acted on by a member. Making the worker able to iterate a graph on
   * its own authority is a widening of what a background job may do, and it
   * belongs in a reviewed change rather than smuggled in beside this one.
   */
  const orchestratorNodes: OrchestratorNode[] = [];
  for (const [nodeKey, nodeState] of result.states) {
    const claimed = claimedByKey.get(nodeKey);
    const stage = isSdlcStage(claimed?.lifecycle_stage) ? claimed.lifecycle_stage : null;
    const held = awaitingGate.includes(nodeKey);
    orchestratorNodes.push({
      nodeKey,
      stage,
      status: nodeDisplayStatus({ state: nodeState, stage, gateOpen: held }),
      anchorCount: anchorsByNode.get(nodeKey) ?? 0,
      gate: claimed?.gate_kind
        ? {
          id: claimed.node_id ?? nodeKey,
          kind: claimed.gate_kind,
          // A node the worker just halted at has an OPEN gate whatever the
          // claim said, because the claim was read before it opened.
          state: held ? "OPEN" : (claimed.gate_state ?? "PENDING"),
          anchorCount: anchorsByNode.get(nodeKey) ?? 0,
        }
        : null,
    });
  }

  const orchestration = decideNextAction({
    nodes: orchestratorNodes,
    iteration: claim.iteration ?? 1,
    maxIterations: claim.max_iterations ?? 1,
    isLifecycle: claim.is_lifecycle === true,
  });

  const closingDetail = capacityVoided
    ? `The provider withheld capacity (session or rate limit) for every attempt; the run is void. ${result.incompleteness ?? ""}`.trim()
    : [result.incompleteness, `${orchestration.action}: ${orchestration.detail}`]
      .filter((part) => part !== null && part !== "")
      .join(" ");

  await store.completeRun(
    claim.graph_run_id,
    finalState,
    result.incompleteness !== null,
    closingDetail === "" ? null : closingDetail,
    { tokensUsed: result.spend.tokensUsed, costMicros: result.spend.costMicros },
  );

  return {
    outcome: result.outcome,
    finalState,
    nodesSucceeded: succeeded,
    nodesFailed: failed,
    incompleteness: result.incompleteness,
    capacityWithheld: capacityVoided,
    awaitingGate,
    orchestration,
  };
}

/**
 * How many non-model observations back this node's claim.
 *
 * Only an ANCHOR node produces evidence at all: its whole purpose is to report
 * what something that cannot be persuaded observed. A MODEL node's output is a
 * claim about the world, however confident, and counting it here would make
 * the anchor rule self-satisfying — which is the exact failure the rule exists
 * to prevent.
 */
export function anchorsFor(
  node: Pick<CompiledNode, "executor">,
  output: unknown,
): number {
  if (node.executor !== "ANCHOR") return 0;
  if (Array.isArray(output)) return output.length;
  if (output === null || output === undefined) return 0;
  return 1;
}
