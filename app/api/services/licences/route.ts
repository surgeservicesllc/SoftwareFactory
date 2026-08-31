import {
  CRM_TECHNICIAN_COLUMNS,
  licenceDaysRemaining,
  toTechnicianView,
  type CrmTechnicianRow,
} from "@/lib/services/crm";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Applicator licences and when they lapse.
 *
 * Three buckets, and the third is the one that matters: expired, expiring
 * within sixty days, and **no expiry on file**. A licence with no date
 * recorded is not a current licence — it is an unknown — and folding those
 * into "fine" is how a compliance report becomes a liability. They are
 * counted and named separately.
 */

const HORIZON_DAYS = 60;

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_technicians")
      .select(CRM_TECHNICIAN_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("license_expires_on", { ascending: true, nullsFirst: false })
      .limit(600);
    if (error) return databaseErrorResponse(error);

    const today = new Date().toISOString().slice(0, 10);
    const roster = ((data ?? []) as unknown as CrmTechnicianRow[])
      .map(toTechnicianView)
      .map((technician) => {
        const days = licenceDaysRemaining(technician.licenseExpiresOn, today);
        return {
          ...technician,
          daysRemaining: days,
          state:
            technician.licenseNumber === null ? ("none" as const)
            : days === null ? ("unrecorded" as const)
            : days < 0 ? ("expired" as const)
            : days <= HORIZON_DAYS ? ("expiring" as const)
            : ("current" as const),
        };
      });

    const active = roster.filter((technician) => technician.active);
    const count = (state: string) => active.filter((technician) => technician.state === state).length;

    return jsonNoStore({
      technicians: roster,
      horizonDays: HORIZON_DAYS,
      counts: {
        onRoster: active.length,
        current: count("current"),
        expiring: count("expiring"),
        expired: count("expired"),
        // Not folded into "current". An unknown is not a pass.
        unrecorded: count("unrecorded"),
        noLicence: count("none"),
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_licences_unavailable", message: "Licences could not be read." } },
      { status: 500 },
    );
  }
}
