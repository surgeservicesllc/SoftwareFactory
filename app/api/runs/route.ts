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

type AnalysisLinkRow = {
  command_id: string;
  graph_id: string;
  goal: string;
  requires_owner_approval: boolean | null;
  linked_at: string;
  latest_run_id: string | null;
  latest_run_state: string | null;
  latest_run_started_at: string | null;
  latest_run_completed_at: string | null;
  artifact_count: number | null;
};

type GraphRunRow = {
  graph_run_id: string;
  graph_id: string;
  // Optional: a database that predates 20260825000200 returns no such column.
  tokens_used?: string | number | null;
  cost_micros?: string | number | null;
  budget_action?: string | null;
  goal: string | null;
  project_id: string | null;
  state: string | null;
  started_at: string | null;
  completed_at: string | null;
  artifact_counts: Record<string, number> | null;
};

/**
 * A graph run's own state, said in the run list's words without flattening
 * the ones that have no agent-run equivalent.
 *
 * `PARTIAL` and `BUDGET_STOPPED` are terminal: the run stopped, having done
 * some of the work. Mapping them onto "running" -- which is what this did --
 * left a finished run claiming a worker was still on it, forever. They keep
 * their own words instead, which the console already renders for any status
 * outside the agent-run five.
 */
function graphRunStatus(state: string | null) {
  switch (state) {
    case "COMPLETED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "RUNNING":
      return "running";
    case "PARTIAL":
      return "partial";
    case "BUDGET_STOPPED":
      return "budget_stopped";
    // A graph nobody has claimed yet is queued work, and so is a run whose
    // state could not be read: neither has started, and neither is finished.
    default:
      return "queued";
  }
}

/** A bigint the driver may hand back as a string, left null when it is null. */
function bigintOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A graph run rendered in the run list's own vocabulary -- each mapping a true
 * statement about the run, and the `analysis:` id prefix telling the console
 * this row has no agent-run detail, cancel, or delete.
 *
 * Keyed by the run, not by the graph: running a graph twice is two runs, and a
 * list called Runs that collapsed them would be hiding one.
 */
function graphRun(row: GraphRunRow, commandId: string | null) {
  const artifactCount = Object.values(row.artifact_counts ?? {})
    .reduce((sum, count) => sum + count, 0);
  return {
    id: `analysis:${row.graph_run_id}`,
    status: graphRunStatus(row.state),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.started_at,
    durationMs: row.started_at && row.completed_at
      ? Math.max(0, Date.parse(row.completed_at) - Date.parse(row.started_at))
      : null,
    risk: null,
    provider: "anthropic",
    model: null,
    branch: null,
    reviewStatus: "unreviewed",
    archivedAt: null,
    project: null,
    task: { id: row.graph_id, title: row.goal ?? "Analysis" },
    agent: { id: row.graph_id, name: "Claude — analysis" },
    analysis: {
      graphId: row.graph_id,
      graphRunId: row.graph_run_id,
      commandId,
      artifactCount,
      /*
       * What the run spent. Null-preserving: a run whose nodes reported no
       * usage recorded nothing, and an older database returns no column at
       * all. Neither is a spend of zero.
       */
      costMicros: bigintOrNull(row.cost_micros),
      tokensUsed: bigintOrNull(row.tokens_used),
      budgetAction: row.budget_action ?? null,
    },
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
    /*
     * Graph runs are runs — one piece of work a bot carried out, with durable
     * evidence — so the list that calls itself Runs must show them.
     *
     * Read from `list_graph_runs`, which is every graph run the organization
     * has. It used to read `list_command_analysis_graphs`, which is only the
     * graph runs a *command* launched, and that made two kinds of run
     * invisible here while they stayed readable on the lifecycle and Graph
     * runs surfaces: one launched from the factory itself rather than from a
     * command, and one whose command was later deleted — ADR-132 unlinks the
     * command and keeps the graph, its run and its artifacts on purpose.
     *
     * The link is still read, for the command each run answers where there is
     * one. Either RPC missing (a database predating its migration) reads as
     * "no graph runs" rather than an error, keeping the provider run list
     * available.
     */
    augment: briefing
      ? undefined
      : async (client, organizationId) => {
          const [runs, linked] = await Promise.all([
            // Explicit, because the function's own default is 20: a list
            // called Runs must not quietly stop at the twentieth one. 100 is
            // the ceiling the function enforces anyway.
            client.rpc("list_graph_runs", { p_organization_id: organizationId, p_limit: 100 }),
            client.rpc("list_command_analysis_graphs", { p_organization_id: organizationId }),
          ]);
          if (runs.error || !Array.isArray(runs.data)) return {};
          const commandByGraph = new Map<string, string>(
            (Array.isArray(linked.data) ? linked.data as AnalysisLinkRow[] : [])
              .map((link) => [link.graph_id, link.command_id]),
          );
          return {
            analysisRuns: (runs.data as GraphRunRow[])
              .map((row) => graphRun(row, commandByGraph.get(row.graph_id) ?? null)),
          };
        },
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
