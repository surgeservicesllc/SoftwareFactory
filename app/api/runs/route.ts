import { z } from "zod";

import { readRepositoryMemoryExcerpts } from "@/lib/providers/memory";
import { ROUTING_PROVIDER_REQUESTS } from "@/lib/providers/routing";
import { executeProviderTask } from "@/lib/providers/runtime";
import { loadProjectRoutingContext } from "@/lib/providers/service";
import {
  PROVIDER_TASK_KINDS,
  isAgentRole,
  type AgentRole,
  type ProviderId,
} from "@/lib/providers/types";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { tenantRpcListResponse } from "@/lib/server/tenant-list";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_OUTPUT_TOKENS = 16_000;
const RUN_TIMEOUT_MS = 180_000;

const runRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    agentId: z.string().uuid(),
    taskKind: z.enum(PROVIDER_TASK_KINDS),
    instructions: z.string().trim().min(1).max(8_000),
    requestedProvider: z.enum(ROUTING_PROVIDER_REQUESTS).default("AUTO"),
    riskLevel: z.enum(["GREEN", "YELLOW", "RED"]).default("GREEN"),
  })
  .strict();

/** Recent provider runs with their routing evidence and usage. */

/*
 * GET keeps main's hardened boundary: reads go through the safe-projection
 * RPC so membership is enforced in the database, not by this route's column
 * list. POST below is the Phase 2A provider execution path.
 */
type RunRow = {
  id: string;
  project_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  task_title: string | null;
  agent_name: string | null;
  project_name?: string | null;
  risk_level?: string | null;
  provider?: string | null;
  model?: string | null;
  branch_name?: string | null;
  // Optional because it postdates the rest of the row: `20260817000300` added
  // it, and a database that predates that migration must still render a
  // readable list rather than a broken one. It falls back to "unreviewed".
  // (Applied on hosted — measured 2026-08-18, AI/HOSTED_APPLY_RUNBOOK.md.)
  review_status?: string | null;
  // Same reasoning, from `20260817001000`. An absent column is not evidence
  // that a run is archived. (Also applied on hosted, same measurement.)
  archived_at?: string | null;
};

function briefingRun(row: RunRow) {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    project: row.project_id
      ? { id: row.project_id, name: row.project_name ?? "Project" }
      : null,
    task: row.task_id
      ? { id: row.task_id }
      : null,
    agent: row.agent_id
      ? { id: row.agent_id, name: row.agent_name ?? "Agent" }
      : null,
  };
}

function fullRun(row: RunRow) {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    durationMs: row.started_at && row.completed_at
      ? Math.max(0, Date.parse(row.completed_at) - Date.parse(row.started_at))
      : null,
    risk: row.risk_level ?? null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    branch: row.branch_name ?? null,
    reviewStatus: row.review_status ?? "unreviewed",
    archivedAt: row.archived_at ?? null,
    project: row.project_id
      ? { id: row.project_id, name: row.project_name ?? "Project" }
      : null,
    task: row.task_id
      ? { id: row.task_id, title: row.task_title ?? "Task" }
      : null,
    agent: row.agent_id
      ? { id: row.agent_id, name: row.agent_name ?? "Agent" }
      : null,
  };
}

