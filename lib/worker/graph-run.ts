import { z } from "zod";

import { compileGraph, type CompiledGraph, type CompiledNode } from "@/lib/graph/compiler";
import type { GraphBudget } from "@/lib/graph/budgets";
import { defineNode, validateNodeOutput } from "@/lib/graph/contracts";
import type { ProposedEdge } from "@/lib/graph/dependencies";
import { runGraph, type NodeExecutionResult, type RunResult } from "@/lib/graph/runner";
import { rehydrateStoredSchema } from "@/lib/graph/stored-schema";
import { DEFAULT_RETRY_POLICY, type ResourceRef } from "@/lib/graph/types";
import type { VerificationVerdict } from "@/lib/graph/verification";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";
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
    .enum(SDLC_STAGES)
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

const phase1cValidationEvidenceSchema = z.object({
  agent_run_id: z.string().uuid(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
  validation_round: z.number().int().min(1).max(3).nullable(),
  validations: z.array(z.object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
    status: z.enum(["passed", "failed", "skipped"]),
    duration_ms: z.number().int().min(0).max(3_600_000),
  }).strict()).max(50),
}).strict();

const requiredCheckNamesSchema = z.array(
  z.string()
    .min(1)
    .max(160)
    .refine((value) => value === value.trim())
    .refine((value) => !value.includes("|")),
).min(1).max(20).refine((value) => new Set(value).size === value.length);

