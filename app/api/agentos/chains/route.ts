import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

/**
 * Template chains and where each one has reached.
 *
 * The current step is the earliest unfinished one, which is what a human is
 * actually waiting on, and it carries whether that step is approval-gated.
 */
type Row = {
  id: string;
  title: string;
  template_name: string;
  project_name: string;
  total_steps: number;
  done_steps: number;
  current_step_name: string | null;
  current_step_state: string | null;
  current_step_gated: boolean | null;
  created_at: string;
};

export async function GET(request: Request) {
  return tenantRpcListResponse<Row>({
    request,
    rpc: "agentos_list_chains",
    unavailableCode: "agentos_chains_unavailable",
    unavailableMessage: "Task chains could not be loaded.",
    shape: (rows) => ({
      chains: rows.map((row) => ({
        id: row.id,
        title: row.title,
        templateName: row.template_name,
        projectName: row.project_name,
        progress: { total: row.total_steps, done: row.done_steps },
        currentStep: row.current_step_name === null ? null : {
          name: row.current_step_name,
          state: row.current_step_state,
          approvalGate: row.current_step_gated ?? false,
        },
        createdAt: row.created_at,
      })),
    }),
  });
}
