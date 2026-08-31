import {
  toPortalWdoReportView,
  toWdoFindingView,
  type CrmPortalWdoReportRow,
  type CrmWdoFindingRow,
} from "@/lib/services/crm";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/**
 * The customer's copy of their WDO reports.
 *
 * Issued reports only — a draft is not a document, and showing one would
 * let an unfinished inspection read as a finding. When the caller names a
 * report, its marks come back too, so the customer sees the same diagram
 * the inspector drew.
 */
export async function GET(request: Request) {
  try {
    const { client } = await requirePortalUser();
    const inspectionId = new URL(request.url).searchParams.get("inspectionId");

    const { data, error } = await client.rpc("crm_portal_wdo_reports");
    if (error) throw error;
    const reports = ((data ?? []) as CrmPortalWdoReportRow[]).map(toPortalWdoReportView);

    let findings: ReturnType<typeof toWdoFindingView>[] = [];
    if (inspectionId !== null) {
      const marks = await client.rpc("crm_portal_wdo_findings", { p_inspection: inspectionId });
      if (marks.error) throw marks.error;
      findings = ((marks.data ?? []) as CrmWdoFindingRow[]).map(toWdoFindingView);
    }

    return jsonNoStore({
      reports,
      findings,
      counts: {
        total: reports.length,
        /*
         * Counted over issued reports, which is all a customer can see.
         * `superseded` is carried per row as well: a customer reading an
         * older report needs to know a newer one replaced it.
         */
        withEvidence: reports.filter((report) => report.visibleEvidence).length,
        clean: reports.filter((report) => !report.visibleEvidence).length,
        superseded: reports.filter((report) => report.superseded).length,
        /*
         * Reports that name something they could not inspect. This is the
         * number a buyer's surveyor asks about first, so it is counted
         * rather than left to be found by reading every report.
         */
        withLimitations: reports.filter(
          (report) => report.obstructions !== null || report.inaccessibleAreas !== null,
        ).length,
      },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_wdo_unavailable", "Your reports could not be loaded.");
  }
}
