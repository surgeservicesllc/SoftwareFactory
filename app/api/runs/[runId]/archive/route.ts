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
 * Archive or restore one run.
 *
 * The reversible counterpart to DELETE on the run itself: this destroys
 * nothing, takes a finished run out of the default list, and puts it back on
 * request. Owner or administrator rather than owner-only for that reason —
 * `set_agent_run_archived` enforces the same rule against the caller's own JWT,
 * so the check here exists to return a clear 403 rather than to be the thing
 * standing in the way.
 */

const requestSchema = z.object({
  archived: z.boolean(),
  reason: z.string().trim().max(400).optional(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { runId } = await params;
    if (!z.string().uuid().safeParse(runId).success) {
      return jsonNoStore(
        { error: { code: "invalid_run_id", message: "The run identifier is invalid." } },
        { status: 400 },
      );
    }

    const parsed = requestSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_archive_request",
            message: "Specify whether to archive or restore.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!["owner", "admin"].includes(activeOrganization.role)) {
      return jsonNoStore(
        {
          error: {
            code: "run_archive_forbidden",
            message: "Organization owner or administrator access is required.",
          },
        },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("set_agent_run_archived", {
      p_archived: parsed.data.archived,
      p_organization_id: activeOrganization.id,
      p_reason: parsed.data.reason ?? null,
      p_run_id: runId,
    });
    if (error) return databaseErrorResponse(error);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { archived_at: string | null; run_id: string }
      | null;
    if (!row) {
      return jsonNoStore(
        { error: { code: "run_not_found", message: "The run is not available." } },
        { status: 404 },
      );
    }

    return jsonNoStore({ run: { archivedAt: row.archived_at, id: row.run_id } });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "internal_error", message: "The run could not be archived." } },
      { status: 500 },
    );
  }
}
