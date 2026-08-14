import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

/**
 * Goals and the state of their rails.
 *
 * Spend, time and repetition travel with every row so the console can show
 * why a goal stopped without a second request.
 */
type Row = {
  id: string;
  title: string;
  status: string;
  project_name: string;
  dod_total: number;
  dod_satisfied: number;
  spend_cap_usd: string | null;
  spent_usd: string;
  uncapped_acknowledged: boolean;
  max_duration_minutes: number | null;
  stuck_threshold: number;
  iterations: number;
  stopped_reason: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  return tenantRpcListResponse<Row>({
    request,
    rpc: "agentos_list_goals",
    unavailableCode: "agentos_goals_unavailable",
    unavailableMessage: "Goals could not be loaded.",
    shape: (rows) => ({
      goals: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        projectName: row.project_name,
        definitionOfDone: { total: row.dod_total, satisfied: row.dod_satisfied },
        spend: {
          capUsd: row.spend_cap_usd,
          spentUsd: row.spent_usd,
          // Whether someone accepted running uncapped, not who.
          uncappedAcknowledged: row.uncapped_acknowledged,
        },
        maxDurationMinutes: row.max_duration_minutes,
        stuckThreshold: row.stuck_threshold,
        iterations: row.iterations,
        stoppedReason: row.stopped_reason,
        createdAt: row.created_at,
      })),
    }),
  });
}
