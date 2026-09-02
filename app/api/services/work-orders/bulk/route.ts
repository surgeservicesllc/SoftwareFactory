import { z } from "zod";

import { CRM_WORK_ORDER_STATUSES } from "@/lib/services/crm";
import { summarizeBulkEdit, toBulkEditOutcome, type CrmBulkEditRow } from "@/lib/services/schedule-bends";
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
 * Many visits, one call, one outcome each (ADR-239). The database applies
 * what it can and says why not for the rest; nothing here decides.
 */

const bulkSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    setTechnician: z.boolean().default(false),
    technicianId: z.string().uuid().nullable().optional(),
    shiftDays: z.number().int().min(-365).max(365).default(0),
    status: z.enum(CRM_WORK_ORDER_STATUSES).optional(),
  })
  .strict()
  .refine((value) => value.setTechnician || value.shiftDays !== 0 || value.status !== undefined, {
    message: "Nothing to change: pick a technician, a number of days, or a status.",
  })
  .refine((value) => value.status !== "completed", {
    message: "A visit is completed one at a time, with its notes.",
  });

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = bulkSchema.parse(await readBoundedJson(request, 32_000));
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("crm_work_orders_bulk_edit", {
      p_organization: activeOrganization.id,
      p_ids: payload.ids,
      p_set_technician: payload.setTechnician,
      p_technician: payload.setTechnician ? (payload.technicianId ?? null) : null,
      p_shift_days: payload.shiftDays,
      p_status: payload.status ?? null,
    });
    if (error) return databaseErrorResponse(error);
    const outcomes = ((data ?? []) as unknown as CrmBulkEditRow[]).map(toBulkEditOutcome);
    return jsonNoStore({ outcomes, summary: summarizeBulkEdit(outcomes) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_bulk_edit", message: error.issues[0]?.message ?? "Invalid change." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "bulk_edit_unavailable", message: "The visits could not be changed." } }, { status: 500 });
  }
}
