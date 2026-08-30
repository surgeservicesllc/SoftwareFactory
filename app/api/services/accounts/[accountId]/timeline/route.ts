import { z } from "zod";

import {
  CRM_MANUAL_TIMELINE_KINDS,
  CRM_TIMELINE_COLUMNS,
  toTimelineView,
  type CrmTimelineRow,
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
 * Record something that happened, into the immutable timeline.
 *
 * Only the hand-recordable kinds are accepted: a note, a call, an email, an
 * SMS, a task. `status_change`, `service` and `payment` are system-written
 * history — the schema's trigger and later increments' machinery — and a
 * route that accepted them would let anyone type a payment that never
 * happened into an audit trail that promises otherwise. There is no PATCH
 * and no DELETE here, and the database holds no grant for either.
 */

const paramsSchema = z.object({ accountId: z.string().uuid() }).strict();

const eventSchema = z
  .object({
    kind: z.enum(CRM_MANUAL_TIMELINE_KINDS),
    summary: z.string().trim().min(1).max(300),
    detail: z.string().trim().min(1).max(4000).nullish(),
    /** When it happened, if not "now" — a call logged after the fact. */
    occurredAt: z.string().datetime().optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_account_id", message: "The account id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = eventSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_timeline_events")
      .insert({
        organization_id: activeOrganization.id,
        account_id: parsed.data.accountId,
        kind: payload.kind,
        summary: payload.summary,
        detail: payload.detail ?? null,
        ...(payload.occurredAt ? { occurred_at: payload.occurredAt } : {}),
        actor_user_id: user.id,
      })
      .select(CRM_TIMELINE_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "account_not_found", message: "No such account in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ event: toTimelineView(data as unknown as CrmTimelineRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_timeline_event",
            message: error.issues[0]?.message ?? "The event could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_event_not_recorded", message: "The event could not be recorded." } },
      { status: 500 },
    );
  }
}
