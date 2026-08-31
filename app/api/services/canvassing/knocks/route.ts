import { z } from "zod";

import {
  CRM_KNOCK_COLUMNS,
  CRM_KNOCK_DISPOSITIONS,
  CRM_PENDING_DISPOSITIONS,
  toKnockView,
  type CrmKnockRow,
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
 * Record one knock.
 *
 * There is no PATCH and no DELETE here, and no grant that would let one
 * exist: a knock is a fact about a moment, and a canvasser's disposition
 * cannot be improved after the door closed. A door that produced a customer
 * names the account it produced; a follow-up date belongs only to a door
 * that asked for one. Both rules are the schema's, and both are stated here
 * so the refusal names the mistake instead of surfacing a constraint.
 */

const PENDING = new Set<string>(CRM_PENDING_DISPOSITIONS);

const createSchema = z
  .object({
    canvassRouteId: z.string().uuid(),
    accountId: z.string().uuid().nullish(),
    address: z.string().trim().min(1).max(500),
    disposition: z.enum(CRM_KNOCK_DISPOSITIONS),
    knockedAt: z.string().datetime().nullish(),
    followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.").nullish(),
    note: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict()
  .refine((value) => value.disposition !== "sold" || Boolean(value.accountId), {
    message: "A door that sold names the customer it produced.",
  })
  .refine((value) => !value.followUpOn || PENDING.has(value.disposition), {
    message: "A follow-up date belongs to a callback or an appointment.",
  });

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_knocks")
      .insert({
        organization_id: activeOrganization.id,
        canvass_route_id: payload.canvassRouteId,
        account_id: payload.accountId ?? null,
        address: payload.address,
        disposition: payload.disposition,
        knocked_at: payload.knockedAt ?? new Date().toISOString(),
        follow_up_on: payload.followUpOn ?? null,
        note: payload.note ?? null,
        created_by: user.id,
      })
      .select(CRM_KNOCK_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "reference_not_found", message: "That route or customer is not in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ knock: toKnockView(data as unknown as CrmKnockRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_knock",
            message: error.issues[0]?.message ?? "The knock could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_knock_not_recorded", message: "The knock could not be recorded." } },
      { status: 500 },
    );
  }
}
