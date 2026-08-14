import { z } from "zod";

import {
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import { NODE_COMPLEXITIES, WORK_CAPABILITIES } from "@/lib/resources/capabilities";
import {
  breakerTargetsFor,
  toAgentProfile,
  toModelProfile,
  undeclaredModels,
  type AgentRow,
  type ModelRow,
} from "@/lib/resources/candidates";
import {
  ROUTING_MODES,
  ROUTING_OBJECTIVES,
  assignWorker,
  type WorkerCandidate,
} from "@/lib/resources/manager";
import { breakerFor, loadBreakers, recordAssignment, type SupabaseLike } from "@/lib/resources/store";
import { RISK_LEVELS } from "@/lib/risk";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

type QueryResult<Row> = { data: Row[] | null; error: { message: string } | null };

/**
 * Route one unit of work, against this organization's real rows.
 *
 * Until now the Resource Manager only ever scored code constants, so routing
 * was a demonstration rather than a decision about anything. This assembles
 * candidates from the organization's own `agents` and
 * `provider_model_configurations`, folds in stored circuit-breaker state, and
 * records the outcome so a later run can be measured against what was predicted.
 *
 * It selects; it does not start anything. Nothing in this path claims a run,
 * mints a token, or calls a provider — and nothing could, because no worker is
 * registered and no provider credential exists. Deciding who *would* do the
 * work is the whole of what happens here, and the response says so.
 *
 * Manager-level rather than owner-only: choosing a worker for a task grants no
 * authority a task did not already carry, and the risk floor still applies when
 * that task is eventually submitted.
 */

const routeRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    required: z.array(z.enum(WORK_CAPABILITIES)).min(1).max(WORK_CAPABILITIES.length),
    complexity: z.enum(NODE_COMPLEXITIES),
    riskLevel: z.enum(RISK_LEVELS),
    estimatedContextTokens: z.number().int().min(1).max(100_000_000),
    objective: z.enum(ROUTING_OBJECTIVES).default("BALANCED"),
    mode: z.enum(ROUTING_MODES).default("AUTO"),
    requestedAgentId: z.string().uuid().nullish(),
    requestedModel: z.string().trim().min(1).max(128).nullish(),
    /**
     * Set when a code path can produce the whole output. Declared by the
     * caller because only the caller knows whether a deterministic handler
     * exists for this node; the manager's job is to honour it first.
     */
    deterministicHandlerAvailable: z.boolean().default(false),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = routeRequestSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return invalidRequest("Provide a project, node, required capabilities, complexity, risk, and context size.");
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const organizationId = context.activeOrganization.id;

    // Each read is annotated and awaited on its own. Combining untyped
    // PostgREST builders of different shapes in one `Promise.all` makes the
    // inferred union deep enough that TypeScript gives up (TS2589).
    const agentQuery: QueryResult<AgentRow> = await context.client
      .from("agents")
      .select("id,role,status,project_id,capabilities")
      .eq("organization_id", organizationId);
    if (agentQuery.error) return databaseErrorResponse(agentQuery.error);

    const modelQuery: QueryResult<ModelRow> = await context.client
      .from("provider_model_configurations")
      .select("provider,model,capabilities,enabled,strength_tier,context_limit_tokens")
      .eq("organization_id", organizationId);
    if (modelQuery.error) return databaseErrorResponse(modelQuery.error);

    // Narrowed to the two methods the store uses; see `SupabaseLike`.
    const storeClient = context.client as unknown as SupabaseLike;
    const breakers = await loadBreakers(storeClient, organizationId);

    const agentRows = agentQuery.data ?? [];
    const modelRows = modelQuery.data ?? [];

    // No agents or no models is not a routing failure, and reporting it as one
    // would send someone hunting for a scoring bug. It is a configuration state
    // with a different fix.
    if (agentRows.length === 0 || modelRows.length === 0) {
      return jsonNoStore(
        {
          decision: "NO_CANDIDATES_CONFIGURED",
          reason:
            agentRows.length === 0
              ? "This organization has no agents, so there is nobody to route work to."
              : "This organization has no configured models, so there is nothing to route work onto.",
          recorded: false,
          undeclaredModels: undeclaredModels(modelRows),
        },
        { status: 409 },
      );
    }

    const candidates: WorkerCandidate[] = [];
    for (const agentRow of agentRows) {
      const agent = toAgentProfile(agentRow);
      for (const modelRow of modelRows) {
        const model = toModelProfile(modelRow);
        // Most specific breaker wins: a model suppressed on its own is
        // suppressed even where its provider is fine.
        const [specific, general] = breakerTargetsFor(model.provider, model.model);
        const breaker = breakers.has(specific)
          ? breakerFor(breakers, specific)
          : breakerFor(breakers, general);

        candidates.push({
          agent,
          model,
          // No provider run has ever executed, so there is no observed history
          // for any pair. Null is the honest value; a zero would be a
          // measurement nobody made.
          performance: null,
          configuredAffinity: 0,
          breaker,
        });
      }
    }

    const assignment = assignWorker({
      node: {
        nodeId: parsed.data.nodeId,
        projectId: parsed.data.projectId,
        required: parsed.data.required,
        complexity: parsed.data.complexity,
        riskLevel: parsed.data.riskLevel,
        estimatedContextTokens: parsed.data.estimatedContextTokens,
        deterministicHandlerAvailable: parsed.data.deterministicHandlerAvailable,
      },
      candidates,
      objective: parsed.data.objective,
      mode: parsed.data.mode,
      requestedAgentId: parsed.data.requestedAgentId ?? null,
      requestedModel: parsed.data.requestedModel ?? null,
      now: Date.now(),
    });

    // A decision that cannot be stored is still a decision, and refusing to
    // return it would hide the routing behind a storage problem. It is reported
    // as unrecorded rather than silently treated as persisted.
    let assignmentId: string | null = null;
    let recordingError: string | null = null;
    try {
      assignmentId = await recordAssignment(storeClient, {
        projectId: parsed.data.projectId,
        nodeId: parsed.data.nodeId,
        assignment,
      });
    } catch (error) {
      recordingError = error instanceof Error ? error.message : "The decision could not be recorded.";
    }

    return jsonNoStore({
      assignmentId,
      recorded: assignmentId !== null,
      recordingError,
      decision: assignment.decision,
      agentId: assignment.agentId,
      provider: assignment.provider,
      model: assignment.model,
      objective: assignment.objective,
      mode: assignment.mode,
      reason: assignment.reason,
      policyVersion: assignment.policyVersion,
      candidates: assignment.candidates.map((candidate) => ({
        agentId: candidate.agentId,
        provider: candidate.provider,
        model: candidate.model,
        eligible: candidate.eligible,
        score: candidate.score,
        rejections: candidate.rejections,
        notes: candidate.notes,
      })),
      // Named so "no eligible worker" is distinguishable from "no eligible
      // worker because nobody declared the models".
      undeclaredModels: undeclaredModels(modelRows),
      executionLabel: "Not Connected",
      note: "This selects a worker. It starts nothing: no worker is registered and no provider credential exists.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "routing_failed", "The work could not be routed.");
  }
}
