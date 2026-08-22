import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { loadBotFabric } from "@/lib/bots/service";
import {
  acceptanceCriterionSchema,
  assessCommandRisk,
  commandTypeSchema,
  dependencyTaskIdSchema,
  normalizeDependencyTaskIds,
  resolveAcceptanceCriteria,
} from "@/lib/orchestration/command";
import {
  FactoryCommandCandidateProjectionError,
  parseFactoryCommandRoutingCandidates,
  routeFactoryCommand,
} from "@/lib/orchestration/factory-command-routing";
import {
  classifyFactoryCommandExecutionIdentity,
  createFactoryCommandExecutionIntent,
  createPhase1CExecutionPlan,
} from "@/lib/orchestration/plan";
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
  pipelineTemplateKey: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  risk: z.enum(["green", "yellow", "red"]).default("green"),
  parameters: z.object({}).strict().default({}),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

const submissionResultSchema = z.object({
  command_id: z.string().uuid(),
  task_id: z.string().uuid(),
  command_state: z.enum([
    "submitted", "awaiting_approval", "queued", "running", "succeeded", "failed", "cancelled",
  ]),
  task_state: z.enum([
    "backlog", "awaiting_approval", "queued", "in_progress", "blocked", "completed", "failed", "cancelled",
  ]),
  requires_owner_approval: z.boolean(),
  was_created: z.boolean(),
  route_id: z.string().uuid(),
  project_pipeline_id: z.string().uuid(),
  pipeline_template_key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  pipeline_template_id: z.string().uuid().nullable(),
  assignment_id: z.string().uuid(),
  bot_id: z.string().uuid(),
  role_id: z.string().uuid(),
  routing_snapshot: z.unknown(),
});

const replayCommandParametersSchema = z.object({
  executionMode: z.enum(["manual", "record_only"]),
  provider: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(128),
  repositoryBinding: z.object({
    baseBranch: z.string().trim().min(1).max(255),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  }).passthrough(),
}).passthrough();

const replayRoutingSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.object({
    effectiveRisk: z.enum(["green", "yellow", "red"]),
  }).passthrough(),
  project: z.object({
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
  }).passthrough(),
  pipeline: z.object({
    selectionId: z.string().uuid(),
    templateKey: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    templateId: z.string().uuid().nullable(),
  }).passthrough(),
  assignment: z.object({
    assignmentId: z.string().uuid(),
    botId: z.string().uuid(),
    roleId: z.string().uuid(),
    provider: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(128),
    workEffort: z.enum(["low", "medium", "high", "max"]),
  }).passthrough(),
}).passthrough();

const replayResultSchema = z.object({
  command_id: z.string().uuid(),
  task_id: z.string().uuid(),
  command_state: submissionResultSchema.shape.command_state,
  task_state: submissionResultSchema.shape.task_state,
  requires_owner_approval: z.boolean(),
  was_created: z.literal(false),
  route_id: z.string().uuid(),
  project_pipeline_id: z.string().uuid(),
  pipeline_template_key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  pipeline_template_id: z.string().uuid().nullable(),
  assignment_id: z.string().uuid(),
  bot_id: z.string().uuid(),
  role_id: z.string().uuid(),
  routing_snapshot: replayRoutingSnapshotSchema,
  command_parameters: replayCommandParametersSchema,
  repository_full_name: z.string().trim().min(3).max(255).nullable(),
});

type DatabaseError = {
  code?: string;
  message?: string;
};

const FACTORY_ROUTING_SETUP_MESSAGES = new Set([
  "selected bot assignment is not active for this project",
  "selected bot assignment is not configured",
  "selected bot assignment cannot write the repository",
  "selected bot assignment cannot open pull requests",
  "selected bot assignment cannot run this pipeline",
  "selected bot role risk ceiling is too low",
  "selected bot does not match command execution provider and model",
  "selected bot is not ready",
  "selected bot assignment is at its concurrency limit",
]);

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

function unavailableRead(code: string, message: string) {
  return jsonNoStore({ error: { code, message } }, { status: 503 });
}

function pipelineNotSelected() {
  return jsonNoStore(
    {
      error: {
        code: "pipeline_not_selected",
        message: "Choose a pipeline that is selected for this active project.",
      },
    },
    { status: 409 },
  );
}

