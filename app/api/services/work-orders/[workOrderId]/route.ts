import { z } from "zod";

import {
  CRM_WORK_ORDER_COLUMNS,
  CRM_WORK_ORDER_STATUSES,
  toWorkOrderView,
  type CrmWorkOrderRow,
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
 * Move one work order: assign or reassign the technician, reschedule the
 * window, progress the status. Completing writes the 'service' event onto
 * the account timeline and stamps completed_at — both by the database, in
 * the same transaction, never by this route.
 */

const paramsSchema = z.object({ workOrderId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    status: z.enum(CRM_WORK_ORDER_STATUSES).optional(),
    technicianId: z.string().uuid().nullable().optional(),
    serviceType: z.string().trim().min(1).max(120).optional(),
    scheduledStart: z.string().datetime({ offset: true }).optional(),
    scheduledEnd: z.string().datetime({ offset: true }).optional(),
    instructions: z.string().trim().min(1).max(2000).nullable().optional(),
    completionNotes: z.string().trim().min(1).max(3500).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." })
  .refine(
    (value) =>
      value.scheduledStart === undefined
      || value.scheduledEnd === undefined
      || new Date(value.scheduledEnd) > new Date(value.scheduledStart),
    { message: "The visit must end after it starts." },
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workOrderId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_work_order_id", message: "The work order id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.status !== undefined) changes.status = payload.status;
    if (payload.technicianId !== undefined) changes.technician_id = payload.technicianId;
    if (payload.serviceType !== undefined) changes.service_type = payload.serviceType;
    if (payload.scheduledStart !== undefined) changes.scheduled_start = payload.scheduledStart;
    if (payload.scheduledEnd !== undefined) changes.scheduled_end = payload.scheduledEnd;
    if (payload.instructions !== undefined) changes.instructions = payload.instructions;
    if (payload.completionNotes !== undefined) changes.completion_notes = payload.completionNotes;

    const { data, error } = await client
      .from("crm_work_orders")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.workOrderId)
      .select(CRM_WORK_ORDER_COLUMNS)
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
        { error: { code: "work_order_not_found", message: "No such work order in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ workOrder: toWorkOrderView(data as unknown as CrmWorkOrderRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_work_order_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_work_order_not_updated", message: "The work order could not be updated." } },
      { status: 500 },
    );
  }
}
