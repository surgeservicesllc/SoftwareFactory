import {
  toPortalVisitView,
  type CrmPortalVisitRow,
} from "@/lib/services/crm";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/** Service history and what is on the calendar, for one account. */
export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_visits");
    if (error) throw error;

    const visits = ((data ?? []) as CrmPortalVisitRow[]).map(toPortalVisitView);
    const now = Date.now();

    return jsonNoStore({
      visits,
      counts: {
        total: visits.length,
        completed: visits.filter((visit) => visit.completedAt !== null).length,
        upcoming: visits.filter(
          (visit) =>
            visit.completedAt === null &&
            visit.scheduledStart !== null &&
            Date.parse(visit.scheduledStart) >= now,
        ).length,
      },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_visits_unavailable", "Your service history could not be loaded.");
  }
}
