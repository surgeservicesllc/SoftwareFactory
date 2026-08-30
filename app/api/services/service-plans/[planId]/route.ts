import { z } from "zod";

import {
  CRM_SERVICE_PLAN_COLUMNS,
  CRM_SERVICE_RECURRENCES,
  toServicePlanView,
  type CrmServicePlanRow,
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

/** Correct or pause one service plan — never deleted; a lapsed agreement is history. */

const paramsSchema = z.object({ planId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    serviceType: z.string().trim().min(1).max(120).optional(),
    recurrence: z.enum(CRM_SERVICE_RECURRENCES).optional(),
    nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.").optional(),
    technicianId: z.string().uuid().nullable().optional(),
    valueCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_plan_id", message: "The plan id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = patchSchema.parse(await readBoundedJson(request, 16_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.serviceType !== undefined) changes.service_type = payload.serviceType;
    if (payload.recurrence !== undefined) changes.recurrence = payload.recurrence;
    if (payload.nextDue !== undefined) changes.next_due = payload.nextDue;
    if (payload.technicianId !== undefined) changes.technician_id = payload.technicianId;
    if (payload.valueCents !== undefined) changes.value_cents = payload.valueCents;
    if (payload.notes !== undefined) changes.notes = payload.notes;
    if (payload.active !== undefined) changes.active = payload.active;

    const { data, error } = await client
      .from("crm_service_plans")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.planId)
      .select(CRM_SERVICE_PLAN_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "technician_not_found", message: "No such technician in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "plan_not_found", message: "No such service plan in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ plan: toServicePlanView(data as unknown as CrmServicePlanRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_plan_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_service_plan_not_updated", message: "The service plan could not be updated." } },
      { status: 500 },
    );
  }
}
