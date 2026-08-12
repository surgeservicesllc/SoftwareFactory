import { lookupNames, tenantListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

type TaskRow = {
  id: string;
  project_id: string | null;
  assigned_agent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  risk_level: string;
  requires_owner_approval: boolean;
  priority: number;
  created_at: string;
};

export async function GET(request: Request) {
  return tenantListResponse<TaskRow>({
    request,
    table: "tasks",
    columns: "id,project_id,assigned_agent_id,title,description,status,risk_level,requires_owner_approval,priority,created_at",
    // Highest priority first; the column is 0-100 with 100 most urgent.
    orderColumn: "priority",
    unavailableCode: "tasks_unavailable",
    unavailableMessage: "The backlog could not be loaded.",
    shape: async (rows, context) => {
      const [projects, agents] = await Promise.all([
        lookupNames(context, "projects", rows.map((row) => row.project_id)),
        lookupNames(context, "agents", rows.map((row) => row.assigned_agent_id)),
      ]);
      return {
        tasks: rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          risk: row.risk_level,
          requiresOwnerApproval: row.requires_owner_approval,
          priority: row.priority,
          createdAt: row.created_at,
          project: row.project_id
            ? { id: row.project_id, name: projects.get(row.project_id) ?? "Project" }
            : null,
          agent: row.assigned_agent_id
            ? { id: row.assigned_agent_id, name: agents.get(row.assigned_agent_id) ?? "Agent" }
            : null,
        })),
      };
    },
  });
}