const claimedGraphSchema = z.object({
  graph_run_id: z.string().uuid(),
  graph_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  project_name: z.string().min(1).max(160).refine((value) => value === value.trim()),
  goal: z.string().min(1),
  topology: z.string(),
  risk_level: z.string(),
  // Protocol v2 claims are repository-scoped. Missing identity is a malformed
  // claim, never permission to analyze whichever checkout happens to be open.
  project_repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(201),
  project_default_branch: z.string().min(1).max(255).refine((value) => value === value.trim()),
  /*
   * Durable graph -> Phase 1C lineage. All fields tolerate an older or
   * non-lifecycle projection by becoming null; anchor nodes then record Not
   * Connected. Malformed evidence never becomes a guessed identity.
   */
  template_key: z.string().min(1).max(80).nullish().catch(null),
  template_version: z.number().int().positive().nullish().catch(null),
  template_plan_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullish().catch(null),
  base_branch: z.string().min(1).max(255).nullish().catch(null),
  base_sha: z.string().regex(/^[0-9a-f]{40}$/).nullish().catch(null),
  required_check_names: requiredCheckNamesSchema.nullish().catch(null),
  required_checks_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullish().catch(null),
  phase1c_state: z.enum([
    "GRAPH_READY",
    "COMMAND_RECORDED",
    "PHASE1C_BOUND",
    "PULL_REQUEST_RECORDED",
    "MERGE_RECORDED",
    "DEPLOYMENT_RECORDED",
    "MONITORING_RECORDED",
    "VALIDATED",
  ]).nullish().catch(null),
  phase1c_head_sha: z.string().regex(/^[0-9a-f]{40}$/).nullish().catch(null),
  pull_request_number: z.number().int().positive().nullish().catch(null),
  pull_request_url: z.string().url().max(2_048).nullish().catch(null),
  validation_evidence: phase1cValidationEvidenceSchema.nullish().catch(null),
  merge_commit_sha: z.string().regex(/^[0-9a-f]{40}$/).nullish().catch(null),
  deployment_id: z.string().uuid().nullish().catch(null),
  deployment_url: z.string().url().max(2_048).nullish().catch(null),
  project_production_url: z.string().url().max(2_048).nullish().catch(null),
  // Lifecycles judge a capacity-voided run differently (see capacityVoided);
  // tolerant of projections from before the column existed.
  is_lifecycle: z.boolean().nullish().catch(null),
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
}).superRefine((claim, context) => {
  if (claim.template_key === "full_lifecycle" && claim.template_version === 2) {
    if (!claim.required_check_names || !claim.required_checks_sha256) {
      context.addIssue({
        code: "custom",
        message: "Full Lifecycle v2 requires an exact repository check policy.",
        path: ["required_check_names"],
      });
    }
  }
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

  const nodes: ReturnType<typeof defineNode>[] = [];
  for (const node of claim.nodes) {
    const input = rehydrateStoredSchema(
      node.input_schema,
      `Node ${node.node_key}'s input contract`,
    );
    if (!input.ok) return { ok: false, detail: input.detail };

    const output = rehydrateStoredSchema(
      node.output_schema,
      `Node ${node.node_key}'s output contract`,
      { requireConstraint: true },
    );
    if (!output.ok) return { ok: false, detail: output.detail };

    nodes.push(defineNode({
      nodeId: node.node_key,
      job: node.job,
      executor: node.executor,
      capability: node.capability as Parameters<typeof defineNode>[0]["capability"],
      inputSchema: input.schema,
      outputSchema: output.schema,
      dependsOn: dependsOn.get(node.node_key) ?? [],
      reads: (node.reads ?? []) as readonly ResourceRef[],
      writes: (node.writes ?? []) as readonly ResourceRef[],
      risk: riskFrom(node.risk_level),
      timeoutMs: node.timeout_ms,
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: node.max_attempts },
      toleratesPartialInputs: node.tolerates_partial_inputs,
    }));
  }

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
 * project — a wrong answer shaped exactly like a right one. Protocol v2
 * requires both identities, so absence is itself a refusal rather than a
 * reason to proceed with ambient defaults.
 */
export function repositoryMismatch(
  projectRepository: string | null | undefined,
  checkoutRepository: string | null | undefined,
): string | null {
  const wanted = (projectRepository ?? "").trim();
  const checkout = (checkoutRepository ?? "").trim();
  if (!wanted) return "The protocol-v2 claim did not name its canonical repository.";
  if (!checkout) return "The worker could not prove which repository is checked out.";
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
    execution?: { provider?: string; model?: string; latencyMs?: number },
  ) => Promise<void>;
  readonly recordArtifact: (
    graphRunId: string,
    kind: "RAW" | "REDUCED" | "SYNTHESIS" | "ANCHOR",
    payload: unknown,
    nodeRunId?: string | null,
  ) => Promise<void>;
  /**
   * Commit a model reviewer's terminal state and the complete set of verdicts
   * derived from that same answer in one database transaction. Production
   * stores must provide this for reviewer nodes; a runner will never fall
   * back to a split completion/evidence sequence.
   */
  readonly completeReviewerWithVerifications?: (
    verifierNodeRunId: string,
    artifactPayload: unknown,
    execution: { provider: string; model: string; latencyMs: number },
    verifications: readonly {
      readonly subjectNodeRunId: string;
      readonly verdict: VerificationVerdict;
      readonly evidence: readonly string[];
    }[],
  ) => Promise<void>;
  /**
   * Open the gate a finished node waits at, and report how it stands.
   *
   * Optional so a store written before gates existed still satisfies this
   * contract rather than failing a run over a capability it never had.
   */
  readonly openGate?: (
    nodeId: string,
    graphRunId: string,
    anchorCount: number,
  ) => Promise<void>;
  readonly completeRun: (
    graphRunId: string,
    state: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED" | "BUDGET_STOPPED",
    hadPartialInput: boolean,
    detail?: string | null,
    usage?: { readonly tokensUsed?: number; readonly costMicros?: number },
  ) => Promise<void>;
  /**
   * The most recently completed recorded result per node from this graph's
   * own earlier runs — the read that lets a lifecycle resume instead of
   * re-proving finished stages until the provider window caps (optional for
   * the same reason as `openGate`). The database scopes it to lifecycles.
   */
  readonly readPriorNodeResults?: (graphId: string) => Promise<ReadonlyMap<string, PriorNodeResult>>;
};

