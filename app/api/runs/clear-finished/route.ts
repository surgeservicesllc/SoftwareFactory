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
 * Clear every finished run in one action — the per-run deletion applied to
 * each terminal run by `delete_finished_agent_runs`, which calls the same
 * guarded path one run at a time and counts what it refused. Owner-only and
 * reason-required in the database; queued and running work is untouched by
 * construction.
 */

const clearSchema = z.object({
  reason: z.string().trim().min(10).max(400),
  // Default off: runs whose work produced pull requests, deployments or test
  // runs are kept and counted. On, those records are kept and unlinked.
  detachEvidence: z.boolean().default(false),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = clearSchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_clear_request", message: "A reason of 10 to 400 characters is required." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("delete_finished_agent_runs", {
        p_organization_id: activeOrganization.id,
        p_reason: parsed.data.reason,
        p_detach_evidence: parsed.data.detachEvidence,
      })
      .single();

    if (error) return databaseErrorResponse(error);

    const row = data as {
      deleted_count: number;
      kept_for_evidence: number;
      kept_for_activity: number;
    };
    return jsonNoStore({
      deletedCount: row.deleted_count,
      keptForEvidence: row.kept_for_evidence,
      keptForActivity: row.kept_for_activity,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "clear_runs_failed", message: "Finished runs could not be cleared safely." } },
      { status: 500 },
    );
  }
}
