import { z } from "zod";

import {
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Clear the backlog.
 *
 * The route carries no authority of its own: `clear_backlog_tasks` refuses a
 * caller who is not an owner or admin, refuses a reason under ten characters,
 * skips live work, and skips anything whose deletion would cascade into run
 * history unless told otherwise. `databaseErrorResponse` classifies those
 * refusals, so the caller receives the sentence this repository wrote rather
 * than a paraphrase that could drift from the rule it describes.
 */

const clearSchema = z.object({
  reason: z.string().trim().min(10).max(400),
  /*
   * Off by default. On, tasks that carry agent_runs are deleted too — and the
   * cascade takes those runs with them, past every guard in delete_agent_run.
   * That is a real choice with a real cost, so it is never the default.
   */
  includeTasksWithRuns: z.boolean().default(false),
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
      .rpc("clear_backlog_tasks", {
        p_organization_id: activeOrganization.id,
        p_reason: parsed.data.reason,
        p_include_tasks_with_runs: parsed.data.includeTasksWithRuns,
      })
      .single<{ deleted_count: number; kept_running: number; kept_with_runs: number }>();

    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      cleared: {
        deletedCount: data.deleted_count,
        keptRunning: data.kept_running,
        keptWithRuns: data.kept_with_runs,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "backlog_clear_unavailable", message: "The backlog could not be cleared." } },
      { status: 500 },
    );
  }
}
