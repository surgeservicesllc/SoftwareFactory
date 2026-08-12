import { z } from "zod";

import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { forbidden, invalidRequest, isOrganizationManager, withTenant } from "@/lib/server/tenant-route";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const cancelSchema = z
  .object({ reason: z.string().trim().max(300).optional() })
  .strict();

/**
 * Requests cancellation of a run.
 *
 * A queued run is cancelled immediately. A leased run is marked `cancelling` so
 * the worker stops before its next external effect, which means a cancelled run
 * never opens a pull request it had not already opened. History is preserved
 * either way.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return invalidRequest("invalid_run_id", "The run id is invalid.");
  }

  return withTenant(
    async ({ activeOrganization, client }) => {
      assertSameOriginRequest(request);
      if (!isOrganizationManager(activeOrganization)) {
        return forbidden("Organization owner or administrator access is required to cancel a run.");
      }

      const parsed = cancelSchema.safeParse(
        request.headers.get("content-type")?.includes("application/json")
          ? await readBoundedJson(request, 4 * 1024)
          : {},
      );
      if (!parsed.success) {
        return invalidRequest("invalid_cancellation", "The cancellation request is invalid.");
      }

      const { data, error } = await client
        .rpc("request_run_cancellation", {
          p_run_id: runId,
          p_reason: parsed.data.reason ?? null,
        })
        .single();
      if (error) return databaseErrorResponse(error);

      const run = data as { id: string; status: string; cancel_requested_at: string };
      return jsonNoStore({
        run: {
          id: run.id,
          status: run.status,
          cancelRequestedAt: run.cancel_requested_at,
        },
        message:
          run.status === "cancelled"
            ? "The queued run was cancelled before it started."
            : "Cancellation was recorded. The worker stops before its next external effect.",
      });
    },
    { code: "cancellation_failed", message: "The run could not be cancelled." },
  );
}
