import { z } from "zod";

import { planCommand } from "@/lib/orchestrator/planner";
import { DEFAULT_PROVIDER_KEY, findWorkerProvider } from "@/lib/providers/registry";
import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { invalidRequest, withTenant } from "@/lib/server/tenant-route";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const commandRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(4000),
    risk: z.enum(["green", "yellow", "red"]).default("green"),
    parameters: z.record(z.string(), z.unknown()).default({}),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

type SubmissionResult = {
  command_id: string;
  task_id: string;
  command_state: string;
  task_state: string;
  requires_owner_approval: boolean;
  was_created: boolean;
};

type PlanResult = {
  command_id: string;
  command_state: string;
  task_ids: string[];
  run_ids: string[];
};

export async function GET(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const url = new URL(request.url);
      const parsed = listQuerySchema.safeParse({
        projectId: url.searchParams.get("projectId") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });
      if (!parsed.success) {
        return invalidRequest("invalid_command_query", "The command query is invalid.");
      }

      let query = client
        .from("commands")
        .select(
          "id,project_id,prompt,requested_risk,status,submitted_at,completed_at,submitted_by,parameters,projects(name)",
        )
        .eq("organization_id", activeOrganization.id)
        .order("submitted_at", { ascending: false })
        .limit(parsed.data.limit);
      if (parsed.data.projectId) query = query.eq("project_id", parsed.data.projectId);

      const { data, error } = await query;
      if (error) return databaseErrorResponse(error);

      const commandIds = (data ?? []).map((command) => command.id);
      const { data: tasks, error: tasksError } = commandIds.length
        ? await client
          .from("tasks")
          .select("id,command_id,status,title,risk_level,source")
          .eq("organization_id", activeOrganization.id)
          .in("command_id", commandIds)
        : { data: [], error: null };
      if (tasksError) return databaseErrorResponse(tasksError);

      const tasksByCommand = new Map<string, typeof tasks>();
      for (const task of tasks ?? []) {
        if (!task.command_id) continue;
        tasksByCommand.set(task.command_id, [...(tasksByCommand.get(task.command_id) ?? []), task]);
      }

      return jsonNoStore({
        activeOrganizationId: activeOrganization.id,
        commands: (data ?? []).map((command) => {
          const commandTasks = (tasksByCommand.get(command.id) ?? []).filter(
            (task) => task.source === "orchestrator",
          );
          const project = Array.isArray(command.projects) ? command.projects[0] : command.projects;
          return {
            id: command.id,
            prompt: command.prompt,
            requestedRisk: command.requested_risk,
            status: command.status,
            submittedAt: command.submitted_at,
            completedAt: command.completed_at,
            project: { id: command.project_id, name: project?.name ?? "Project" },
            planSummary:
              typeof (command.parameters as { planSummary?: unknown })?.planSummary === "string"
                ? (command.parameters as { planSummary: string }).planSummary
                : null,
            taskCount: commandTasks.length,
            completedTaskCount: commandTasks.filter((task) => task.status === "completed").length,
            failedTaskCount: commandTasks.filter((task) => task.status === "failed").length,
          };
        }),
      });
    },
    { code: "commands_unavailable", message: "Commands could not be loaded." },
  );
}

