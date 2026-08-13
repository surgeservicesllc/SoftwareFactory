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
};

export async function GET(request: Request) {
  return tenantRpcListResponse<TaskRow>({
    request,
    rpc: "list_tasks",
    unavailableCode: "tasks_unavailable",
    unavailableMessage: "The backlog could not be loaded.",
    shape: (rows) => ({
        tasks: rows.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          risk: row.risk_level,
          requiresOwnerApproval: row.requires_owner_approval,
          priority: row.priority,
          createdAt: row.created_at,
          project: row.project_id
            ? { id: row.project_id, name: row.project_name ?? "Project" }
            : null,
          agent: row.assigned_agent_id
            ? { id: row.assigned_agent_id, name: row.agent_name ?? "Agent" }
            : null,
        })),
      }),
  });
}
