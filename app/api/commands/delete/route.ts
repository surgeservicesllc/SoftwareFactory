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
 * Delete the pipelines somebody selected, and only those.
 *
 * The route carries no authority of its own, exactly like `/clear`:
 * `delete_selected_pipelines` re-checks that the caller manages this
 * organization, requires the reason, refuses live work, refuses to take run
 * history by surprise, and scopes every id to the caller's own organization
 * so a foreign id is counted as not found rather than acted on.
 * `databaseErrorResponse` classifies those refusals so the caller reads the
 * sentence this repository wrote.
 */

const deleteSchema = z.object({
  commandIds: z.array(z.string().uuid()).min(1).max(200),
  reason: z.string().trim().min(10).max(400),
  /*
   * Off by default. On, a selected pipeline's tasks and those tasks' runs go
   * with it — a real choice with a real cost, never a default.
   */
  includeCommandsWithRuns: z.boolean().default(false),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = deleteSchema.safeParse(await readBoundedJson(request, 32 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_delete_request",
            message: "Select 1 to 200 pipelines and give a reason of 10 to 400 characters.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("delete_selected_pipelines", {
        p_organization_id: activeOrganization.id,
        p_command_ids: parsed.data.commandIds,
        p_reason: parsed.data.reason,
        p_include_commands_with_runs: parsed.data.includeCommandsWithRuns,
      })
      .single<{
        deleted_count: number;
        kept_running: number;
        kept_with_runs: number;
        not_found: number;
      }>();

    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      deleted: {
        deletedCount: data.deleted_count,
        keptRunning: data.kept_running,
        keptWithRuns: data.kept_with_runs,
        notFound: data.not_found,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "pipelines_delete_unavailable", message: "The selected pipelines could not be deleted." } },
      { status: 500 },
    );
  }
}
