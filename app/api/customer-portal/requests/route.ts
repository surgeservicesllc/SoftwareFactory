import { z } from "zod";

import {
  CRM_REQUEST_KINDS,
  toPortalRequestMineView,
  type CrmPortalRequestMineRow,
} from "@/lib/services/crm";
import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * Invariant 3: the customer can say something, once.
 *
 * There is no PATCH and no DELETE on this route. A request the customer
 * sent is answered by staff, not edited by either side — the customer's
 * words and the company's reply are separate columns, and neither
 * overwrites the other.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    kind: z.enum(CRM_REQUEST_KINDS as unknown as [string, ...string[]]),
    summary: z.string().trim().min(1, "Say what you need in a line.").max(200),
    detail: z.string().trim().min(1).max(4000).nullish(),
    propertyId: z.string().uuid().nullish(),
    preferredDate: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_requests_mine");
    if (error) throw error;

    const requests = ((data ?? []) as CrmPortalRequestMineRow[]).map(toPortalRequestMineView);

    return jsonNoStore({
      requests,
      counts: {
        total: requests.length,
        open: requests.filter((request) => request.open).length,
        /*
         * Open requests nobody has written back to yet. This is the
         * number a customer is actually asking about when they open the
         * page, so it is shown rather than folded into "open".
         */
        awaitingReply: requests.filter((request) => request.open && !request.answered).length,
      },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_requests_unavailable", "Your requests could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client } = await requirePortalUser();

    const { data, error } = await client.rpc("crm_portal_submit_request", {
      p_kind: payload.kind,
      p_summary: payload.summary,
      p_detail: payload.detail ?? null,
      p_property_id: payload.propertyId ?? null,
      p_preferred_date: payload.preferredDate ?? null,
    });
    if (error) {
      // The function refuses a site that is not on the caller's account by
      // name. That refusal is the customer's answer, not a 500.
      if (error.code === "23514" || /not on this account/i.test(error.message ?? "")) {
        return jsonNoStore(
          {
            error: {
              code: "property_not_on_account",
              message: "That site is not on your account.",
            },
          },
          { status: 404 },
        );
      }
      throw error;
    }

    return jsonNoStore({ requestId: data as string }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_portal_request",
            message: error.issues[0]?.message ?? "The request could not be sent.",
          },
        },
        { status: 422 },
      );
    }
    return portalErrorResponse(error, "portal_request_not_sent", "Your request could not be sent.");
  }
}
