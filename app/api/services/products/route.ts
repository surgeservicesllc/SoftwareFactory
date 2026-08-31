import { z } from "zod";

import {
  CRM_EPA_PATTERN,
  CRM_LOT_COLUMNS,
  CRM_MEASURE_UNITS,
  CRM_PRODUCT_COLUMNS,
  CRM_SIGNAL_WORDS,
  toLotView,
  toProductView,
  type CrmLotRow,
  type CrmProductRow,
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
 * The chemical catalogue: what this workspace is licensed to apply, and
 * the lots on the shelf. Products and lots come back together because the
 * application form needs both to name one bottle honestly — and because a
 * lot's remaining quantity is only meaningful beside its product.
 *
 * SDS and label references must be https: a compliance officer follows the
 * link the workspace recorded, so it cannot be a bare string.
 */

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    epaRegistrationNumber: z
      .string()
      .trim()
      .regex(CRM_EPA_PATTERN, "An EPA registration number, like 499-507.")
      .nullish(),
    activeIngredient: z.string().trim().min(1).max(200).nullish(),
    signalWord: z.enum(CRM_SIGNAL_WORDS).nullish(),
    sdsUrl: z.string().trim().url().startsWith("https://").max(500).nullish(),
    labelUrl: z.string().trim().url().startsWith("https://").max(500).nullish(),
    restrictedUse: z.boolean().default(false),
    defaultUnit: z.enum(CRM_MEASURE_UNITS).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const [products, lots] = await Promise.all([
      client
        .from("crm_products")
        .select(CRM_PRODUCT_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("name", { ascending: true })
        .limit(500),
      client
        .from("crm_product_lots")
        .select(CRM_LOT_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("received_on", { ascending: false })
        .limit(500),
    ]);
    if (products.error) return databaseErrorResponse(products.error);
    if (lots.error) return databaseErrorResponse(lots.error);

    return jsonNoStore({
      products: ((products.data ?? []) as unknown as CrmProductRow[]).map(toProductView),
      lots: ((lots.data ?? []) as unknown as CrmLotRow[]).map(toLotView),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_products_unavailable", message: "The chemical catalogue could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_products")
      .insert({
        organization_id: activeOrganization.id,
        name: payload.name,
        epa_registration_number: payload.epaRegistrationNumber ?? null,
        active_ingredient: payload.activeIngredient ?? null,
        signal_word: payload.signalWord ?? null,
        sds_url: payload.sdsUrl ?? null,
        label_url: payload.labelUrl ?? null,
        restricted_use: payload.restrictedUse,
        default_unit: payload.defaultUnit ?? null,
        created_by: user.id,
      })
      .select(CRM_PRODUCT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "epa_number_taken",
              message: "Another product in this workspace already carries that EPA registration number.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ product: toProductView(data as unknown as CrmProductRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_product",
            message: error.issues[0]?.message ?? "The product could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_product_not_recorded", message: "The product could not be recorded." } },
      { status: 500 },
    );
  }
}
