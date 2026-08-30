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

/**
 * The technician roster: list and add the people who perform service.
 * License numbers ride along for the compliance increment's
 * applicator/license reporting. There is no delete — a departed technician
 * is marked inactive, because service history hangs off them.
 */

const createSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100).nullish(),
    email: z.string().trim().email().max(320).nullish(),
    phone: z.string().trim().regex(/^[0-9+() .\-]{7,32}$/).nullish(),
    licenseNumber: z.string().trim().min(1).max(120).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_technicians")
      .select(CRM_TECHNICIAN_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("active", { ascending: false })
      .order("first_name", { ascending: true })
      .limit(500);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({
      technicians: ((data ?? []) as unknown as CrmTechnicianRow[]).map(toTechnicianView),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_technicians_unavailable", message: "Technicians could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_technicians")
      .insert({
        organization_id: activeOrganization.id,
        first_name: payload.firstName,
        last_name: payload.lastName ?? null,
        email: payload.email ?? null,
        phone: payload.phone ?? null,
        license_number: payload.licenseNumber ?? null,
        created_by: user.id,
      })
      .select(CRM_TECHNICIAN_COLUMNS)
      .single();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore(
      { technician: toTechnicianView(data as unknown as CrmTechnicianRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_technician",
            message: error.issues[0]?.message ?? "The technician could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_technician_not_recorded", message: "The technician could not be recorded." } },
      { status: 500 },
    );
  }
}
