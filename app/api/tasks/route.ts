import { z } from "zod";

import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { forbidden, invalidRequest, isOrganizationManager, withTenant } from "@/lib/server/tenant-route";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const TASK_STATUSES = [
  "backlog",
  "awaiting_approval",
  "queued",
  "in_progress",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "superseded",
] as const;

const TASK_SOURCES = [
  "owner",
  "orchestrator",
  "ai_audit",
  "failed_test",
  "ci_failure",
  "security_finding",
  "incident",
  "feature_request",
] as const;

const querySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    risk: z.enum(["green", "yellow", "red"]).optional(),
    source: z.enum(TASK_SOURCES).optional(),
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

const upsertSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4000).optional(),
    acceptanceCriteria: z.string().trim().max(4000).optional(),
    risk: z.enum(["green", "yellow", "red"]).default("green"),
    priority: z.coerce.number().int().min(0).max(100).default(50),
    status: z.enum(TASK_STATUSES).default("backlog"),
    source: z.enum(TASK_SOURCES).default("owner"),
    assignedAgentId: z.string().uuid().nullable().optional(),
    dependsOnTaskId: z.string().uuid().nullable().optional(),
  })
  .strict();

type TaskListRow = {
  id: string;
  project_id: string;
  command_id: string | null;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: string;
  risk_level: string;
  priority: number;
  source: string;
  depends_on_task_id: string | null;
  pull_request_id: string | null;
  assigned_agent_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  projects: { name: string } | { name: string }[] | null;
  agents: { name: string; role: string } | { name: string; role: string }[] | null;
};

export async function GET(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse(
        Object.fromEntries(
          (["projectId", "status", "risk", "source", "search", "limit"] as const)
            .map((key) => [key, url.searchParams.get(key) ?? undefined])
            .filter(([, value]) => value !== undefined),
        ),
      );
      if (!parsed.success) {
        return invalidRequest("invalid_backlog_query", "The backlog query is invalid.");
      }

      let query = client
        .from("tasks")
        .select(
          "id,project_id,command_id,title,description,acceptance_criteria,status,risk_level,priority,source,"
            + "depends_on_task_id,pull_request_id,assigned_agent_id,created_at,updated_at,completed_at,"
            + "projects(name),agents(name,role)",
        )
        .eq("organization_id", activeOrganization.id)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(parsed.data.limit);

      if (parsed.data.projectId) query = query.eq("project_id", parsed.data.projectId);
      if (parsed.data.status) query = query.eq("status", parsed.data.status);
      if (parsed.data.risk) query = query.eq("risk_level", parsed.data.risk);
      if (parsed.data.source) query = query.eq("source", parsed.data.source);
      if (parsed.data.search) {
        // `%` and `,` would otherwise change the meaning of a PostgREST filter.
        const escaped = parsed.data.search.replace(/[%,]/g, " ");
        query = query.ilike("title", `%${escaped}%`);
      }

      const { data, error } = await query;
      if (error) return databaseErrorResponse(error);

      const single = <T,>(value: T | T[] | null | undefined): T | null =>
        Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

      return jsonNoStore({
        activeOrganizationId: activeOrganization.id,
        canManage: isOrganizationManager(activeOrganization),
        tasks: ((data ?? []) as unknown as TaskListRow[]).map((task) => {
          const project = single(task.projects);
          const agent = single(task.agents);
          return {
            id: task.id,
            title: task.title,
            description: task.description,
            acceptanceCriteria: task.acceptance_criteria,
            status: task.status,
            risk: task.risk_level,
            priority: task.priority,
            source: task.source,
            commandId: task.command_id,
            dependsOnTaskId: task.depends_on_task_id,
            pullRequestId: task.pull_request_id,
            project: { id: task.project_id, name: project?.name ?? "Project" },
            agent: agent ? { id: task.assigned_agent_id, name: agent.name, role: agent.role } : null,
            createdAt: task.created_at,
            updatedAt: task.updated_at,
            completedAt: task.completed_at,
          };
        }),
      });
    },
    { code: "backlog_unavailable", message: "The backlog could not be loaded." },
  );
}

export async function POST(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      assertSameOriginRequest(request);
      if (!isOrganizationManager(activeOrganization)) {
        return forbidden("Organization owner or administrator access is required to change the backlog.");
      }

      const parsed = upsertSchema.safeParse(await readBoundedJson(request, 32 * 1024));
      if (!parsed.success) {
        return invalidRequest(
          "invalid_backlog_item",
          "The backlog item is invalid.",
          z.flattenError(parsed.error).fieldErrors,
        );
      }
      if (findSensitiveData(parsed.data)) {
        return invalidRequest(
          "sensitive_data_rejected",
          "Backlog items cannot contain credentials or likely secret values.",
        );
      }

      const { data, error } = await client
        .rpc("upsert_backlog_task", {
          p_project_id: parsed.data.projectId,
          p_title: parsed.data.title,
          p_description: parsed.data.description ?? null,
          p_acceptance_criteria: parsed.data.acceptanceCriteria ?? null,
          p_risk: parsed.data.risk,
          p_priority: parsed.data.priority,
          p_status: parsed.data.status,
          p_source: parsed.data.source,
          p_assigned_agent_id: parsed.data.assignedAgentId ?? null,
          p_depends_on_task_id: parsed.data.dependsOnTaskId ?? null,
          p_task_id: parsed.data.taskId ?? null,
        })
        .single();
      if (error) return databaseErrorResponse(error);

      const task = data as { id: string; status: string; title: string; risk_level: string };
      return jsonNoStore(
        {
          task: { id: task.id, title: task.title, status: task.status, risk: task.risk_level },
        },
        { status: parsed.data.taskId ? 200 : 201 },
      );
    },
    { code: "backlog_write_failed", message: "The backlog item could not be saved." },
  );
}
