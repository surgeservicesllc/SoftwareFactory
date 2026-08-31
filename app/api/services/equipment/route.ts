import { z } from "zod";

import {
  CRM_EQUIPMENT_COLUMNS,
  CRM_EQUIPMENT_EVENT_COLUMNS,
  CRM_EQUIPMENT_EVENT_KINDS,
  CRM_EQUIPMENT_KINDS,
  CRM_METER_UNITS,
  toEquipmentEventView,
  toEquipmentView,
  toFleetStatusView,
  type CrmEquipmentEventRow,
  type CrmEquipmentRow,
  type CrmFleetStatusRow,
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
 * Equipment and fleet.
 *
 * Assignment, status and meter readings are NOT settable here. They are
 * projections of `crm_equipment_events`, written by trigger, so the way to
 * move an asset is to record what happened to it. A PATCH that could set
 * `status` directly would let the roster disagree with its own history —
 * the same reasoning the IPM stations follow.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    assetTag: z.string().trim().min(1).max(40),
    kind: z.enum(CRM_EQUIPMENT_KINDS as unknown as [string, ...string[]]),
    name: z.string().trim().min(1).max(160),
    make: z.string().trim().min(1).max(120).nullish(),
    model: z.string().trim().min(1).max(120).nullish(),
    serialNumber: z.string().trim().min(1).max(120).nullish(),
    branchId: z.string().uuid().nullish(),
    meterReading: z.number().min(0).nullish(),
    meterUnit: z.enum(CRM_METER_UNITS as unknown as [string, ...string[]]).nullish(),
    serviceIntervalDays: z.number().int().min(1).max(3650).nullish(),
    purchasedOn: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullish(),
    notes: z.string().trim().min(1).max(2000).nullish(),
  })
  .strict()
  .refine(
    (value) =>
      (value.meterReading === undefined || value.meterReading === null)
      === (value.meterUnit === undefined || value.meterUnit === null),
    { message: "A meter reading needs its unit, and a unit needs a reading." },
  );

