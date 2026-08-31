import { toPortalSiteView, type CrmPortalSiteRow } from "@/lib/services/crm";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/**
 * A commercial account is rarely one address. This is the list every other
 * commercial read filters by.
 */
export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_sites");
    if (error) throw error;

    const sites = ((data ?? []) as CrmPortalSiteRow[]).map(toPortalSiteView);

    return jsonNoStore({
      sites,
      counts: {
        total: sites.length,
        activeDevices: sites.reduce((sum, site) => sum + site.activeDevices, 0),
        openSightings: sites.reduce((sum, site) => sum + site.openSightings, 0),
        /*
         * Sites with nothing on the calendar. A commercial customer under a
         * contract wants to know this number is zero, so it is counted
         * rather than left for them to spot by reading every row.
         */
        withoutNextVisit: sites.filter((site) => site.nextVisitAt === null).length,
      },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_sites_unavailable", "Your sites could not be loaded.");
  }
}
