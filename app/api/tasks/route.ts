import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

type TaskRow = {
  id: string;
  project_id: string | null;
  assigned_agent_id: string | null;
  title: string;
  status: string;
  risk_level: string;
  requires_owner_approval: boolean;
  priority: number;
  created_at: string;
  project_name: string | null;
  agent_name: string | null;
  command_id?: string | null;
  command_prompt?: string | null;
  dependency_count?: number | null;
  latest_run_id?: string | null;
  latest_run_status?: string | null;
  pull_request_number?: number | null;
  pull_request_url?: string | null;
  pull_request_status?: string | null;
};

function briefingTask(row: TaskRow) {
  return {
    id: row.id,
    status: row.status,
    risk: row.risk_level,
    requiresOwnerApproval: row.requires_owner_approval,
    priority: row.priority,
    createdAt: row.created_at,
    dependencyCount: row.dependency_count ?? 0,
    project: row.project_id
      ? { id: row.project_id, name: row.project_name ?? "Project" }
      : null,
    agent: row.assigned_agent_id
      ? { id: row.assigned_agent_id, name: row.agent_name ?? "Agent" }
      : null,
    latestRun: row.latest_run_id
      ? { id: row.latest_run_id, status: row.latest_run_status ?? "queued" }
      : null,
    pullRequest: row.pull_request_number
      ? {
          number: row.pull_request_number,
          url: row.pull_request_url ?? null,
        }
      : null,
  };
}

function fullTask(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    risk: row.risk_level,
    requiresOwnerApproval: row.requires_owner_approval,
    priority: row.priority,
    createdAt: row.created_at,
    dependencyCount: row.dependency_count ?? 0,
    project: row.project_id
      ? { id: row.project_id, name: row.project_name ?? "Project" }
      : null,
    agent: row.assigned_agent_id
      ? { id: row.assigned_agent_id, name: row.agent_name ?? "Agent" }
      : null,
    command: row.command_id
      ? { id: row.command_id, prompt: row.command_prompt ?? null }
      : null,
    latestRun: row.latest_run_id
      ? { id: row.latest_run_id, status: row.latest_run_status ?? "queued" }
      : null,
    pullRequest: row.pull_request_number
      ? {
          number: row.pull_request_number,
          url: row.pull_request_url ?? null,
          status: row.pull_request_status ?? "draft",
        }
      : null,
  };
}

export async function GET(request: Request) {
  const briefing = new URL(request.url).searchParams.get("view") === "briefing";

  return tenantRpcListResponse<TaskRow>({
    request,
    rpc: "list_tasks",
    unavailableCode: "tasks_unavailable",
    unavailableMessage: "The backlog could not be loaded.",
    shape: (rows) => ({
      tasks: rows.map((row) => briefing ? briefingTask(row) : fullTask(row)),
    }),
  });
}
