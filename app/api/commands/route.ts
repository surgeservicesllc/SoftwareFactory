import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import {
  acceptanceCriterionSchema,
  assessCommandRisk,
  commandTypeSchema,
  dependencyTaskIdSchema,
  normalizeDependencyTaskIds,
  resolveAcceptanceCriteria,
} from "@/lib/orchestration/command";
import { dispatchPhase1CWorker } from "@/lib/orchestration/dispatch";
import { createPhase1CExecutionPlan } from "@/lib/orchestration/plan";
import { evaluateConnectionIdentity } from "@/lib/connections/routable-candidates";
import {
  createGitHubInstallationToken,
  GitHubApiError,
} from "@/lib/github/client";
import { getGitHubAppConfigurationForAppId } from "@/lib/github/config";
import { getGitHubBranchReference } from "@/lib/github/repository";
import { tenantRpcListResponse } from "@/lib/server/tenant-list";
import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const commandRequestSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(4000),
  commandType: commandTypeSchema.default("other"),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).max(12).default([]),
  dependencyTaskIds: z.array(dependencyTaskIdSchema).max(20).default([]),
  risk: z.enum(["green", "yellow", "red"]).default("green"),
  parameters: z.object({}).strict().default({}),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

type SubmissionResult = {
  command_id: string;
  task_id: string;
  command_state: "submitted" | "awaiting_approval" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  task_state: "backlog" | "awaiting_approval" | "queued" | "in_progress" | "blocked" | "completed" | "failed" | "cancelled";
  requires_owner_approval: boolean;
  was_created: boolean;
};

