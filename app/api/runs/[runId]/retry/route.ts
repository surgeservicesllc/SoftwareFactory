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

const retryRequestSchema = z.object({
  reason: z.string().trim().min(10).max(500),
}).strict();

type RetryResult = {
  run_id: string;
  status: string;
  attempt_number: number;
};

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

    const parsed = retryRequestSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_retry", message: "A brief retry reason is required." } },
        { status: 400 },
      );
    }

    const context = await requireActiveOrganization();
    if (!["owner", "admin"].includes(context.activeOrganization.role)) {
      return jsonNoStore(
        { error: { code: "retry_forbidden", message: "Organization owner or administrator access is required." } },
        { status: 403 },
      );
    }

    const { data, error } = await context.client.rpc("retry_phase1c_run", {
      p_organization_id: context.activeOrganization.id,
      p_run_id: runId,
      p_reason: parsed.data.reason,
    });
    if (error) return databaseErrorResponse(error);

    const row = (Array.isArray(data) ? data[0] : data) as RetryResult | null;
    if (!row) {
      return jsonNoStore(
        { error: { code: "run_not_found", message: "A retryable terminal run was not found." } },
        { status: 404 },
      );
    }

    return jsonNoStore({
      run: { id: row.run_id, status: row.status, attempt: row.attempt_number },
      message: "Retry queued within the run's bounded attempt limit.",
    }, { status: 202 });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return jsonNoStore(
      { error: { code: "retry_failed", message: "The run could not be retried safely." } },
      { status: 500 },
    );
  }
}
