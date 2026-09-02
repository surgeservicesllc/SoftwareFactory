import { z } from "zod";

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
 * The two costs the book did not know. Either may be cleared back to
 * "unknown" — null — which is an honest state the profitability function
 * reports, not a zero it hides.
 */

const schema = z
  .union([
    z.object({ technicianId: z.string().uuid(), hourlyCostCents: z.number().int().min(0).max(100_000_000).nullable() }).strict(),
    z.object({ lotId: z.string().uuid(), unitCostCents: z.number().int().min(0).max(100_000_000).nullable() }).strict(),
  ]);

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = schema.parse(await readBoundedJson(request, 8_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    if ("technicianId" in payload) {
      const { data, error } = await client
        .from("crm_technicians")
        .update({ hourly_cost_cents: payload.hourlyCostCents })
        .eq("organization_id", activeOrganization.id)
        .eq("id", payload.technicianId)
        .select("id, hourly_cost_cents")
        .maybeSingle();
      if (error) return databaseErrorResponse(error);
      if (!data) {
        return jsonNoStore({ error: { code: "technician_not_found", message: "No such technician in this workspace." } }, { status: 404 });
      }
      return jsonNoStore({ technician: { id: data.id, hourlyCostCents: data.hourly_cost_cents } });
    }

    const { data, error } = await client
      .from("crm_product_lots")
      .update({ unit_cost_cents: payload.unitCostCents })
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.lotId)
      .select("id, unit_cost_cents")
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore({ error: { code: "lot_not_found", message: "No such lot in this workspace." } }, { status: 404 });
    }
    return jsonNoStore({ lot: { id: data.id, unitCostCents: data.unit_cost_cents } });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_cost", message: "A technician's hourly cost or a lot's unit cost, in cents." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "crm_cost_not_saved", message: "The cost could not be saved." } }, { status: 500 });
  }
}
