import { z } from "zod";

import {
  CRM_TECHNICIAN_COLUMNS,
  toTechnicianView,
  type CrmTechnicianRow,
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

/** Correct one technician's record, or mark them inactive — never deleted. */

const paramsSchema = z.object({ technicianId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().regex(/^[0-9+() .\-]{7,32}$/).nullable().optional(),
    licenseNumber: z.string().trim().min(1).max(120).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ technicianId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_technician_id", message: "The technician id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = patchSchema.parse(await readBoundedJson(request, 16_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.firstName !== undefined) changes.first_name = payload.firstName;
    if (payload.lastName !== undefined) changes.last_name = payload.lastName;
    if (payload.email !== undefined) changes.email = payload.email;
    if (payload.phone !== undefined) changes.phone = payload.phone;
    if (payload.licenseNumber !== undefined) changes.license_number = payload.licenseNumber;
    if (payload.active !== undefined) changes.active = payload.active;

    const { data, error } = await client
      .from("crm_technicians")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.technicianId)
      .select(CRM_TECHNICIAN_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "technician_not_found", message: "No such technician in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ technician: toTechnicianView(data as unknown as CrmTechnicianRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_technician_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_technician_not_updated", message: "The technician could not be updated." } },
      { status: 500 },
    );
  }
}
