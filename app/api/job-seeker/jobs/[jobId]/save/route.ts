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
 * Bookmark a posting, or remove the bookmark.
 *
 * `saved_at` is a timestamp rather than a boolean so the saved list can be
 * ordered by when it was saved; saving an already-saved job therefore has to
 * decide whether to move that timestamp, and it does not. Re-saving is
 * idempotent: the original moment is preserved, because "saved three weeks
 * ago" is a fact about the seeker's attention and a stray double-click should
 * not rewrite it.
 *
 * The write is scoped by organization and by the row's own ownership, and RLS
 * enforces both independently — the filter here is for the honest 404, not for
 * the security, which the policy owns.
 */

const bodySchema = z.object({ saved: z.boolean() });

/** PostgREST's codes for a column this deployment expects and the database lacks. */
function isMissingSavedColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { jobId } = await context.params;
    if (!z.string().uuid().safeParse(jobId).success) {
      return jsonNoStore(
        { error: { code: "invalid_job", message: "That job identifier is not valid." } },
        { status: 400 },
      );
    }
    const { saved } = bodySchema.parse(await readBoundedJson(request, 4_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    /*
     * `saved_at` arrives with 20260828000400, and a hosted apply is a
     * separately gated step — so a deployment can be ahead of its database.
     * Saying so is better than a 500 the caller has to guess at.
     */
    const missingColumn = () => jsonNoStore(
      {
        error: {
          code: "saving_not_available",
          message: "Saving a job is not available on this workspace yet: the database has not "
            + "taken the migration that adds the bookmark. Nothing was changed.",
        },
      },
      { status: 503 },
    );

    if (saved) {
      // Only stamp a row that has no stamp, so re-saving keeps the first
      // moment. A second statement reads back what the row now holds, which is
      // what the caller renders — never the value this route hoped to write.
      const { error } = await client
        .from("job_seeker_jobs")
        .update({ saved_at: new Date().toISOString() })
        .eq("organization_id", activeOrganization.id)
        .eq("id", jobId)
        .is("saved_at", null);
      if (error) {
        if (isMissingSavedColumn(error)) return missingColumn();
        return databaseErrorResponse(error);
      }
    } else {
      const { error } = await client
        .from("job_seeker_jobs")
        .update({ saved_at: null })
        .eq("organization_id", activeOrganization.id)
        .eq("id", jobId);
      if (error) {
        if (isMissingSavedColumn(error)) return missingColumn();
        return databaseErrorResponse(error);
      }
    }

    const { data, error: readError } = await client
      .from("job_seeker_jobs")
      .select("id, saved_at")
      .eq("organization_id", activeOrganization.id)
      .eq("id", jobId)
      .maybeSingle();
    if (readError) {
      if (isMissingSavedColumn(readError)) return missingColumn();
      return databaseErrorResponse(readError);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "job_not_found", message: "That job is not in this workspace." } },
        { status: 404 },
      );
    }

    return jsonNoStore({ id: data.id, savedAt: data.saved_at });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_save_failed", message: "The job could not be saved." } },
      { status: 500 },
    );
  }
}
