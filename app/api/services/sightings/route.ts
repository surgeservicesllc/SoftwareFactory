import { z } from "zod";

import {
  CRM_SIGHTING_COLUMNS,
  CRM_SIGHTING_SEVERITIES,
  toSightingView,
  type CrmSightingRow,
} from "@/lib/services/crm";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Log a pest sighting — where the IPM workflow starts. Resolution happens
 * on the sighting itself (a corrective action recorded, never a deletion),
 * through the [sightingId] route.
 */

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    propertyId: z.string().uuid(),
    pest: z.string().trim().min(1).max(120),
    severity: z.enum(CRM_SIGHTING_SEVERITIES).default("moderate"),
    locationNote: z.string().trim().min(1).max(300).nullish(),
    note: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_pest_sightings")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        property_id: payload.propertyId,
        pest: payload.pest,
        severity: payload.severity,
        location_note: payload.locationNote ?? null,
        note: payload.note ?? null,
        created_by: user.id,
      })
      .select(CRM_SIGHTING_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message:
                "The account or property is not in this workspace — and the property must belong to the account.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ sighting: toSightingView(data as unknown as CrmSightingRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_sighting",
            message: error.issues[0]?.message ?? "The sighting could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_sighting_not_recorded", message: "The sighting could not be recorded." } },
      { status: 500 },
    );
  }
}