function routingSetupRefusal(message: string, details?: unknown) {
  return jsonNoStore(
    {
      error: {
        code: "factory_routing_unavailable",
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status: 409 },
  );
}

function factoryIdempotencyConflict() {
  return jsonNoStore(
    {
      error: {
        code: "factory_routing_idempotency_conflict",
        message: "The idempotency key is already bound to a different factory command intent or route.",
      },
    },
    { status: 409 },
  );
}

function isMissingFactoryRoutingRpc(error: DatabaseError | null): boolean {
  return error?.code === "PGRST202";
}

function isSelectedPipelineMissing(error: DatabaseError | null): boolean {
  return error?.code === "P0002";
}

function isFactoryRoutingSetupConflict(error: DatabaseError | null): boolean {
  return error?.code === "55000";
}

function isFactoryIdempotencyConflict(error: DatabaseError | null): boolean {
  return error?.code === "22023"
    && [
      "idempotent factory command routing evidence conflicts",
      "idempotent command predates factory routing evidence",
      "idempotency key was already used for a different factory command intent",
    ].includes(error.message ?? "");
}

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
            message: "Only the organization owner can record a factory engineering command.",
          },
        },
        { status: 403 },
      );
    }

    // Resolve an exact idempotent replay before consulting any mutable live
    // state. Its immutable command parameters and route snapshot are the
    // evidence to return: a changed base branch, credential, roster, or
    // capacity count must not turn a retry into a different command.
    if (parsed.data.idempotencyKey) {
      const replayRead = await supabase.rpc("resolve_factory_command_replay", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
        p_pipeline_template_key: parsed.data.pipelineTemplateKey,
        p_prompt: parsed.data.prompt,
        p_requested_risk: parsed.data.risk,
        p_command_type: parsed.data.commandType,
        p_acceptance_criteria: acceptanceCriteria,
        p_dependency_task_ids: dependencyTaskIds,
        p_idempotency_key: parsed.data.idempotencyKey,
      });
      if (replayRead.error) {
        if (isMissingFactoryRoutingRpc(replayRead.error)) {
          return unavailableRead(
            "factory_routing_not_connected",
            "Factory command replay resolution is not connected in this environment.",
          );
        }
        if (isFactoryIdempotencyConflict(replayRead.error)) {
          return factoryIdempotencyConflict();
        }
        if (isSelectedPipelineMissing(replayRead.error)) return pipelineNotSelected();
        return unavailableRead(
          "factory_replay_unavailable",
          "The existing factory command could not be resolved safely.",
        );
      }

      const parsedReplayRows = z.array(replayResultSchema).max(1).safeParse(replayRead.data);
      if (!parsedReplayRows.success) {
        return unavailableRead(
          "factory_replay_projection_invalid",
          "Factory command replay returned an invalid result projection.",
        );
      }
      const replay = parsedReplayRows.data[0];
      if (replay) {
        const snapshot = replay.routing_snapshot;
        const parameters = replay.command_parameters;
        const replayExecutionMode = classifyFactoryCommandExecutionIdentity({
          model: snapshot.assignment.model,
          provider: snapshot.assignment.provider,
        });
        if (
          !replayExecutionMode
          || parameters.executionMode !== replayExecutionMode
          || snapshot.project.organizationId !== activeOrganization.id
          || snapshot.project.projectId !== parsed.data.projectId
          || replay.project_pipeline_id !== snapshot.pipeline.selectionId
          || replay.pipeline_template_key !== snapshot.pipeline.templateKey
          || replay.pipeline_template_id !== snapshot.pipeline.templateId
          || replay.assignment_id !== snapshot.assignment.assignmentId
          || replay.bot_id !== snapshot.assignment.botId
          || replay.role_id !== snapshot.assignment.roleId
          || parameters.provider !== snapshot.assignment.provider
          || parameters.model !== snapshot.assignment.model
        ) {
          return unavailableRead(
            "factory_replay_projection_invalid",
            "Factory command replay returned conflicting stored routing evidence.",
          );
        }

        return jsonNoStore(
          {
            command: { id: replay.command_id, status: replay.command_state },
            task: { id: replay.task_id, status: replay.task_state },
            execution: {
              started: false,
              message: replay.requires_owner_approval
                ? "Persisted only. Owner approval remains required; this replay did not dispatch a worker or change autonomy."
                : replayExecutionMode === "record_only"
                  ? "Recorded only for the selected bot. No execution run was created, and no worker or autonomy setting changed."
                : "Persisted only. This exact replay returned its stored route; this request did not dispatch a worker or change autonomy.",
              workerDispatch: "not_applicable",
            },
            orchestration: {
              acceptanceCriteria,
              baseBranch: parameters.repositoryBinding.baseBranch,
              baseSha: parameters.repositoryBinding.baseSha,
              commandType: parsed.data.commandType,
              connectionRouting: { mode: "persisted_replay" },
              dependencyTaskIds,
              effectiveRisk: snapshot.command.effectiveRisk,
              executionMode: replayExecutionMode,
              model: snapshot.assignment.model,
              provider: snapshot.assignment.provider,
              repository: replay.repository_full_name ?? "connected repository",
              factoryRouting: {
                routeId: replay.route_id,
                projectPipelineId: replay.project_pipeline_id,
                pipelineTemplateKey: replay.pipeline_template_key,
                pipelineTemplateId: replay.pipeline_template_id,
                assignmentId: replay.assignment_id,
                botId: replay.bot_id,
                roleId: replay.role_id,
                provider: snapshot.assignment.provider,
                model: snapshot.assignment.model,
                workEffort: snapshot.assignment.workEffort,
              },
            },
            requiresOwnerApproval: replay.requires_owner_approval,
            idempotentReplay: true,
          },
          { status: 200 },
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

    // These are independent read boundaries. Reading them from the same
    // authenticated tenant client in parallel shortens admission latency, but
    // none of their answers can dispatch work. The atomic submit RPC repeats
    // every routing gate after taking the selected assignment's lock.
    const [targetRead, candidateRead, identity, fabricRead] = await Promise.all([
      supabase
        .rpc("resolve_phase1c_command_target", {
          p_organization_id: activeOrganization.id,
          p_project_id: parsed.data.projectId,
        })
        .single(),
      supabase.rpc("list_factory_command_routing_candidates", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
        p_template_key: parsed.data.pipelineTemplateKey,
      }),
      evaluateConnectionIdentity(supabase, parsed.data.projectId, "repository.write"),
      loadBotFabric(supabase, activeOrganization.id).then(
        (data) => ({ data, error: null }),
        (error: unknown) => ({ data: null, error }),
      ),
    ]);

    const { data: targetData, error: targetError } = targetRead;
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
      return unavailableRead(
        "command_target_unavailable",
        "The project's executable repository binding could not be read safely.",
      );
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

    if (candidateRead.error) {
      if (isMissingFactoryRoutingRpc(candidateRead.error)) {
        return unavailableRead(
          "factory_routing_not_connected",
          "Factory command routing is not connected in this environment.",
        );
      }
      if (isSelectedPipelineMissing(candidateRead.error)) return pipelineNotSelected();
      return unavailableRead(
        "factory_routing_unavailable",
        "Factory command routing candidates could not be read safely.",
      );
    }

    if (fabricRead.error || !fabricRead.data) {
      return unavailableRead(
        "bot_fabric_unavailable",
        "The live bot fabric could not be read safely.",
      );
    }

    let routingCandidates;
    try {
      routingCandidates = parseFactoryCommandRoutingCandidates(candidateRead.data);
    } catch (error) {
      if (error instanceof FactoryCommandCandidateProjectionError) {
        return unavailableRead(
          "factory_routing_projection_invalid",
          "Factory command routing returned an invalid candidate projection.",
        );
      }
      throw error;
    }

    const liveBots = new Map(fabricRead.data.bots.map((bot) => [bot.id, bot]));
    if (routingCandidates.some((candidate) => !liveBots.has(candidate.botId))) {
      return unavailableRead(
        "bot_fabric_projection_invalid",
        "Factory command routing referenced a bot missing from the live fabric.",
      );
    }
    const liveRoutingCandidates = routingCandidates.map((candidate) => ({
      ...candidate,
      currentReadiness: candidate.currentReadiness === "ready"
        ? liveBots.get(candidate.botId)!.currentReadiness
        : candidate.currentReadiness,
    }));

    const factoryRouting = routeFactoryCommand({
      candidates: liveRoutingCandidates,
      pipelineTemplateKey: parsed.data.pipelineTemplateKey,
      effectiveRisk: riskAssessment.effectiveRisk,
      deferCapacityToAtomicSubmit: parsed.data.idempotencyKey !== undefined,
    });
    if (factoryRouting.outcome === "REFUSED") {
      const singleReason = factoryRouting.refused.length === 1
        ? factoryRouting.refused[0]?.reason
        : undefined;
      return routingSetupRefusal(singleReason ?? factoryRouting.reason, {
        refusals: factoryRouting.refused.slice(0, 20).map((entry) => ({
          assignmentId: entry.assignmentId,
          code: entry.code,
        })),
      });
    }
    const selectedAssignment = factoryRouting.selected;
    const commandExecution = createFactoryCommandExecutionIntent({
      model: selectedAssignment.model,
      phase1CPlan: executionPlan,
      provider: selectedAssignment.provider,
    });
    if (!commandExecution) {
      return routingSetupRefusal(
        "The selected bot's provider and model are not supported for factory command recording.",
      );
    }

    // Phase 2D seam: the Identity Router is consulted where work is created.
    // A Phase 1C command exercises `repository.write` — the worker pushes a
    // branch and opens a draft PR through the chosen connection. For a project
    // with capability-labelled mappings the router's word is binding: a
    // refusal refuses the command, and a selection that disagrees with the
    // resolved primary binding is a contradiction to surface, never a
    // tiebreak to guess. A project with only legacy (unlabelled) mappings
    // proceeds exactly as before Phase 2D, and the response says so.
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
        const unavailable = error.status >= 500;
        return jsonNoStore(
          {
            error: {
              code: unavailable ? "repository_verification_unavailable" : "project_not_executable",
              message: "The connected repository base branch could not be verified safely.",
            },
          },
          { status: error.status === 429 ? 429 : unavailable ? 503 : 409 },
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
      executionMode: commandExecution.executionMode,
      model: commandExecution.model,
      plan: commandExecution.plan,
      provider: commandExecution.provider,
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

    const { data, error } = await supabase.rpc("submit_factory_command", {
      p_organization_id: activeOrganization.id,
      p_project_id: parsed.data.projectId,
      p_project_pipeline_id: selectedAssignment.projectPipelineId,
      p_assignment_id: selectedAssignment.assignmentId,
      p_prompt: parsed.data.prompt,
      p_requested_risk: riskAssessment.effectiveRisk.toLowerCase(),
      p_parameters: orchestrationParameters,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    }).single();

    if (error) {
      if (isMissingFactoryRoutingRpc(error)) {
        return unavailableRead(
          "factory_routing_not_connected",
          "Factory command routing is not connected in this environment.",
        );
      }
      if (isSelectedPipelineMissing(error)) return pipelineNotSelected();
      if (isFactoryRoutingSetupConflict(error)) {
        const message = error.message && FACTORY_ROUTING_SETUP_MESSAGES.has(error.message)
          ? error.message
          : "The selected bot assignment can no longer run this command.";
        return routingSetupRefusal(
          message,
        );
      }
      if (isFactoryIdempotencyConflict(error)) {
        return factoryIdempotencyConflict();
      }
      return databaseErrorResponse(error);
    }

    const parsedSubmission = submissionResultSchema.safeParse(data);
    if (!parsedSubmission.success) {
      return unavailableRead(
        "factory_submission_projection_invalid",
        "Factory command submission returned an invalid result projection.",
      );
    }
    const result = parsedSubmission.data;
    const parsedSnapshot = replayRoutingSnapshotSchema.safeParse(result.routing_snapshot);
    if (!parsedSnapshot.success) {
      return unavailableRead(
        "factory_submission_projection_invalid",
        "Factory command submission returned an invalid routing snapshot.",
      );
    }
    const snapshot = parsedSnapshot.data;
    if (
      result.project_pipeline_id !== selectedAssignment.projectPipelineId
      || result.pipeline_template_key !== selectedAssignment.pipelineTemplateKey
      || result.pipeline_template_id !== selectedAssignment.pipelineTemplateId
      || result.assignment_id !== selectedAssignment.assignmentId
      || result.bot_id !== selectedAssignment.botId
      || result.role_id !== selectedAssignment.roleId
      || snapshot.project.organizationId !== activeOrganization.id
      || snapshot.project.projectId !== parsed.data.projectId
      || snapshot.pipeline.selectionId !== result.project_pipeline_id
      || snapshot.pipeline.templateKey !== result.pipeline_template_key
      || snapshot.pipeline.templateId !== result.pipeline_template_id
      || snapshot.assignment.assignmentId !== result.assignment_id
      || snapshot.assignment.botId !== result.bot_id
      || snapshot.assignment.roleId !== result.role_id
      || snapshot.assignment.provider !== selectedAssignment.provider
      || snapshot.assignment.model !== selectedAssignment.model
      || (snapshot.command.effectiveRisk === "red" && !result.requires_owner_approval)
    ) {
      return unavailableRead(
        "factory_submission_route_mismatch",
        "Factory command submission returned routing evidence that conflicts with admission.",
      );
    }
    const workerDispatch = "not_applicable" as const;
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
            ? "Persisted only. Owner approval remains required; this request did not dispatch a worker or change autonomy."
            : commandExecution.executionMode === "record_only"
              ? "Recorded only for the selected bot. No execution run was created, and no worker or autonomy setting changed."
            : "Persisted only. This request did not dispatch a worker or change autonomy.",
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
          factoryRouting: {
            routeId: result.route_id,
            projectPipelineId: result.project_pipeline_id,
            pipelineTemplateKey: result.pipeline_template_key,
            pipelineTemplateId: result.pipeline_template_id,
            assignmentId: result.assignment_id,
            botId: result.bot_id,
            roleId: result.role_id,
            provider: snapshot.assignment.provider,
            model: snapshot.assignment.model,
            workEffort: snapshot.assignment.workEffort,
          },
          dependencyTaskIds,
          effectiveRisk: snapshot.command.effectiveRisk,
          executionMode: commandExecution.executionMode,
          model: snapshot.assignment.model,
          provider: snapshot.assignment.provider,
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
