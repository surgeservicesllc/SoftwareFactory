import { z } from "zod";

import {
  stationStanding,
  toPortalStationView,
  toPortalTrendView,
  type CrmPortalStationRow,
  type CrmPortalTrendRow,
} from "@/lib/services/crm";
import { ApiRequestError, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

const querySchema = z
  .object({
    propertyId: z.string().uuid().nullish(),
    months: z.coerce.number().int().min(1).max(36).default(12),
  })
  .strict();

/**
 * The stations and their trend, in one read — the two halves of the same
 * page, and asking for them separately would let one render against a
 * property filter the other had not applied yet.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      months: url.searchParams.get("months") ?? undefined,
    });
    const propertyId = parsed.propertyId ?? null;

    const { client } = await requirePortalUser();

    const [stationResult, trendResult] = await Promise.all([
      client.rpc("crm_portal_devices", { p_property_id: propertyId }),
      client.rpc("crm_portal_device_trend", {
        p_months: parsed.months,
        p_property_id: propertyId,
      }),
    ]);
    if (stationResult.error) throw stationResult.error;
    if (trendResult.error) throw trendResult.error;

    const stations = ((stationResult.data ?? []) as CrmPortalStationRow[]).map(toPortalStationView);
    const trend = ((trendResult.data ?? []) as CrmPortalTrendRow[]).map(toPortalTrendView);
    const standings = stations.map(stationStanding);

    return jsonNoStore({
      months: parsed.months,
      propertyId,
      stations,
      trend,
      counts: {
        total: stations.length,
        active: stations.filter((station) => station.status === "active").length,
        flagged: standings.filter((standing) => standing === "flagged").length,
        /*
         * Stations whose last scan answers nothing — never serviced, or
         * serviced with no count against no threshold. This is the number
         * an auditor asks about, and rolling it into "clear" would be the
         * single most damaging rounding on the page.
         */
        unknown: standings.filter((standing) => standing === "unknown").length,
        clear: standings.filter((standing) => standing === "clear").length,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_station_query",
            message: error.issues[0]?.message ?? "That filter could not be read.",
          },
        },
        { status: 422 },
      );
    }
    return portalErrorResponse(error, "portal_stations_unavailable", "Your stations could not be loaded.");
  }
}
