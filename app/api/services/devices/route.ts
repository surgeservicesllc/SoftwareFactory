import { z } from "zod";

import {
  CRM_BARCODE_PATTERN,
  CRM_DEVICE_COLUMNS,
  CRM_DEVICE_TYPES,
  toDeviceView,
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
 * Install a station: one device row at one of the account's own properties,
 * with a barcode no other station in this organization carries. The install
 * scan is written by the database the moment the row exists — the ledger
 * can never be missing a station's beginning.
 */

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    propertyId: z.string().uuid(),
    label: z.string().trim().min(1).max(120),
    deviceType: z.enum(CRM_DEVICE_TYPES),
    barcode: z.string().trim().regex(CRM_BARCODE_PATTERN, "A barcode: 4-64 letters, digits, dots, dashes."),
    locationNote: z.string().trim().min(1).max(300).nullish(),
    activityThreshold: z.number().int().min(1).max(100_000).nullish(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_devices")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        property_id: payload.propertyId,
        label: payload.label,
        device_type: payload.deviceType,
        barcode: payload.barcode,
        location_note: payload.locationNote ?? null,
        activity_threshold: payload.activityThreshold ?? null,
        created_by: user.id,
      })
      .select(CRM_DEVICE_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message:
                "The account or property is not in this workspace — and the property must belong to the account.",
            },
          },
          { status: 404 },
        );
      }
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "barcode_taken",
              message: "Another station in this workspace already carries that barcode.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ device: toDeviceView(data as unknown as CrmDeviceRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_device",
            message: error.issues[0]?.message ?? "The device could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_device_not_recorded", message: "The device could not be recorded." } },
      { status: 500 },
    );
  }
}
