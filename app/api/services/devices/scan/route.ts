import { z } from "zod";

import {
  CRM_BARCODE_PATTERN,
  CRM_DEVICE_COLUMNS,
  CRM_DEVICE_CONDITIONS,
  CRM_DEVICE_EVENT_COLUMNS,
  CRM_DEVICE_EVENT_KINDS,
  toDeviceEventView,
  toDeviceView,
  type CrmDeviceEventRow,
  type CrmDeviceRow,
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
 * The scan: a barcode resolves to exactly one station in this organization,
 * and the scan appends to its ledger — install reactivates, service records
 * condition and captures, move relocates, remove closes. The device row's
 * state is updated by the database from the event, never by this route.
 */

const scanSchema = z
  .object({
    barcode: z.string().trim().regex(CRM_BARCODE_PATTERN, "A barcode: 4-64 letters, digits, dots, dashes."),
    event: z.enum(CRM_DEVICE_EVENT_KINDS),
    condition: z.enum(CRM_DEVICE_CONDITIONS).nullish(),
    activityCount: z.number().int().min(0).max(100_000).nullish(),
    pestObserved: z.string().trim().min(1).max(120).nullish(),
    locationNote: z.string().trim().min(1).max(300).nullish(),
    note: z.string().trim().min(1).max(1000).nullish(),
    workOrderId: z.string().uuid().nullish(),
  })
  .strict()
  .refine((value) => !(value.event === "move" && !value.locationNote), {
    message: "A move scan says where the station went.",
  });

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = scanSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const found = await client
      .from("crm_devices")
      .select(CRM_DEVICE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("barcode", payload.barcode)
      .maybeSingle();
    if (found.error) return databaseErrorResponse(found.error);
    if (!found.data) {
      return jsonNoStore(
        { error: { code: "device_not_found", message: "No station in this workspace carries that barcode." } },
        { status: 404 },
      );
    }
    const device = found.data as unknown as CrmDeviceRow;

    const inserted = await client
      .from("crm_device_events")
      .insert({
        organization_id: activeOrganization.id,
        device_id: device.id,
        event: payload.event,
        condition: payload.condition ?? null,
        activity_count: payload.activityCount ?? null,
        pest_observed: payload.pestObserved ?? null,
        location_note: payload.locationNote ?? null,
        note: payload.note ?? null,
        work_order_id: payload.workOrderId ?? null,
        actor_user_id: user.id,
      })
      .select(CRM_DEVICE_EVENT_COLUMNS)
      .single();
    if (inserted.error) {
      if (inserted.error.code === "23503") {
        return jsonNoStore(
          { error: { code: "work_order_not_found", message: "No such work order in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(inserted.error);
    }

    // Re-read the device: its state was just moved by the ledger trigger.
    const after = await client
      .from("crm_devices")
      .select(CRM_DEVICE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", device.id)
      .maybeSingle();
    if (after.error) return databaseErrorResponse(after.error);

    return jsonNoStore(
      {
        scan: toDeviceEventView(inserted.data as unknown as CrmDeviceEventRow),
        device: toDeviceView((after.data ?? found.data) as unknown as CrmDeviceRow),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_scan",
            message: error.issues[0]?.message ?? "The scan could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_scan_not_recorded", message: "The scan could not be recorded." } },
      { status: 500 },
    );
  }
}
