import { z } from "zod";

import {
  CRM_DECIDED_ESTIMATE_STATUSES,
  CRM_ESTIMATE_COLUMNS,
  CRM_ESTIMATE_STATUSES,
  toEstimateView,
  type CrmEstimateRow,
} from "@/lib/services/crm";
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
 * Answer one estimate. Sending it and deciding it are the only verbs: the
 * priced lines are settled at creation, and a proposal whose numbers change
 * after it was sent is a different proposal. The moments are kept here, not
 * asserted by the caller — the schema CHECKs that a decided estimate has a
 * decision time, so the two can never drift apart.
 */

const DECIDED = new Set<string>(CRM_DECIDED_ESTIMATE_STATUSES);

const paramsSchema = z.object({ estimateId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    status: z.enum(CRM_ESTIMATE_STATUSES),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
  })
  .strict();

export async function PATCH(request: Request, context: { params: Promise<{ estimateId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_estimate_id", message: "The estimate id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const existing = await client
      .from("crm_estimates")
      .select(CRM_ESTIMATE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.estimateId)
      .maybeSingle();
    if (existing.error) return databaseErrorResponse(existing.error);
    if (!existing.data) {
      return jsonNoStore(
        { error: { code: "estimate_not_found", message: "No such estimate in this workspace." } },
        { status: 404 },
      );
    }
    const before = toEstimateView(existing.data as unknown as CrmEstimateRow);

    const now = new Date().toISOString();
    const changes: Record<string, unknown> = { status: payload.status };
    if (payload.notes !== undefined) changes.notes = payload.notes;
    // A decision has a moment; reopening one takes the moment back with it.
    changes.decided_at = DECIDED.has(payload.status) ? (before.decidedAt ?? now) : null;
    // An estimate is sent once. Deciding one that was never formally sent
    // records the send too — a customer cannot answer what they never saw.
    if (payload.status !== "draft" && before.sentAt === null) changes.sent_at = now;

    const { data, error } = await client
      .from("crm_estimates")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.estimateId)
      .select(CRM_ESTIMATE_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "estimate_not_found", message: "No such estimate in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ estimate: toEstimateView(data as unknown as CrmEstimateRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_estimate_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_estimate_not_updated", message: "The estimate could not be updated." } },
      { status: 500 },
    );
  }
}
