import { z } from "zod";

import { ApiRequestError, databaseErrorResponse, jsonNoStore, readBoundedJson, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Cancelling a project cancels every visit of it not yet completed; the
 * outcome trigger records each one on the account. A completed day stays
 * completed — it happened.
 */

const patchSchema = z.object({ status: z.literal("cancelled") }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const projectId = z.string().uuid().parse((await context.params).projectId);
    patchSchema.parse(await readBoundedJson(request, 1_000));
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("crm_project_cancel", { p_organization: activeOrganization.id, p_project: projectId });
    if (error) {
      if (error.code === "P0002" || /no such project/i.test(error.message ?? "")) {
        return jsonNoStore({ error: { code: "project_not_found", message: "No such project, or it is already cancelled." } }, { status: 404 });
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ projectId, cancelledVisits: Number(data ?? 0) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_project_change", message: error.issues[0]?.message ?? "Invalid change." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "project_not_updated", message: "The project could not be changed." } }, { status: 500 });
  }
}
