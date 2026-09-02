import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { CLOSED_REASONS } from "@/lib/job-seeker/silence";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * One application's transitions. The database owns the approval gate — a
 * stage at or beyond APPLIED without an approved decision is a CHECK
 * violation, so this route never needs to be trusted; it only needs to be
 * honest about what it asks for. Approve and reject record who decided and
 * when, because a decision without its evidence is refused by the schema.
 */

const transitionSchema = z
  .object({
    action: z.enum(["approve", "reject", "advance", "close", "note", "follow_up"]),
    stage: z
      .enum([
        "FOUND", "QUALIFIED", "RESUME_CREATED", "READY_FOR_REVIEW", "APPLIED",
        "FOLLOW_UP", "RECRUITER_RESPONSE", "INTERVIEW", "FINAL_INTERVIEW", "OFFER", "CLOSED",
      ])
      .optional(),
    notes: z.string().trim().max(8000).optional(),
    followUpAt: z.string().datetime().nullish(),
    applicationUrl: z.string().trim().url().max(800).nullish(),
    /** Why the application ended; the schema allows it only while CLOSED (ADR-243). */
    closedReason: z.enum(CLOSED_REASONS).nullish(),
  })
  .strict();

const APPLICATION_COLUMNS =
  "id, job_id, stage, approval_status, decided_at, applied_at, application_url, notes, follow_up_at, closed_reason, updated_at";

type ApplicationRow = {
  id: string;
  job_id: string;
  stage: string;
  approval_status: string;
  decided_at: string | null;
  applied_at: string | null;
  application_url: string | null;
  notes: string | null;
  follow_up_at: string | null;
  closed_reason: string | null;
  updated_at: string | null;
};

function toView(row: ApplicationRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    stage: row.stage,
    approvalStatus: row.approval_status,
    decidedAt: row.decided_at,
    appliedAt: row.applied_at,
    applicationUrl: row.application_url,
    notes: row.notes,
    followUpAt: row.follow_up_at,
    closedReason: row.closed_reason,
    updatedAt: row.updated_at,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { applicationId } = await params;
    if (!z.string().uuid().safeParse(applicationId).success) {
      throw new ApiRequestError(400, "invalid_application", "The application id is not valid.");
    }
    const payload = transitionSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const patch: Record<string, unknown> = {};
    if (payload.action === "approve") {
      patch.approval_status = "approved";
      patch.decided_at = new Date().toISOString();
      patch.decided_by = user.id;
    } else if (payload.action === "reject") {
      patch.approval_status = "rejected";
      patch.decided_at = new Date().toISOString();
      patch.decided_by = user.id;
    } else if (payload.action === "advance") {
      if (!payload.stage) {
        throw new ApiRequestError(422, "stage_required", "An advance names its target stage.");
      }
      patch.stage = payload.stage;
      if (payload.stage === "APPLIED") patch.applied_at = new Date().toISOString();
    } else if (payload.action === "close") {
      patch.stage = "CLOSED";
      // The person's own word for why it ended; null is "not said", which
      // the analytics count as such rather than guessing a reason.
      patch.closed_reason = payload.closedReason ?? null;
    } else if (payload.action === "follow_up") {
      patch.follow_up_at = payload.followUpAt ?? null;
    }
    if (payload.notes !== undefined) patch.notes = payload.notes || null;
    if (payload.applicationUrl !== undefined) patch.application_url = payload.applicationUrl ?? null;

    const { data, error } = await client
      .from("job_seeker_applications")
      .update(patch)
      .eq("id", applicationId)
      .eq("organization_id", activeOrganization.id)
      .select(APPLICATION_COLUMNS)
      .maybeSingle<ApplicationRow>();
    if (error) {
      // The gate speaks in CHECK violations; translate the one a person can act on.
      if (error.code === "23514") {
        return jsonNoStore(
          {
            error: {
              code: "approval_required",
              message: "This stage needs your explicit approval first. Review the application and approve it before applying.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "application_not_found", message: "The application does not exist or is not yours." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ application: toView(data) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_transition", message: "The transition payload is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_application_unavailable", message: "The application could not be updated." } },
      { status: 500 },
    );
  }
}
