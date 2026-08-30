import { z } from "zod";

import {
  CRM_LOT_COLUMNS,
  CRM_MEASURE_UNITS,
  toLotView,
  type CrmLotRow,
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
 * Receive a lot: a traceable batch of one product. The remaining quantity
 * starts at what arrived and is drawn down by the database as applications
 * are recorded, so the shelf and the application log cannot disagree.
 */

const paramsSchema = z.object({ productId: z.string().uuid() }).strict();

const createSchema = z
  .object({
    lotNumber: z.string().trim().min(1).max(100),
    unit: z.enum(CRM_MEASURE_UNITS),
    quantityReceived: z.number().positive().max(1_000_000),
    receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.").optional(),
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.").nullish(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ productId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_product_id", message: "The product id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = createSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_product_lots")
      .insert({
        organization_id: activeOrganization.id,
        product_id: parsed.data.productId,
        lot_number: payload.lotNumber,
        unit: payload.unit,
        quantity_received: payload.quantityReceived,
        // A received lot is entirely on the shelf until something draws it.
        quantity_remaining: payload.quantityReceived,
        ...(payload.receivedOn ? { received_on: payload.receivedOn } : {}),
        expires_on: payload.expiresOn ?? null,
        created_by: user.id,
      })
      .select(CRM_LOT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "product_not_found", message: "No such product in this workspace." } },
          { status: 404 },
        );
      }
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "lot_number_taken",
              message: "That lot number is already recorded for this product.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ lot: toLotView(data as unknown as CrmLotRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_lot",
            message: error.issues[0]?.message ?? "The lot could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_lot_not_recorded", message: "The lot could not be recorded." } },
      { status: 500 },
    );
  }
}