export async function GET(request: Request) {
  const briefing = new URL(request.url).searchParams.get("view") === "briefing";

  return tenantRpcListResponse<RunRow>({
    request,
    rpc: "list_agent_runs",
    unavailableCode: "runs_unavailable",
    unavailableMessage: "Runs could not be loaded.",
    shape: (rows) => ({
      runs: rows.map((row) => briefing ? briefingRun(row) : fullRun(row)),
    }),
  });
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = runRequestSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_run_request",
            message: "The run request is invalid.",
            fields: z.flattenError(parsed.error).fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    const sensitive = findSensitiveData({ instructions: parsed.data.instructions });
    if (sensitive) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "Run instructions cannot contain credentials or likely secret values.",
            path: sensitive.path,
          },
        },
        { status: 400 },
      );
    }

    const { client, activeOrganization } = await requireActiveOrganization();

    // External execution has cost and data-egress impact. Reject callers that
    // cannot manage this tenant before probing providers or sending content.
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        {
          error: {
            code: "provider_run_forbidden",
            message: "Organization owner or administrator access is required.",
          },
        },
        { status: 403 },
      );
    }

    // Phase 2A has no durable, exact RED approval attached to this advisory
    // run request. A risk ceiling or provider switch cannot substitute for
    // that evidence, so RED never reaches an outbound provider here.
    if (parsed.data.riskLevel === "RED") {
      return jsonNoStore(
        {
          error: {
            code: "red_provider_run_blocked",
            message: "RED provider runs require a separately reviewed approval workflow.",
          },
        },
        { status: 409 },
      );
    }

    const task = await loadTask(client, activeOrganization.id, parsed.data.projectId, parsed.data.taskId);
    if (!task) {
      return jsonNoStore(
        { error: { code: "task_not_found", message: "The task is not available for this project." } },
        { status: 404 },
      );
    }

    if (task.riskLevel !== parsed.data.riskLevel.toLowerCase()) {
      return jsonNoStore(
        {
          error: {
            code: "risk_mismatch",
            message: "The requested risk level does not match the persisted task.",
          },
        },
        { status: 409 },
      );
    }

    const agent = await loadAgent(client, activeOrganization.id, parsed.data.agentId);
    if (!agent) {
      return jsonNoStore(
        { error: { code: "agent_not_found", message: "The agent is not available." } },
        { status: 404 },
      );
    }

    const context = await loadProjectRoutingContext(
      client,
      activeOrganization.id,
      parsed.data.projectId,
      { probeProviders: true },
    );
    if (!context) {
      return jsonNoStore(
        { error: { code: "project_not_found", message: "The project is not available." } },
        { status: 404 },
      );
    }

    if (!context.executionEnabled) {
      return jsonNoStore(
        {
          error: {
            code: "provider_execution_disabled",
            message:
              "Outbound AI provider execution is switched off for this organization. An owner must enable it in Settings.",
          },
        },
        { status: 409 },
      );
    }

    const routingRequest = {
      taskKind: parsed.data.taskKind,
      riskLevel: parsed.data.riskLevel,
      requestedProvider: parsed.data.requestedProvider,
      policy: context.policy,
      agentAssignment: {
        agentId: agent.id,
        agentRole: agent.role,
        provider: agent.provider,
        model: agent.model,
      },
      availability: context.availability,
    } as const;

    const execution = await executeProviderTask({
      runId: crypto.randomUUID(),
      routing: routingRequest,
      agentId: agent.id,
      instructions: parsed.data.instructions,
      context: {
        projectName: context.projectName,
        repositoryFullName: context.repositoryFullName,
        defaultBranch: context.defaultBranch,
        riskLevel: parsed.data.riskLevel,
        priorArtifacts: [],
        memoryExcerpts: await readRepositoryMemoryExcerpts(),
      },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: RUN_TIMEOUT_MS,
    });

    const attempt = execution.finalAttempt ?? execution.attempts.at(-1) ?? null;
    const decision = attempt?.decision ?? execution.primaryDecision;

    const { data, error } = await client
      .rpc("record_provider_run", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
        p_task_id: parsed.data.taskId,
        p_agent_id: agent.id,
        p_task_kind: parsed.data.taskKind,
        p_risk_level: parsed.data.riskLevel.toLowerCase(),
        p_requested_provider: parsed.data.requestedProvider,
        p_policy_version: decision.policyVersion,
        p_decision: decision.decision,
        p_source: decision.source,
        p_selected_provider: decision.provider,
        p_selected_model: decision.model,
        p_reasons: decision.reasons,
        p_candidates: decision.candidates,
        p_fallback_from_provider: execution.fallbackFromProvider,
        p_run_status: databaseRunStatus(execution.outcome),
        p_provider_run_reference: attempt?.result.providerRunId ?? null,
        p_input: { task_kind: parsed.data.taskKind, requested_provider: parsed.data.requestedProvider },
        p_output: attempt?.result.output ?? null,
        p_usage: attempt?.result.usage
          ? {
              input_tokens: attempt.result.usage.inputTokens,
              output_tokens: attempt.result.usage.outputTokens,
              cached_input_tokens: attempt.result.usage.cachedInputTokens,
              estimated_cost_micros: attempt.result.usage.estimatedCostMicros,
            }
          : null,
        p_latency_ms: attempt?.result.latencyMs ?? null,
        p_error_message: attempt?.result.error?.message ?? null,
        p_events: attempt?.result.events.map((event) => ({
          type: event.type,
          message: event.message,
        })) ?? [],
      })
      .single();

    if (error) return databaseErrorResponse(error);

    const recorded = data as { routing_decision_id: string; agent_run_id: string | null };

    return jsonNoStore(
      {
        outcome: execution.outcome,
        runId: recorded.agent_run_id,
        routingDecisionId: recorded.routing_decision_id,
        routing: {
          decision: decision.decision,
          provider: decision.provider,
          model: decision.model,
          source: decision.source,
          policyVersion: decision.policyVersion,
          requiresOwnerApproval: decision.requiresOwnerApproval,
          reasons: decision.reasons,
        },
        fallback: execution.fallbackFromProvider
          ? { fromProvider: execution.fallbackFromProvider, reason: execution.fallbackReason }
          : null,
        attempts: execution.attempts.map((entry) => ({
          attempt: entry.attempt,
          provider: entry.provider,
          model: entry.model,
          status: entry.result.status,
          latencyMs: entry.result.latencyMs,
          error: entry.result.error,
        })),
        result: attempt?.result.output ?? null,
        usage: attempt?.result.usage ?? null,
      },
      { status: execution.outcome === "SUCCEEDED" ? 200 : 202 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "The provider run failed safely." } },
      { status: 500 },
    );
  }
}

