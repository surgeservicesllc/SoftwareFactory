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
 * Clear every archived report.
 *
 * Archived-only, and that is the safety rather than a limitation: "clear" on a
 * page of reports must not quietly mean "and the ones you have not looked at
 * yet". Archiving is the step that makes the intent explicit, it is reversible
 * right up until this is called, and `delete_archived_reports` runs the
 * per-report path for each one so no rule can drift between the two.
 *
 * The response says what stayed as well as what went: a report the per-report
 * path refused is counted, not forced.
 */

const requestSchema = z.object({
  reason: z.string().trim().min(10).max(400),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = requestSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_clear_request",
            message: "A reason of at least ten characters is required to clear reports.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner") {
      return jsonNoStore(
        {
          error: {
            code: "report_clear_forbidden",
            message: "Only an organization owner may clear archived reports.",
          },
        },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("delete_archived_reports", {
      p_organization_id: activeOrganization.id,
      p_reason: parsed.data.reason,
    });
    if (error) return databaseErrorResponse(error);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { deleted_count: number; kept_count: number }
      | null;

    return jsonNoStore({
      cleared: {
        deleted: row?.deleted_count ?? 0,
        kept: row?.kept_count ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "internal_error", message: "Archived reports could not be cleared." } },
      { status: 500 },
    );
  }
}
