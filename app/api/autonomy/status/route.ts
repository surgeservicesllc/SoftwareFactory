import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

/**
 * What the loop is permitted to do right now, per project.
 *
 * The interlocks travel with the flags on purpose: nine OFF actions without
 * the kill switch and executor state beside them could read as "ready but
 * idle" rather than "nothing can run".
 */
type Row = {
  project_id: string;
  project_name: string;
  autonomous_mode: boolean;
  maximum_autonomous_risk: string;
  risk_ceiling_source: string;
  kill_switch_active: boolean;
  release_frozen: boolean;
  executor_connected: boolean;
  enabled_action_count: number;
  total_action_count: number;
  decisions_recorded: number;
  last_decision_at: string | null;
};

export async function GET(request: Request) {
  return tenantRpcListResponse<Row>({
    request,
    rpc: "list_autonomy_status",
    unavailableCode: "autonomy_status_unavailable",
    unavailableMessage: "Autonomy status could not be loaded.",
    shape: (rows) => ({
      status: rows.map((row) => ({
        projectId: row.project_id,
        projectName: row.project_name,
        autonomousMode: row.autonomous_mode,
        riskCeiling: row.maximum_autonomous_risk,
        riskCeilingSource: row.risk_ceiling_source,
        killSwitchActive: row.kill_switch_active,
        releaseFrozen: row.release_frozen,
        executorConnected: row.executor_connected,
        actions: { enabled: row.enabled_action_count, total: row.total_action_count },
        decisionsRecorded: row.decisions_recorded,
        lastDecisionAt: row.last_decision_at,
      })),
    }),
  });
}
