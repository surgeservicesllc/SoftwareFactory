import {
  CRM_AUTOMATION_COLUMNS,
  toAutomationView,
  type CrmAutomationRow,
} from "@/lib/services/crm";
import {
  summarizeDryRun,
  toDryRunRecordView,
  type CrmDryRunRow,
} from "@/lib/services/nothing-hidden";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * An automation's dry run: exactly which records the rule would touch
 * right now, what it would do to each, and why it would not. Read-only by
 * construction — `crm_automation_dry_run` is a STABLE function — so the
 * rule's own run counters cannot move. Nothing runs these rules; the send
 * behind a sending action is Not Connected, and the page says so.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function window(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const params = new URL(request.url).searchParams;
    const automationId = params.get("automationId") ?? "";
    if (!UUID.test(automationId)) {
      return jsonNoStore(
        { error: { code: "invalid_automation", message: "automationId must be an id." } },
        { status: 400 },
      );
    }
    const days = window(params.get("days"), 30, 365);

    const ruleRead = await client
      .from("crm_automations")
      .select(CRM_AUTOMATION_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", automationId)
      .maybeSingle();
    if (ruleRead.error) return databaseErrorResponse(ruleRead.error);
    if (!ruleRead.data) {
      return jsonNoStore(
        { error: { code: "not_found", message: "That automation is not in this workspace." } },
        { status: 404 },
      );
    }

    const read = await client
      .rpc("crm_automation_dry_run", {
        p_organization: activeOrganization.id,
        p_automation: automationId,
        p_days: days,
      })
      .limit(1000);
    if (read.error) return databaseErrorResponse(read.error);
    const records = ((read.data ?? []) as unknown as CrmDryRunRow[]).map(toDryRunRecordView);
    return jsonNoStore({
      automation: toAutomationView(ruleRead.data as unknown as CrmAutomationRow),
      window: { days },
      records,
      summary: summarizeDryRun(records),
      execution: { connected: false, label: "Not Connected" },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_dry_run_unavailable", message: "The dry run could not be read." } },
      { status: 500 },
    );
  }
}
