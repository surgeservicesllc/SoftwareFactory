import {
  CRM_DEVICE_COLUMNS,
  CRM_DEVICE_EVENT_COLUMNS,
  CRM_SIGHTING_COLUMNS,
  toDeviceEventView,
  toDeviceView,
  toSightingView,
  type CrmDeviceEventRow,
  type CrmDeviceRow,
  type CrmSightingRow,
} from "@/lib/services/crm";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The IPM dashboard's one read: every station, the newest slice of the scan
 * ledger, every sighting, and the property labels to hang them on — all
 * org-scoped rows under RLS. Rollups (per-site counts, over-threshold
 * flags, trends) are computed by the page from these same rows, so the
 * dashboard and its detail can never disagree.
 */

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const [devices, events, sightings, properties] = await Promise.all([
      client
        .from("crm_devices")
        .select(CRM_DEVICE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("label", { ascending: true })
        .limit(500),
      client
        .from("crm_device_events")
        .select(CRM_DEVICE_EVENT_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("recorded_at", { ascending: false })
        .limit(500),
      client
        .from("crm_pest_sightings")
        .select(CRM_SIGHTING_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("sighted_at", { ascending: false })
        .limit(200),
      client
        .from("crm_properties")
        .select("id, account_id, label")
        .eq("organization_id", activeOrganization.id)
        .limit(500),
    ]);
    for (const result of [devices, events, sightings, properties]) {
      if (result.error) return databaseErrorResponse(result.error);
    }

    return jsonNoStore({
      devices: ((devices.data ?? []) as unknown as CrmDeviceRow[]).map(toDeviceView),
      recentEvents: ((events.data ?? []) as unknown as CrmDeviceEventRow[]).map(toDeviceEventView),
      sightings: ((sightings.data ?? []) as unknown as CrmSightingRow[]).map(toSightingView),
      properties: ((properties.data ?? []) as { id: string; account_id: string; label: string }[]).map(
        (row) => ({ id: row.id, accountId: row.account_id, label: row.label }),
      ),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_ipm_unavailable", message: "The IPM dashboard could not be read." } },
      { status: 500 },
    );
  }
}
