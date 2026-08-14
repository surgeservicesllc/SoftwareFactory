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

const requestSchema = z.object({
  reason: z.string().trim().min(10).max(500),
}).strict();

type CancellationResult = {
  run_id: string;
  status: string;
  cancel_requested_at: string;
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

    const parsed = requestSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_cancellation", message: "A brief cancellation reason is required." } },
        { status: 400 },
      );
    }

    const contextState = await requireActiveOrganization();
    if (!["owner", "admin"].includes(contextState.activeOrganization.role)) {
      return jsonNoStore(
        { error: { code: "cancellation_forbidden", message: "Organization owner or administrator access is required." } },
        { status: 403 },
      );
    }
    const { data, error } = await contextState.client.rpc("request_phase1c_run_cancellation", {
      p_organization_id: contextState.activeOrganization.id,
      p_run_id: runId,
      p_reason: parsed.data.reason,
    });
    if (error) return databaseErrorResponse(error);

    const row = (Array.isArray(data) ? data[0] : data) as CancellationResult | null;
    if (!row) {
      return jsonNoStore(
        { error: { code: "run_not_found", message: "The active run was not found." } },
        { status: 404 },
      );
    }

    return jsonNoStore({
      cancellation: {
        runId: row.run_id,
        status: row.status,
        requestedAt: row.cancel_requested_at,
      },
      message: row.status === "cancelled"
        ? "The queued run was cancelled before a worker claimed it."
        : "Cancellation requested. The worker will stop at the next safe boundary.",
    }, { status: 202 });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return jsonNoStore(
      { error: { code: "cancellation_failed", message: "Cancellation could not be requested safely." } },
      { status: 500 },
    );
  }
}
