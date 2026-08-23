import { z } from "zod";

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
 * Clear the Autonomy page's list by archiving the projects behind it.
 *
 * Deleting them is a designed impossibility — `refuse_project_deletion` says
 * so by name — and archiving is what that guard names as the supported end of
 * a project's life. The route carries no authority of its own:
 * `clear_autonomy_projects` re-checks that the caller manages this
 * organization, requires the reason, and puts every project through
 * `archive_project`, so that function's own rules and its immutable
 * per-project event apply unchanged. Nothing is deleted.
 */

const clearSchema = z.object({
  reason: z.string().trim().min(10).max(400),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = clearSchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_clear_request",
            message: "A reason of 10 to 400 characters is required.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("clear_autonomy_projects", {
        p_organization_id: activeOrganization.id,
        p_reason: parsed.data.reason,
      })
      .single<{ archived_count: number; already_archived: number }>();

    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      cleared: {
        archivedCount: data.archived_count,
        alreadyArchived: data.already_archived,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "autonomy_clear_unavailable", message: "The autonomy list could not be cleared." } },
      { status: 500 },
    );
  }
}
