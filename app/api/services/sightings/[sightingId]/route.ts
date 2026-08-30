import { z } from "zod";

import {
  CRM_SIGHTING_COLUMNS,
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
 * Resolve one sighting by recording its corrective action — the IPM loop's
 * closing verb. The action and its timestamp land together; the schema's
 * CHECK refuses one without the other, and nothing here deletes anything.
 */

const paramsSchema = z.object({ sightingId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    correctiveAction: z.string().trim().min(1).max(1000),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sightingId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_sighting_id", message: "The sighting id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = patchSchema.parse(await readBoundedJson(request, 16_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_pest_sightings")
      .update({
        corrective_action: payload.correctiveAction,
        corrected_at: new Date().toISOString(),
      })
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.sightingId)
      .select(CRM_SIGHTING_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "sighting_not_found", message: "No such sighting in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ sighting: toSightingView(data as unknown as CrmSightingRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_corrective_action",
            message: error.issues[0]?.message ?? "The corrective action could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_sighting_not_updated", message: "The sighting could not be updated." } },
      { status: 500 },
    );
  }
}