type AgentRecord = {
  readonly id: string;
  readonly role: AgentRole;
  readonly provider: ProviderId | null;
  readonly model: string | null;
};

async function loadAgent(
  client: Awaited<ReturnType<typeof requireActiveOrganization>>["client"],
  organizationId: string,
  agentId: string,
): Promise<AgentRecord | null> {
  const { data, error } = await client.rpc("get_provider_agent_assignment", {
    p_agent_id: agentId,
    p_organization_id: organizationId,
  });

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object") return null;

  const row = result as { id: string; role: string; provider: string | null; model: string | null };
  if (!isAgentRole(row.role)) return null;

  return {
    id: row.id,
    role: row.role,
    provider: row.provider === "anthropic" || row.provider === "openai" ? row.provider : null,
    model: row.model,
  };
}

type TaskRecord = {
  readonly riskLevel: "green" | "yellow" | "red";
};

async function loadTask(
  client: Awaited<ReturnType<typeof requireActiveOrganization>>["client"],
  organizationId: string,
  projectId: string,
  taskId: string,
): Promise<TaskRecord | null> {
  // `get_task_detail` is the caller-bound projection used by the task detail
  // route. It proves the task belongs to both the active tenant and project
  // without restoring direct SELECT on the sensitive tasks base table.
  const { data, error } = await client.rpc("get_task_detail", {
    p_organization_id: organizationId,
    p_task_id: taskId,
  });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object") return null;
  const projected = "detail" in result ? result.detail : result;
  if (!projected || typeof projected !== "object") return null;

  const row = projected as Record<string, unknown>;
  const project = row.project;
  const risk = row.risk;
  if (
    !project ||
    typeof project !== "object" ||
    (project as Record<string, unknown>).id !== projectId ||
    (risk !== "green" && risk !== "yellow" && risk !== "red")
  ) {
    return null;
  }

  return { riskLevel: risk };
}

/** Map the runtime outcome onto the `public.run_status` enum. */
function databaseRunStatus(
  outcome: Awaited<ReturnType<typeof executeProviderTask>>["outcome"],
): "succeeded" | "failed" | "cancelled" {
  if (outcome === "SUCCEEDED") return "succeeded";
  if (outcome === "CANCELLED") return "cancelled";
  return "failed";
}
