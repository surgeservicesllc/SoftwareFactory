import { z } from "zod";

import { runDetailSchema } from "@/lib/server/control-plane-detail-schemas";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { safeDetailProjection, tenantRpcDetailResponse } from "@/lib/server/tenant-detail";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * One run: read it, edit what a person owns, or delete it.
 *
 * The split between PATCH and what it refuses to touch is the point. A run's
 * provider, model, timings, usage and artifacts are evidence of something that
 * happened, and an endpoint that let them be rewritten would be a way to make
 * the console assert things that are not true. PATCH therefore accepts exactly
 * two fields — the triage status and the note — and the database enforces the
 * same boundary through `update_agent_run_review`, so a caller that skips this
 * route gains nothing.
 *
 * Neither verb decides authorization here. Both RPCs check the caller's role
 * against their own JWT, so the checks below are there to return a clear 403
 * rather than a database error, not to be the thing standing in the way.
 */

const REVIEW_STATUSES = [
  "unreviewed", "acknowledged", "investigating", "resolved", "ignored",
] as const;

const reviewSchema = z.object({
  reviewStatus: z.enum(REVIEW_STATUSES),
  reviewNote: z.string().trim().max(2_000).optional(),
}).strict();

const deleteSchema = z.object({
  reason: z.string().trim().min(10).max(400),
  // Default off. On, it means the owner has said to keep the pull requests,
  // deployments and test runs this run produced and unlink them, rather than
  // abandoning the deletion. Nothing outside this database is touched either
  // way — a real pull request on GitHub is unaffected.
  detachEvidence: z.boolean().default(false),
}).strict();

function invalidRunId() {
  return jsonNoStore(
    { error: { code: "invalid_run_id", message: "The run identifier is invalid." } },
    { status: 400 },
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return tenantRpcDetailResponse<Record<string, unknown>, unknown>({
    id: runId,
    idParameter: "p_run_id",
    itemKey: "run",
    rpc: "get_agent_run_detail",
    unavailableCode: "run_unavailable",
    unavailableMessage: "Run details could not be loaded.",
    shape: (row) => runDetailSchema.parse(safeDetailProjection(row)),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { runId } = await params;
    if (!z.string().uuid().safeParse(runId).success) return invalidRunId();

    const parsed = reviewSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_run_review",
            message: "Only the review status and note can be edited on a run.",
            fields: z.flattenError(parsed.error).fieldErrors,
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
            code: "run_review_forbidden",
            message: "Organization owner or administrator access is required.",
          },
        },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("update_agent_run_review", {
      p_organization_id: activeOrganization.id,
      p_review_note: parsed.data.reviewNote ?? null,
      p_review_status: parsed.data.reviewStatus,
      p_run_id: runId,
    });
    if (error) return databaseErrorResponse(error);

    const row = (Array.isArray(data) ? data[0] : data) as {
      review_note: string | null;
      review_status: string;
      reviewed_at: string | null;
      run_id: string;
    } | null;
    if (!row) {
      return jsonNoStore(
        { error: { code: "run_not_found", message: "The run is not available." } },
        { status: 404 },
      );
    }

    return jsonNoStore({
      review: {
        reviewNote: row.review_note,
        reviewStatus: row.review_status,
        reviewedAt: row.reviewed_at,
        runId: row.run_id,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "internal_error", message: "The run review could not be saved." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { runId } = await params;
    if (!z.string().uuid().safeParse(runId).success) return invalidRunId();

    const parsed = deleteSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_run_deletion",
            message: "A reason of at least ten characters is required to delete a run.",
            fields: z.flattenError(parsed.error).fieldErrors,
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
            code: "run_deletion_forbidden",
            message: "Only an organization owner may delete a run.",
          },
        },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("delete_agent_run", {
      p_detach_evidence: parsed.data.detachEvidence,
      p_organization_id: activeOrganization.id,
      p_reason: parsed.data.reason,
      p_run_id: runId,
    });
    if (error) return databaseErrorResponse(error);

    const row = (Array.isArray(data) ? data[0] : data) as {
      deleted_artifacts: number;
      deleted_events: number;
      deleted_run_id: string;
      deleted_validations: number;
      detached_deployments: number;
      detached_pull_requests: number;
      detached_test_runs: number;
    } | null;
    if (!row) {
      return jsonNoStore(
        { error: { code: "run_not_found", message: "The run is not available." } },
        { status: 404 },
      );
    }

    // What was removed and what was kept, so the caller can say so rather than
    // reporting a bare success for an operation that also unlinked records.
    return jsonNoStore({
      deleted: {
        artifacts: row.deleted_artifacts,
        events: row.deleted_events,
        runId: row.deleted_run_id,
        validations: row.deleted_validations,
      },
      detached: {
        deployments: row.detached_deployments,
        pullRequests: row.detached_pull_requests,
        testRuns: row.detached_test_runs,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "internal_error", message: "The run could not be deleted." } },
      { status: 500 },
    );
  }
}