export type PriorNodeResult = Readonly<{
  output: unknown;
  provider?: string;
  model?: string;
}>;

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
   * Node keys whose results were reused from this graph's earlier runs
   * rather than re-executed — real recorded work, restated with provenance
   * in the drain log so nothing reads as fresher than it is.
   */
  readonly reusedNodes: readonly string[];
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
export async function runClaimedGraph(
  claim: ClaimedGraph,
  compiled: CompiledGraph,
  store: GraphRunStore,
  executeNode: (node: CompiledNode, attempt: number, inputs: NodeInputs) => Promise<NodeExecutionResult>,
): Promise<GraphRunSummary> {
  const nodeRunIds = new Map(claim.nodes.map((node) => [node.node_key, node.node_run_id]));
  const started = Date.now();

  // Incoming edges per node: the data each node is owed by its upstreams.
  const incoming = new Map<string, string[]>();
  for (const edge of claim.edges) {
    const into = incoming.get(edge.to_node_key) ?? [];
    into.push(edge.from_node_key);
    incoming.set(edge.to_node_key, into);
  }
  const completedOutputs = new Map<string, unknown>();

  // Final-attempt failures, split by kind: a run whose every failure was a
  // capacity refusal never truly executed and must not spend a chance.
  let finalFailures = 0;
  let capacityFinalFailures = 0;
  const awaitingGate: string[] = [];

  /*
   * The resume that lets a lifecycle converge. A re-claimed graph re-runs
   * from the beginning, and three consecutive live windows showed what that
   * costs: each provider window was spent re-proving finished stages and
   * capped before reaching new ground. Nodes this graph already completed in
   * an earlier run reuse their recorded artifacts instead of re-executing —
   * real recorded work from this same graph, reported as reused, costing no
   * tokens. The database scopes the read to lifecycles, so an analysis
   * graph's findings stay fresh.
   */
  const reusable: ReadonlyMap<string, PriorNodeResult> = store.readPriorNodeResults
    ? await store.readPriorNodeResults(claim.graph_id)
    : new Map();
  const reusedNodes = new Set<string>();

  const result = await runGraph(compiled, budgetFromClaim(claim), {
    executeNode: async (node, attempt) => {
      const nodeRunId = nodeRunIds.get(node.nodeKey);
      if (nodeRunId && attempt === 1) {
        await store.recordNodeState(nodeRunId, "RUNNING");
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
      // Model reviewers must judge the current run's exact subject rows. An
      // old verdict is useful provenance, but replaying it as a fresh current
      // verification would be false evidence, so reviewers always execute.
      const reused = attempt === 1
        && verificationLensFor(node) === null
        && reusable.has(node.nodeKey);
      if (reused) reusedNodes.add(node.nodeKey);
      const prior = reused ? reusable.get(node.nodeKey) : undefined;
      let outcome: NodeExecutionResult = reused
        ? {
            status: "SUCCEEDED",
            output: prior?.output,
            provider: prior?.provider,
            model: prior?.model,
            latencyMs: 0,
            tokensUsed: 0,
          }
        : await executeNode(node, attempt, { outputs, missing });

      /*
       * Validate before any durable write and before the output enters the
       * dependency map. `runGraph` also validates successful results, but its
       * validation happens after this injected executor returns; persisting an
       * artifact here first would make a rejected answer visible and reusable.
       * This boundary therefore fails the attempt early and returns only a
       * schema-valid, normalized value to the runner.
      */
      if (outcome.status === "SUCCEEDED") {
        const validation = node.outputSchema
          ? validateNodeOutput(
              { nodeId: node.nodeKey, outputSchema: node.outputSchema },
              outcome.output,
            )
          : null;
        if (validation === null || !validation.valid) {
          outcome = {
            status: "FAILED",
            error: validation === null
              ? `Node ${node.nodeKey} has no executable output contract.`
              : `${validation.message} ${validation.issues.join("; ")}`,
            retryable: true,
            provider: outcome.provider,
            model: outcome.model,
            latencyMs: outcome.latencyMs,
            tokensUsed: outcome.tokensUsed,
            costMicros: outcome.costMicros,
          };
        } else {
          outcome = { ...outcome, output: validation.value };
        }
      }
      if (outcome.status === "SUCCEEDED" && verificationLensFor(node)) {
        const derived = deriveVerdict(outcome.output);
        const subjects = (incoming.get(node.nodeKey) ?? [])
          .filter((dependency) => completedOutputs.has(dependency))
          .map((dependency) => nodeRunIds.get(dependency))
          .filter((subject): subject is string => Boolean(subject));
        const refusal = !derived
          ? "The reviewer output did not contain bounded durable verdict evidence."
          : subjects.length === 0
            ? "The reviewer had no completed subject to verify."
            : !store.completeReviewerWithVerifications
              ? "The worker store cannot atomically persist reviewer evidence."
              : !outcome.provider || !outcome.model || outcome.latencyMs === undefined
                ? "The reviewer execution identity was incomplete."
                : null;
        if (refusal) {
          outcome = {
            status: "FAILED",
            error: refusal,
            retryable: false,
            provider: outcome.provider,
            model: outcome.model,
            latencyMs: outcome.latencyMs,
            tokensUsed: outcome.tokensUsed,
            costMicros: outcome.costMicros,
          };
        }
      }
      if (outcome.status === "SUCCEEDED") {
        completedOutputs.set(node.nodeKey, outcome.output);
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
            try {
              await store.recordArtifact(
                claim.graph_run_id, artifactKindForNode(node), outcome.output, nodeRunId,
              );
            } catch (error) {
              const refusal = artifactGuardRefusal(error);
              if (refusal === null) throw error;
              finalFailures += 1;
              await store.recordNodeState(nodeRunId, "FAILED", refusal);
              return { status: "FAILED", error: refusal, retryable: false };
            }

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

          // A reviewing node has just judged its inputs. Recording that as a
          // verification — of which subject, under which lens, with the
          // evidence it cited — is what makes the judgement auditable later.
          // It is derived from the answer already given, never a second call:
          // asking again would pay twice for one opinion.
          const lens = verificationLensFor(node);
          if (lens) {
            const derived = deriveVerdict(outcome.output);
            const subjects = (incoming.get(node.nodeKey) ?? [])
              .filter((dependency) => completedOutputs.has(dependency))
              .map((dependency) => nodeRunIds.get(dependency))
              .filter((subject): subject is string => Boolean(subject));
            if (
              !derived
              || subjects.length === 0
              || !outcome.provider
              || !outcome.model
              || outcome.latencyMs === undefined
              || !store.completeReviewerWithVerifications
            ) {
              const refusal = !derived
                ? "The reviewer output did not contain a durable verdict."
                : subjects.length === 0
                  ? "The reviewer had no completed subject to verify."
                  : !store.completeReviewerWithVerifications
                    ? "The worker store cannot atomically persist reviewer evidence."
                    : "The reviewer execution identity was incomplete.";
              finalFailures += 1;
              completedOutputs.delete(node.nodeKey);
              await store.recordNodeState(nodeRunId, "FAILED", refusal, {
                provider: outcome.provider,
                model: outcome.model,
                latencyMs: outcome.latencyMs,
              });
              return { status: "FAILED", error: refusal, retryable: false };
            }
            await store.completeReviewerWithVerifications(
              nodeRunId,
              outcome.output,
              {
                provider: outcome.provider,
                model: outcome.model,
                latencyMs: outcome.latencyMs,
              },
              subjects.map((subjectNodeRunId) => ({
                subjectNodeRunId,
                verdict: derived.verdict,
                evidence: derived.evidence,
              })),
            );
          } else {
            // Ordinary products use an idempotent node/kind slot. A lost
            // response therefore replays the same payload instead of
            // appending a second, ambiguous artifact before completion.
            try {
              await store.recordArtifact(
                claim.graph_run_id,
                artifactKindForNode(node),
                outcome.output,
                nodeRunId,
              );
            } catch (error) {
              const refusal = artifactGuardRefusal(error);
              if (refusal === null) throw error;
              finalFailures += 1;
              await store.recordNodeState(nodeRunId, "FAILED", refusal);
              return { status: "FAILED", error: refusal, retryable: false };
            }
            await store.recordNodeState(nodeRunId, "COMPLETED", null, {
              provider: outcome.provider,
              model: outcome.model,
              latencyMs: outcome.latencyMs,
            });
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
  // fuel. If anything succeeded, an ANALYSIS run is a real (partial) answer
  // and is judged as one — the findings it delivered have value on their own.
  //
  // A LIFECYCLE is different, and the first live run proved it (graph
  // 10fe2b0d): eight stages succeeded, then the architecture node hit the
  // subscription's session limit, and the PARTIAL close stranded the graph
  // forever — a partial run counts as an answer, so nothing may ever claim
  // it again. But a lifecycle's product is the shipped change, not its
  // intermediate packages; a run stopped by fuel answers nothing. So a
  // lifecycle whose every terminal failure was capacity closes CANCELLED
  // regardless of how far it got: the record of what ran survives, and the
  // graph stays claimable for a dispatch after the limit resets.
  const capacityVoided = (succeeded === 0 || claim.is_lifecycle === true)
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

  // The fan-in notice counts a gate-held node among its failures, because to
  // the engine it is one. To a reader it is not: a decision is owed, nothing
  // went wrong. The record says so rather than leaving the correction to
  // whoever happens to know the distinction.
  const incompleteness = result.incompleteness !== null && awaitingGate.length > 0
    ? `${result.incompleteness} ${awaitingGate.length} of the nodes counted above `
      + `did not fail: they halted at an open lifecycle gate (${awaitingGate.join(", ")}) `
      + "and continue once the gate is decided."
    : result.incompleteness;

  await store.completeRun(
    claim.graph_run_id,
    finalState,
    incompleteness !== null,
    capacityVoided
      ? `The provider withheld capacity (session or rate limit) for every attempt; the run is void. ${incompleteness ?? ""}`.trim()
      : incompleteness,
    { tokensUsed: result.spend.tokensUsed, costMicros: result.spend.costMicros },
  );

  return {
    outcome: result.outcome,
    finalState,
    nodesSucceeded: succeeded,
    nodesFailed: failed,
    incompleteness,
    capacityWithheld: capacityVoided,
    awaitingGate,
    reusedNodes: [...reusedNodes],
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
/**
 * The database's sensitive-data guard refusing a node's output, recognized so
 * the drain can contain it. Live run 0dafc3b9 (worker 32821441484) produced
 * an output the `graph_artifacts_payload_no_sensitive_data` constraint
 * refused — correctly — and the raw throw then killed the whole drain for
 * every organization's graphs. A refused output fails ITS node, with a
 * message that never restates the payload; any other storage error still
 * propagates, because a database outage genuinely should stop a drain.
 */
export function artifactGuardRefusal(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const sensitive = message.includes("graph_artifacts_payload_no_sensitive_data");
  const bounded = message.includes("graph_artifacts_payload_size_bounded")
    || message.includes("graph artifact payload is sensitive or oversized");
  if (!sensitive && !bounded) return null;
  return "The node's output was refused by the artifact safety boundary and was not stored. "
    + "Secret-shaped or oversized content must not enter the artifact record.";
}

export function anchorsFor(
  node: Pick<CompiledNode, "executor">,
  output: unknown,
): number {
  if (node.executor !== "ANCHOR") return 0;
  if (Array.isArray(output)) return output.length;
  if (output === null || output === undefined) return 0;
  return 1;
}
