import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * The latest recorded usage observation per AI account, as the Bot Manager
 * shows it. Evidence only: rows are written by the auth-broker worker's
 * sweep, and an account with no row simply has no usage entry here — the
 * console says "no usage recorded yet" rather than inventing a number.
 *
 * Rolling compatibility: a database that predates the usage migration has no
 * `list_ai_account_usage` function. That reads as an empty usage list, not an
 * error — the accounts themselves still render, exactly as they did before
 * this feature existed.
 */

export const runtime = "nodejs";

type UsageWindowRow = {
  window_key: string;
  label: string;
  used_percent: number;
  resets_at?: string | null;
};

type UsageRow = {
  usage_account_id: string;
  usage_observed_at: string;
  usage_status: string;
  usage_windows: UsageWindowRow[];
  usage_detail: string | null;
  /**
   * The last observation whose probe actually returned numbers, carried
   * separately so one failed probe cannot erase them from the console.
   * Absent on a database that predates migration 20260819001100.
   */
  usage_measured_at?: string | null;
  usage_measured_windows?: UsageWindowRow[] | null;
};

function mapWindows(windows: UsageWindowRow[] | null | undefined) {
  return (windows ?? []).map((window) => ({
    key: window.window_key,
    label: window.label,
    usedPercent: window.used_percent,
    resetsAt: window.resets_at ?? null,
  }));
}

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("list_ai_account_usage", {
      p_organization_id: activeOrganization.id,
    });
    if (error) {
      // PGRST202: the function does not exist on this database yet. Absence
      // of the migration is absence of evidence, never an outage.
      if ((error as { code?: string }).code === "PGRST202") {
        return jsonNoStore({ usage: [] });
      }
      throw new Error("AI account usage could not be listed.");
    }

    const rows = (data ?? []) as UsageRow[];
    return jsonNoStore({
      usage: rows.map((row) => ({
        accountId: row.usage_account_id,
        observedAt: row.usage_observed_at,
        status: row.usage_status,
        windows: mapWindows(row.usage_windows),
        detail: row.usage_detail,
        lastMeasured: row.usage_measured_at
          ? {
            observedAt: row.usage_measured_at,
            windows: mapWindows(row.usage_measured_windows),
          }
          : null,
      })),
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "ai_account_usage_unavailable",
      "AI account usage could not be listed.",
    );
  }
}
