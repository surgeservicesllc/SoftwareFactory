import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { invalidRequest, withTenant } from "@/lib/server/tenant-route";

export const runtime = "nodejs";

const querySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    provider: z.string().trim().max(64).optional(),
    status: z
      .enum(["queued", "running", "validating", "awaiting_review", "cancelling", "succeeded", "failed", "cancelled"])
      .optional(),
    risk: z.enum(["green", "yellow", "red"]).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

type RunListRow = {
  id: string;
  project_id: string;
  task_id: string;
  agent_id: string;
  status: string;
  provider: string | null;
  model: string | null;
  step: string | null;
  attempt: number;
  failure_kind: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  projects: { name: string } | { name: string }[] | null;
  agents: { name: string; role: string } | { name: string; role: string }[] | null;
  tasks:
    | { title: string; risk_level: string; command_id: string | null }
    | { title: string; risk_level: string; command_id: string | null }[]
    | null;
};

export async function GET(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse(
        Object.fromEntries(
          (["projectId", "agentId", "provider", "status", "risk", "since", "limit"] as const)
            .map((key) => [key, url.searchParams.get(key) ?? undefined])
            .filter(([, value]) => value !== undefined),
        ),
      );
      if (!parsed.success) {
        return invalidRequest("invalid_run_query", "The run query is invalid.");
      }

      let query = client
        .from("agent_runs")
        .select(
          "id,project_id,task_id,agent_id,status,provider,model,step,attempt,failure_kind,started_at,completed_at,created_at,error_message,"
            + "projects(name),agents(name,role),tasks(title,risk_level,command_id)",
        )
        .eq("organization_id", activeOrganization.id)
        .order("created_at", { ascending: false })
        .limit(parsed.data.limit);

      if (parsed.data.projectId) query = query.eq("project_id", parsed.data.projectId);
      if (parsed.data.agentId) query = query.eq("agent_id", parsed.data.agentId);
      if (parsed.data.provider) query = query.eq("provider", parsed.data.provider);
      if (parsed.data.status) query = query.eq("status", parsed.data.status);
      if (parsed.data.since) query = query.gte("created_at", parsed.data.since);

      const { data, error } = await query;
      if (error) return databaseErrorResponse(error);

      const runRows = (data ?? []) as unknown as RunListRow[];
      const runIds = runRows.map((run) => run.id);
      const [{ data: workspaces }, { data: pullRequests }, { data: results }] = await Promise.all([
        runIds.length
          ? client.from("run_workspaces").select("agent_run_id,working_branch,repository").in("agent_run_id", runIds)
          : Promise.resolve({ data: [] }),
        runIds.length
          ? client.from("pull_requests").select("agent_run_id,external_number,url,status").in("agent_run_id", runIds)
          : Promise.resolve({ data: [] }),
        runIds.length
          ? client.from("run_results").select("agent_run_id,summary,files_changed,tests_outcome").in("agent_run_id", runIds)
          : Promise.resolve({ data: [] }),
      ]);

      const workspaceByRun = new Map((workspaces ?? []).map((row) => [row.agent_run_id, row]));
      const pullRequestByRun = new Map((pullRequests ?? []).map((row) => [row.agent_run_id, row]));
      const resultByRun = new Map((results ?? []).map((row) => [row.agent_run_id, row]));

      const single = <T,>(value: T | T[] | null | undefined): T | null =>
        Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

      const runs = runRows
        .map((run) => {
          const task = single(run.tasks);
          const agent = single(run.agents);
          const project = single(run.projects);
          const workspace = workspaceByRun.get(run.id);
          const pullRequest = pullRequestByRun.get(run.id);
          const result = resultByRun.get(run.id);

          return {
            id: run.id,
            status: run.status,
            step: run.step,
            attempt: run.attempt,
            failureKind: run.failure_kind,
            errorMessage: run.error_message,
            provider: run.provider,
            model: run.model,
            risk: task?.risk_level ?? "green",
            commandId: task?.command_id ?? null,
            task: { id: run.task_id, title: task?.title ?? "Task" },
            agent: { id: run.agent_id, name: agent?.name ?? "Agent", role: agent?.role ?? "custom" },
            project: { id: run.project_id, name: project?.name ?? "Project" },
            startedAt: run.started_at,
            completedAt: run.completed_at,
            createdAt: run.created_at,
            durationMs:
              run.started_at && run.completed_at
                ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
                : null,
            branch: workspace?.working_branch ?? null,
            repository: workspace?.repository ?? null,
            pullRequest: pullRequest
              ? { number: pullRequest.external_number, url: pullRequest.url, status: pullRequest.status }
              : null,
            resultSummary: result?.summary ?? null,
            filesChanged: result?.files_changed ?? null,
            testsOutcome: result?.tests_outcome ?? null,
          };
        })
        .filter((run) => !parsed.data.risk || run.risk === parsed.data.risk);

      return jsonNoStore({ activeOrganizationId: activeOrganization.id, runs });
    },
    { code: "runs_unavailable", message: "Runs could not be loaded." },
  );
}
