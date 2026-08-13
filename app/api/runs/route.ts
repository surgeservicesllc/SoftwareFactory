import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

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
};

export async function GET(request: Request) {
  return tenantRpcListResponse<RunRow>({
    request,
    rpc: "list_agent_runs",
    unavailableCode: "runs_unavailable",
    unavailableMessage: "Runs could not be loaded.",
    shape: (rows) => ({
        runs: rows.map((row) => ({
          id: row.id,
          status: row.status,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          createdAt: row.created_at,
          durationMs: row.started_at && row.completed_at
            ? Math.max(0, Date.parse(row.completed_at) - Date.parse(row.started_at))
            : null,
          task: row.task_id
            ? { id: row.task_id, title: row.task_title ?? "Task" }
            : null,
          agent: row.agent_id
            ? { id: row.agent_id, name: row.agent_name ?? "Agent" }
            : null,
        })),
      }),
  });
}
