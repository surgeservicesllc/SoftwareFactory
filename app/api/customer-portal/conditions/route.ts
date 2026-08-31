import { z } from "zod";

import {
  CRM_SIGHTING_SEVERITIES,
  toPortalConditionView,
  type CrmPortalConditionRow,
} from "@/lib/services/crm";
import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * What is open right now: sightings nobody has corrected, and stations
 * whose last scan came back wrong. The customer may add to this list — a
 * sighting reported at 06:00 should not wait for the branch to open — but
 * there is no PATCH and no DELETE. Closing a condition is the company's
 * act, recorded against the sighting with the action that closed it.
 */

const reportSchema = z
  .object({
    propertyId: z.string().uuid("Name one of your sites."),
    pest: z.string().trim().min(1, "Say what you saw.").max(120),
    severity: z.enum(CRM_SIGHTING_SEVERITIES as unknown as [string, ...string[]]).default("moderate"),
    locationNote: z.string().trim().min(1).max(300).nullish(),
    note: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_conditions");
    if (error) throw error;

    const conditions = ((data ?? []) as CrmPortalConditionRow[]).map(toPortalConditionView);

    return jsonNoStore({
      conditions,
      counts: {
        total: conditions.length,
        sightings: conditions.filter((condition) => condition.kind === "sighting").length,
        stations: conditions.filter((condition) => condition.kind === "device").length,
        high: conditions.filter((condition) => condition.severity === "high").length,
        reportedByCustomer: conditions.filter((condition) => condition.reportedByCustomer).length,
      },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_conditions_unavailable", "Your open conditions could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = reportSchema.parse(await readBoundedJson(request, 32_000));
    const { client } = await requirePortalUser();

    const { data, error } = await client.rpc("crm_portal_report_sighting", {
      p_property_id: payload.propertyId,
      p_pest: payload.pest,
      p_severity: payload.severity,
      p_location_note: payload.locationNote ?? null,
      p_note: payload.note ?? null,
    });
    if (error) {
      // The function refuses another account's site by name; that refusal
      // is the customer's answer, not a 500.
      if (error.code === "23514" || /not on this account/i.test(error.message ?? "")) {
        return jsonNoStore(
          {
            error: {
              code: "property_not_on_account",
              message: "That site is not on your account.",
            },
          },
          { status: 404 },
        );
      }
      throw error;
    }

    return jsonNoStore({ sightingId: data as string }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_sighting",
            message: error.issues[0]?.message ?? "That sighting could not be recorded.",
          },
        },
        { status: 422 },
      );
    }
    return portalErrorResponse(error, "portal_sighting_not_recorded", "Your sighting could not be recorded.");
  }
}