export async function POST(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      assertSameOriginRequest(request);
      const parsed = commandRequestSchema.safeParse(await readBoundedJson(request));
      if (!parsed.success) {
        return invalidRequest(
          "invalid_command",
          "Command submission is invalid.",
          z.flattenError(parsed.error).fieldErrors,
        );
      }

      const sensitiveFinding = findSensitiveData({
        prompt: parsed.data.prompt,
        parameters: parsed.data.parameters,
      });
      if (sensitiveFinding) {
        return jsonNoStore(
          {
            error: {
              code: "sensitive_data_rejected",
              message:
                "Commands cannot contain credentials, sensitive keys, or likely secret values.",
              path: sensitiveFinding.path,
            },
          },
          { status: 400 },
        );
      }

      const { data: submission, error: submissionError } = await client
        .rpc("submit_command", {
          p_project_id: parsed.data.projectId,
          p_prompt: parsed.data.prompt,
          p_requested_risk: parsed.data.risk,
          p_parameters: parsed.data.parameters,
          p_idempotency_key: parsed.data.idempotencyKey ?? null,
        })
        .single();
      if (submissionError) return databaseErrorResponse(submissionError);

      const result = submission as SubmissionResult;
      if (!result.was_created) {
        return jsonNoStore({
          command: { id: result.command_id, status: result.command_state },
          idempotentReplay: true,
          plan: null,
        });
      }

      const readiness = await readProjectReadiness(client, activeOrganization.id, parsed.data.projectId);
      const plan = planCommand({
        prompt: parsed.data.prompt,
        requestedRisk: parsed.data.risk,
        projectName: readiness.projectName,
        repositoryConnected: readiness.repositoryConnected,
        providerConnected: readiness.providerConnected,
        executionEnabled: readiness.executionEnabled,
      });

      const { data: planned, error: planError } = await client
        .rpc("persist_command_plan", {
          p_command_id: result.command_id,
          p_plan: {
            summary: plan.summary,
            intent: plan.intent,
            requiresOwnerAction: plan.requiresOwnerAction,
            tasks: plan.tasks.map((task) => ({
              key: task.key,
              title: task.title,
              description: task.description,
              acceptanceCriteria: task.acceptanceCriteria,
              agentRole: task.agentRole,
              workType: task.workType,
              risk: task.risk,
              priority: task.priority,
              dependsOn: task.dependsOn,
              validationPlan: task.validationPlan,
              provider: readiness.defaultProvider,
              model: readiness.defaultModel,
            })),
          },
        })
        .single();
      if (planError) return databaseErrorResponse(planError);

      const planResult = planned as PlanResult;
      return jsonNoStore(
        {
          command: { id: planResult.command_id, status: planResult.command_state },
          idempotentReplay: false,
          plan: {
            summary: plan.summary,
            intent: plan.intent,
            risk: plan.risk,
            requiresOwnerAction: plan.requiresOwnerAction,
            ownerActionReason: plan.ownerActionReason,
            taskCount: planResult.task_ids.length,
            runCount: planResult.run_ids.length,
            tasks: plan.tasks.map((task) => ({
              title: task.title,
              agentRole: task.agentRole,
              workType: task.workType,
              risk: task.risk,
              dependsOn: task.dependsOn,
            })),
          },
          execution: {
            started: false,
            message: plan.requiresOwnerAction
              ? `Persisted and planned only. Owner action is required: ${plan.ownerActionReason}.`
              : "Persisted and queued. A durable worker tick will pick this up; a queued run is not proof of completed work.",
          },
        },
        { status: 202 },
      );
    },
    { code: "command_rejected", message: "Command submission failed safely." },
  );
}

async function readProjectReadiness(
  client: TenantClient,
  organizationId: string,
  projectId: string,
) {
  const { data: project } = await client
    .from("projects")
    .select("id,name,github_repository")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const { data: settings } = await client
    .rpc("get_organization_settings", { p_organization_id: organizationId })
    .single();

  const settingsRow = settings as
    | { execution_enabled: boolean; default_provider: string; default_model: string }
    | null;
  const providerKey = settingsRow?.default_provider ?? DEFAULT_PROVIDER_KEY;
  const provider = findWorkerProvider(providerKey);

  return {
    projectName: project?.name ?? "this project",
    repositoryConnected: Boolean(project?.github_repository),
    providerConnected: Boolean(provider?.isConfigured()),
    executionEnabled: Boolean(settingsRow?.execution_enabled),
    defaultProvider: providerKey,
    defaultModel: settingsRow?.default_model ?? provider?.defaultModel ?? "gpt-5-codex",
  };
}

type TenantClient = Parameters<Parameters<typeof withTenant>[0]>[0]["client"];
