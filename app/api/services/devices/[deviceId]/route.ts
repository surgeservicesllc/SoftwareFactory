import { z } from "zod";

import {
  CRM_DEVICE_COLUMNS,
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
 * Correct one station's label or IPM threshold. Location and lifecycle are
 * deliberately absent: those belong to the scan ledger (move and remove
 * scans), which is the state's source of truth.
 */

const paramsSchema = z.object({ deviceId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    activityThreshold: z.number().int().min(1).max(100_000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ deviceId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_device_id", message: "The device id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = patchSchema.parse(await readBoundedJson(request, 16_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.label !== undefined) changes.label = payload.label;
    if (payload.activityThreshold !== undefined) changes.activity_threshold = payload.activityThreshold;

    const { data, error } = await client
      .from("crm_devices")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.deviceId)
      .select(CRM_DEVICE_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "device_not_found", message: "No such station in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ device: toDeviceView(data as unknown as CrmDeviceRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_device_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_device_not_updated", message: "The station could not be updated." } },
      { status: 500 },
    );
  }
}
