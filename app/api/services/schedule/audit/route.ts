import {
  summarizeFindings,
  toScheduleFindingView,
  type CrmScheduleFindingRow,
} from "@/lib/services/nothing-hidden";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The schedule audit: every contradiction in the next N days, named, with
 * the rows involved. Computed by `crm_schedule_audit` under the caller's
 * RLS on every read; nothing is stored, so a fixed conflict disappears the
 * moment it is fixed.
 */

const FINDING_CEILING = 500;

function window(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const days = window(new URL(request.url).searchParams.get("days"), 14, 90);
    const read = await client
      .rpc("crm_schedule_audit", { p_organization: activeOrganization.id, p_days: days })
      .limit(FINDING_CEILING);
    if (read.error) return databaseErrorResponse(read.error);
    const findings = ((read.data ?? []) as unknown as CrmScheduleFindingRow[]).map(toScheduleFindingView);
    return jsonNoStore({
      organizationId: activeOrganization.id,
      window: { days },
      findings,
      summary: summarizeFindings(findings),
      ceiling: { findings: FINDING_CEILING, reached: findings.length >= FINDING_CEILING },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_schedule_audit_unavailable", message: "The schedule audit could not be read." } },
      { status: 500 },
    );
  }
}
