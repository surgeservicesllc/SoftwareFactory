import { z } from "zod";

import { CRM_PROPERTY_COLUMNS, toPropertyView, type CrmPropertyRow } from "@/lib/services/crm";
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
 * Add a property/site to an account — the unit the field-service and IPM
 * increments will hang work orders, device maps and chemical applications
 * on. A commercial account accumulates many; a residential one usually has
 * exactly its home.
 */

const paramsSchema = z.object({ accountId: z.string().uuid() }).strict();

const propertySchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    address: z.string().trim().min(1).max(500),
    propertyType: z.string().trim().min(1).max(120).nullish(),
    accessNotes: z.string().trim().min(1).max(2000).nullish(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_account_id", message: "The account id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = propertySchema.parse(await readBoundedJson(request, 16_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_properties")
      .insert({
        organization_id: activeOrganization.id,
        account_id: parsed.data.accountId,
        label: payload.label,
        address: payload.address,
        property_type: payload.propertyType ?? null,
        access_notes: payload.accessNotes ?? null,
      })
      .select(CRM_PROPERTY_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "account_not_found", message: "No such account in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ property: toPropertyView(data as unknown as CrmPropertyRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_property",
            message: error.issues[0]?.message ?? "The property could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_property_not_recorded", message: "The property could not be recorded." } },
      { status: 500 },
    );
  }
}