/** The description of an asset is editable. What happened to it is not. */
const patchSchema = z
  .object({
    equipmentId: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    make: z.string().trim().min(1).max(120).nullable().optional(),
    model: z.string().trim().min(1).max(120).nullable().optional(),
    serialNumber: z.string().trim().min(1).max(120).nullable().optional(),
    branchId: z.string().uuid().nullable().optional(),
    serviceIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

const eventSchema = z
  .object({
    equipmentId: z.string().uuid(),
    kind: z.enum(CRM_EQUIPMENT_EVENT_KINDS as unknown as [string, ...string[]]),
    technicianId: z.string().uuid().nullish(),
    meterReading: z.number().min(0).nullish(),
    costCents: z.number().int().min(0).nullish(),
    vendor: z.string().trim().min(1).max(160).nullish(),
    note: z.string().trim().min(1).max(2000).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const [fleet, equipment, events] = await Promise.all([
      client.rpc("crm_fleet_status"),
      client
        .from("crm_equipment")
        .select(CRM_EQUIPMENT_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("asset_tag", { ascending: true })
        .limit(1000),
      client
        .from("crm_equipment_events")
        .select(CRM_EQUIPMENT_EVENT_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("occurred_at", { ascending: false })
        .limit(400),
    ]);
    if (fleet.error) return databaseErrorResponse(fleet.error);
    if (equipment.error) return databaseErrorResponse(equipment.error);
    if (events.error) return databaseErrorResponse(events.error);

    const status = ((fleet.data ?? []) as CrmFleetStatusRow[]).map(toFleetStatusView);
    const onRoster = status.filter((asset) => asset.status !== "retired");

    return jsonNoStore({
      fleet: status,
      equipment: ((equipment.data ?? []) as unknown as CrmEquipmentRow[]).map(toEquipmentView),
      events: ((events.data ?? []) as unknown as CrmEquipmentEventRow[]).map(toEquipmentEventView),
      counts: {
        total: status.length,
        inService: status.filter((asset) => asset.status === "in_service").length,
        inRepair: status.filter((asset) => asset.status === "in_repair").length,
        retired: status.filter((asset) => asset.status === "retired").length,
        overdue: onRoster.filter((asset) => asset.standing === "overdue").length,
        dueSoon: onRoster.filter((asset) => asset.standing === "due_soon").length,
        /*
         * Two numbers a fleet report usually hides. Unscheduled assets have
         * not been judged at all, so they are counted apart from the ones
         * that are fine; and kit assigned to nobody is what a yard walk is
         * actually looking for.
         */
        unscheduled: onRoster.filter((asset) => asset.standing === "unscheduled").length,
        unassigned: onRoster.filter((asset) => asset.unassigned).length,
      },
      telemetry: { available: false, label: "Not Connected" },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_equipment_unavailable", message: "The fleet could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const body = (await readBoundedJson(request, 32_000)) as Record<string, unknown>;

    // One route, two shapes: adding an asset, and recording what happened
    // to one. The presence of an event kind is what tells them apart.
    if (typeof body.kind === "string" && typeof body.equipmentId === "string") {
      const payload = eventSchema.parse(body);
      const { client, user, activeOrganization } = await requireActiveOrganization();
      const { data, error } = await client
        .from("crm_equipment_events")
        .insert({
          organization_id: activeOrganization.id,
          equipment_id: payload.equipmentId,
          kind: payload.kind,
          technician_id: payload.technicianId ?? null,
          meter_reading: payload.meterReading ?? null,
          cost_cents: payload.costCents ?? null,
          vendor: payload.vendor ?? null,
          note: payload.note ?? null,
          created_by: user.id,
        })
        .select(CRM_EQUIPMENT_EVENT_COLUMNS)
        .single();
      if (error) return equipmentWriteError(error);
      return jsonNoStore(
        { event: toEquipmentEventView(data as unknown as CrmEquipmentEventRow) },
        { status: 201 },
      );
    }

    const payload = createSchema.parse(body);
    const { client, user, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_equipment")
      .insert({
        organization_id: activeOrganization.id,
        asset_tag: payload.assetTag,
        kind: payload.kind,
        name: payload.name,
        make: payload.make ?? null,
        model: payload.model ?? null,
        serial_number: payload.serialNumber ?? null,
        branch_id: payload.branchId ?? null,
        meter_reading: payload.meterReading ?? null,
        meter_unit: payload.meterUnit ?? null,
        // The reading's moment travels with it; the schema refuses two of
        // the three.
        meter_read_at: payload.meterReading === undefined || payload.meterReading === null
          ? null
          : new Date().toISOString(),
        service_interval_days: payload.serviceIntervalDays ?? null,
        purchased_on: payload.purchasedOn ?? null,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_EQUIPMENT_COLUMNS)
      .single();
    if (error) return equipmentWriteError(error);
    return jsonNoStore({ equipment: toEquipmentView(data as unknown as CrmEquipmentRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_equipment", "crm_equipment_not_recorded", "The asset could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.make !== undefined) changes.make = payload.make;
    if (payload.model !== undefined) changes.model = payload.model;
    if (payload.serialNumber !== undefined) changes.serial_number = payload.serialNumber;
    if (payload.branchId !== undefined) changes.branch_id = payload.branchId;
    if (payload.serviceIntervalDays !== undefined) {
      changes.service_interval_days = payload.serviceIntervalDays;
    }
    if (payload.notes !== undefined) changes.notes = payload.notes;

    const { data, error } = await client
      .from("crm_equipment")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.equipmentId)
      .select(CRM_EQUIPMENT_COLUMNS)
      .maybeSingle();
    if (error) return equipmentWriteError(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "equipment_not_found", message: "No such asset in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ equipment: toEquipmentView(data as unknown as CrmEquipmentRow) });
  } catch (error) {
    return failure(error, "invalid_equipment_change", "crm_equipment_not_updated", "The asset could not be updated.");
  }
}

function equipmentWriteError(error: { code?: string; message?: string }) {
  // The ledger refuses a backwards meter by name, with both readings in
  // the message. That is the answer a technician needs, so it is passed
  // through rather than flattened into "something went wrong".
  if (/a meter does not run backwards/i.test(error.message ?? "")) {
    return jsonNoStore(
      { error: { code: "meter_went_backwards", message: error.message ?? "" } },
      { status: 409 },
    );
  }
  if (/that asset is retired/i.test(error.message ?? "")) {
    return jsonNoStore(
      { error: { code: "equipment_retired", message: "That asset is retired." } },
      { status: 409 },
    );
  }
  if (error.code === "23505") {
    return jsonNoStore(
      {
        error: {
          code: "asset_tag_taken",
          message: "That asset tag is already in use in this workspace.",
        },
      },
      { status: 409 },
    );
  }
  if (error.code === "23503") {
    return jsonNoStore(
      { error: { code: "reference_not_found", message: "That branch or technician is not in this workspace." } },
      { status: 404 },
    );
  }
  if (error.code === "23514") {
    return jsonNoStore(
      {
        error: {
          code: "equipment_refused",
          message:
            "The record was refused — an assignment names who it went to, a reading needs its unit, "
            + "and a retired asset carries the date it left.",
        },
      },
      { status: 409 },
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
