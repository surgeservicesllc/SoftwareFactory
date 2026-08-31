import { z } from "zod";

import {
  CRM_TIMESHEET_COLUMNS,
  toTimesheetView,
  type CrmTimesheetRow,
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
 * Technician timesheets: clock in, clock out.
 *
 * A running shift has no worked total — reporting one as though it were
 * finished would inflate every figure built on it — so `workedMinutes` is
 * null until the shift ends and the page shows it as still running.
 *
 * A technician cannot be in two places at once: the database refuses a
 * shift overlapping one they already have, which is what makes a timesheet
 * total arithmetic rather than an estimate.
 */

const createSchema = z
  .object({
    technicianId: z.string().uuid(),
    workOrderId: z.string().uuid().nullish(),
    startedAt: z.string().datetime().nullish(),
    notes: z.string().trim().min(1).max(2000).nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    timesheetId: z.string().uuid(),
    endedAt: z.string().datetime().nullish(),
    breakMinutes: z.number().int().min(0).max(720).optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const url = new URL(request.url);
    const technicianId = url.searchParams.get("technicianId");

    let query = client
      .from("crm_timesheets")
      .select(CRM_TIMESHEET_COLUMNS)
      .eq("organization_id", activeOrganization.id);
    if (technicianId !== null && technicianId !== "") {
      query = query.eq("technician_id", technicianId);
    }
    const { data, error } = await query.order("started_at", { ascending: false }).limit(500);
    if (error) return databaseErrorResponse(error);

    const shifts = ((data ?? []) as unknown as CrmTimesheetRow[]).map(toTimesheetView);
    const finished = shifts.filter((shift) => shift.workedMinutes !== null);
    return jsonNoStore({
      shifts,
      counts: {
        total: shifts.length,
        // Named apart, because an open shift is not a short one.
        running: shifts.length - finished.length,
        workedMinutes: finished.reduce((sum, shift) => sum + (shift.workedMinutes ?? 0), 0),
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_timesheets_unavailable", message: "Timesheets could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_timesheets")
      .insert({
        organization_id: activeOrganization.id,
        technician_id: payload.technicianId,
        work_order_id: payload.workOrderId ?? null,
        started_at: payload.startedAt ?? new Date().toISOString(),
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_TIMESHEET_COLUMNS)
      .single();
    if (error) return shiftWriteError(error);
    return jsonNoStore({ shift: toTimesheetView(data as unknown as CrmTimesheetRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_shift", "crm_shift_not_recorded", "The shift could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.endedAt !== undefined) changes.ended_at = payload.endedAt;
    if (payload.breakMinutes !== undefined) changes.break_minutes = payload.breakMinutes;
    if (payload.notes !== undefined) changes.notes = payload.notes;

    const { data, error } = await client
      .from("crm_timesheets")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.timesheetId)
      .select(CRM_TIMESHEET_COLUMNS)
      .maybeSingle();
    if (error) return shiftWriteError(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "shift_not_found", message: "No such shift in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ shift: toTimesheetView(data as unknown as CrmTimesheetRow) });
  } catch (error) {
    return failure(error, "invalid_shift_change", "crm_shift_not_updated", "The shift could not be updated.");
  }
}

function shiftWriteError(error: { code?: string; message?: string }) {
  if (error.code === "23514" || error.code === "P0001") {
    return jsonNoStore(
      {
        error: {
          code: "shift_refused",
          message:
            "The shift was refused — a technician cannot be in two places at once, a shift ends after it starts, and one running past twenty-four hours is a forgotten clock-out rather than a day's labour.",
        },
      },
      { status: 409 },
    );
  }
  if (error.code === "23503") {
    return jsonNoStore(
      { error: { code: "reference_not_found", message: "That technician or visit is not in this workspace." } },
      { status: 404 },
    );
  }
  return databaseErrorResponse(error as Parameters<typeof databaseErrorResponse>[0]);
}

function failure(error: unknown, invalidCode: string, failureCode: string, message: string) {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { error: { code: invalidCode, message: error.issues[0]?.message ?? message } },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code: failureCode, message } }, { status: 500 });
}