type CommandTarget = {
  app_id: number;
  base_branch: string;
  connection_id: string;
  external_installation_id: number;
  external_repository_id: number;
  internal_installation_id: string;
  project_id: string;
  repository_full_name: string;
  repository_id: string;
};

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const rawBody = await readBoundedJson(request);
    const parsed = commandRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_command",
            message: "Command submission is invalid.",
            fields: z.flattenError(parsed.error).fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    const acceptanceCriteria = resolveAcceptanceCriteria(
      parsed.data.commandType,
      parsed.data.acceptanceCriteria,
    );
    const dependencyTaskIds = normalizeDependencyTaskIds(parsed.data.dependencyTaskIds);
    const sensitiveFinding = findSensitiveData({
      acceptanceCriteria,
      prompt: parsed.data.prompt,
      parameters: parsed.data.parameters,
    });
    if (sensitiveFinding) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "Commands cannot contain credentials, sensitive keys, or likely secret values.",
            path: sensitiveFinding.path,
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client: supabase } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner") {
      return jsonNoStore(
        {
          error: {
            code: "owner_required",
            message: "Only the organization owner can start a Codex engineering command.",
          },
        },
        { status: 403 },
      );
    }
    const { data: targetData, error: targetError } = await supabase
      .rpc("resolve_phase1c_command_target", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
      })
      .single();
    if (targetError) {
      if (["P0002", "42501", "55000"].includes(targetError.code ?? "")) {
        return jsonNoStore(
          {
            error: {
              code: "project_not_executable",
              message: "Choose an active project with a live selected GitHub repository.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(targetError);
    }
    if (!targetData) {
      return jsonNoStore(
        {
          error: {
            code: "project_not_executable",
            message: "Choose an active project with a live selected GitHub repository.",
          },
        },
        { status: 409 },
      );
    }

    const target = targetData as CommandTarget;

    // Phase 2D seam: the Identity Router is consulted where work is created.
    // A Phase 1C command exercises `repository.write` — the worker pushes a
    // branch and opens a draft PR through the chosen connection. For a project
    // with capability-labelled mappings the router's word is binding: a
    // refusal refuses the command, and a selection that disagrees with the
    // resolved primary binding is a contradiction to surface, never a
    // tiebreak to guess. A project with only legacy (unlabelled) mappings
    // proceeds exactly as before Phase 2D, and the response says so.
    const identity = await evaluateConnectionIdentity(
      supabase, parsed.data.projectId, "repository.write",
    );
    if (identity.mode === "error") {
      return jsonNoStore(
        {
          error: {
            code: "connection_registry_unavailable",
            message: "The connection registry could not be read; refusing to route work without it.",
          },
        },
        { status: 503 },
      );
    }
    if (identity.mode === "routed") {
      const routed = identity.result;
      // The decision is durable evidence before it is acted on — a refusal is
      // evidence on its own, and recording only selections would make the
      // audit read as if the router never said no. A recording failure fails
      // the submission: acting on an unrecorded decision would be exactly the
      // unauditable routing this table exists to end.
      const { error: decisionError } = await supabase.rpc(
        "record_connection_routing_decision",
        {
          p_capability: "repository.write",
          p_connection_id: routed.outcome === "SELECTED" ? routed.connectionId : null,
          p_considered_count: routed.consideredCount,
          p_decision: routed.outcome,
          p_project_id: parsed.data.projectId,
          p_refusal_code: routed.outcome === "REFUSED" ? routed.code : null,
          p_rejected: routed.rejected,
          p_used_fallback: routed.outcome === "SELECTED" ? routed.usedFallback : false,
        },
      );
      if (decisionError) {
        return databaseErrorResponse(decisionError);
      }
      if (routed.outcome === "REFUSED") {
        return jsonNoStore(
          {
            error: {
              code: "connection_routing_refused",
              message: `The identity router refused to choose a connection: ${routed.reason}`,
            },
          },
          { status: 409 },
        );
      }
      if (routed.connectionId !== target.connection_id) {
        return jsonNoStore(
          {
            error: {
              code: "connection_routing_disagreement",
              message:
                "The identity router selected a different connection than the project's resolved "
                + "primary GitHub binding. The mappings contradict each other; fix the project's "
                + "connection mappings rather than letting either side guess.",
            },
          },
          { status: 409 },
        );
      }
    }

    const requestedRisk = parsed.data.risk.toUpperCase() as "GREEN" | "YELLOW" | "RED";
    const riskAssessment = assessCommandRisk({
      acceptanceCriteria,
      commandType: parsed.data.commandType,
      prompt: parsed.data.prompt,
      requestedRisk,
    });
    const executionPlan = createPhase1CExecutionPlan(parsed.data.commandType);
    const [repositoryOwner, repositoryName] = target.repository_full_name.split("/");
    if (!repositoryOwner || !repositoryName || target.repository_full_name.split("/").length !== 2) {
      return jsonNoStore(
        { error: { code: "project_not_executable", message: "The project repository binding is invalid." } },
        { status: 409 },
      );
    }
    let baseSha: string;
    try {
      const token = await createGitHubInstallationToken(
        getGitHubAppConfigurationForAppId(target.app_id),
        target.external_installation_id,
        {
          permissions: { contents: "read", metadata: "read" },
          repositoryIds: [target.external_repository_id],
        },
      );
      const reference = await getGitHubBranchReference(
        token.token,
        repositoryOwner,
        repositoryName,
        target.base_branch,
      );
      baseSha = reference.object.sha.toLowerCase();
    } catch (error) {
      if (error instanceof GitHubApiError) {
        return jsonNoStore(
          {
            error: {
              code: "project_not_executable",
              message: "The connected repository base branch could not be verified safely.",
            },
          },
          { status: error.status === 429 ? 429 : 409 },
        );
      }
      throw error;
    }
    const orchestrationParameters = {
      acceptanceCriteria,
      agentRole: executionPlan.agentRole,
      budget: executionPlan.budget,
      commandType: parsed.data.commandType,
      dependencyTaskIds,
      executionMode: "manual",
      model: executionPlan.model,
      plan: executionPlan.plan,
      provider: executionPlan.provider,
      repositoryBinding: {
        appId: target.app_id,
        baseBranch: target.base_branch,
        baseSha,
        connectionId: target.connection_id,
        externalInstallationId: target.external_installation_id,
        externalRepositoryId: target.external_repository_id,
        installationId: target.internal_installation_id,
        repositoryId: target.repository_id,
      },
      riskAssessment: {
        factors: riskAssessment.factors,
        reasons: riskAssessment.reasons,
        requestedRisk: riskAssessment.requestedRisk.toLowerCase(),
      },
    };

    const { data, error } = await supabase.rpc("submit_command", {
      p_project_id: parsed.data.projectId,
      p_prompt: parsed.data.prompt,
      p_requested_risk: riskAssessment.effectiveRisk.toLowerCase(),
      p_parameters: orchestrationParameters,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    }).single();

    if (error) {
      return databaseErrorResponse(error);
    }

    const result = data as SubmissionResult;
    let workerDispatch: "not_applicable" | "requested" | "delayed" = "not_applicable";
    if (!result.requires_owner_approval && result.task_state === "queued") {
      try {
        await dispatchPhase1CWorker(
          {
            appId: target.app_id,
            externalInstallationId: target.external_installation_id,
            externalRepositoryId: target.external_repository_id,
            repositoryFullName: target.repository_full_name,
          },
          result.command_id,
        );
        workerDispatch = "requested";
      } catch {
        // The command/task transaction is durable. A same-key retry can wake
        // the worker again without creating duplicate work.
        workerDispatch = "delayed";
      }
      const { error: dispatchEvidenceError } = await supabase.rpc(
        "record_phase1c_dispatch_outcome",
        {
          p_command_id: result.command_id,
          p_organization_id: activeOrganization.id,
          p_outcome: workerDispatch,
          p_reason_code: workerDispatch === "delayed" ? "provider_dispatch_failed" : null,
        },
      );
      if (dispatchEvidenceError) {
        return databaseErrorResponse(dispatchEvidenceError);
      }
    }
    return jsonNoStore(
      {
        command: {
          id: result.command_id,
          status: result.command_state,
        },
        task: {
          id: result.task_id,
          status: result.task_state,
        },
        execution: {
          started: false,
          message: result.requires_owner_approval
            ? "Persisted only. RED Codex execution remains blocked in Phase 1C; owner approval does not widen the worker ceiling."
            : workerDispatch === "requested"
              ? "The command is queued and the durable Phase 1C worker was notified."
              : "The command is queued durably. Worker notification is delayed; retrying is safe.",
          workerDispatch,
        },
        orchestration: {
          acceptanceCriteria,
          baseBranch: target.base_branch,
          baseSha,
          commandType: parsed.data.commandType,
          // The identity decision travels with the submission result so the
          // caller can see which path chose the connection. It contains ids
          // and refusal codes only — the router never returns secrets.
          connectionRouting: identity.mode === "legacy"
            ? { mode: "legacy", reason: identity.reason }
            : {
                mode: "routed",
                connectionId: identity.result.outcome === "SELECTED" ? identity.result.connectionId : null,
                consideredCount: identity.result.consideredCount,
                rejected: identity.result.rejected,
                usedFallback: identity.result.outcome === "SELECTED" ? identity.result.usedFallback : false,
              },
          dependencyTaskIds,
          effectiveRisk: riskAssessment.effectiveRisk.toLowerCase(),
          model: executionPlan.model,
          repository: target.repository_full_name,
        },
        requiresOwnerApproval: result.requires_owner_approval,
        idempotentReplay: !result.was_created,
      },
      { status: result.was_created ? 202 : 200 },
    );
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    if (error instanceof ApiRequestError) {
      return requestErrorResponse(error);
    }
    if (error instanceof SupabaseConfigurationError) {
      return jsonNoStore(
        {
          error: {
            code: "supabase_not_configured",
            message: "Command persistence is unavailable because Supabase is not configured.",
          },
        },
        { status: 503 },
      );
    }

    return jsonNoStore(
      { error: { code: "internal_error", message: "Command submission failed safely." } },
      { status: 500 },
    );
  }
}


type CommandRow = {
  id: string;
  project_id: string | null;
  prompt: string;
  requested_risk: string;
  status: string;
  submitted_at: string;
  completed_at: string | null;
  project_name: string | null;
};

/**
 * Lists the commands the caller's organization has saved. `parameters` is
 * excluded: it is caller-supplied and screened for secrets on write, but it
 * has no reason to travel back to the browser in a list view.
 */
export async function GET(request: Request) {
  return tenantRpcListResponse<CommandRow>({
    request,
    rpc: "list_commands",
    unavailableCode: "commands_unavailable",
    unavailableMessage: "Saved requests could not be loaded.",
    shape: (rows) => ({
        commands: rows.map((row) => ({
          id: row.id,
          prompt: row.prompt,
          risk: row.requested_risk,
          status: row.status,
          submittedAt: row.submitted_at,
          completedAt: row.completed_at,
          project: row.project_id
            ? { id: row.project_id, name: row.project_name ?? "Project" }
            : null,
        })),
      }),
  });
}
