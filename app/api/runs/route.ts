import { lookupNames, tenantListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

type RunRow = {
  id: string;
  project_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  return tenantListResponse<RunRow>({
    request,
    table: "agent_runs",
    // `input` and `output` are deliberately excluded: run payloads can carry
    // file contents or provider detail that has no business in the browser.
    columns: "id,project_id,task_id,agent_id,status,error_message,started_at,completed_at,created_at",
    orderColumn: "created_at",
    unavailableCode: "runs_unavailable",
    unavailableMessage: "Runs could not be loaded.",
    shape: async (rows, context) => {
      const [tasks, agents] = await Promise.all([
        lookupNames(context, "tasks", rows.map((row) => row.task_id), "title"),
        lookupNames(context, "agents", rows.map((row) => row.agent_id)),
      ]);
      return {
        runs: rows.map((row) => ({
          id: row.id,
          status: row.status,
          errorMessage: row.error_message,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          createdAt: row.created_at,
          durationMs: row.started_at && row.completed_at
            ? Math.max(0, Date.parse(row.completed_at) - Date.parse(row.started_at))
            : null,
          task: row.task_id
            ? { id: row.task_id, title: tasks.get(row.task_id) ?? "Task" }
            : null,
          agent: row.agent_id
            ? { id: row.agent_id, name: agents.get(row.agent_id) ?? "Agent" }
            : null,
        })),
      };
    },
  });
}
