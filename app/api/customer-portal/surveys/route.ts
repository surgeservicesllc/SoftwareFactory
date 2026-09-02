import { z } from "zod";

import {
  toPortalSurveyMineView,
  type CrmPortalSurveyMineRow,
} from "@/lib/services/customers-side";
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
 * The customer rates a completed visit, once, in the portal — no email
 * needed. The definer checks the visit is theirs and completed and refuses
 * a second rating; each refusal is the customer's answer, not a 500.
 */

const submitSchema = z
  .object({
    workOrderId: z.string().uuid(),
    score: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_surveys_mine");
    if (error) throw error;
    return jsonNoStore({ surveys: ((data ?? []) as CrmPortalSurveyMineRow[]).map(toPortalSurveyMineView) });
  } catch (error) {
    return portalErrorResponse(error, "portal_surveys_unavailable", "Your ratings could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = submitSchema.parse(await readBoundedJson(request, 8_000));
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_survey_submit", {
      p_work_order: payload.workOrderId,
      p_score: payload.score,
      p_comment: payload.comment ?? null,
    });
    if (error) {
      const message = error.message ?? "";
      if (/already been rated/i.test(message)) {
        return jsonNoStore({ error: { code: "already_rated", message: "You have already rated this visit." } }, { status: 409 });
      }
      if (/once it is completed/i.test(message)) {
        return jsonNoStore({ error: { code: "visit_not_completed", message: "A visit can be rated once it is completed." } }, { status: 409 });
      }
      if (/not on this account/i.test(message)) {
        return jsonNoStore({ error: { code: "visit_not_on_account", message: "That visit is not on your account." } }, { status: 404 });
      }
      throw error;
    }
    return jsonNoStore({ surveyId: data as string }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_survey", message: error.issues[0]?.message ?? "The rating could not be sent." } },
        { status: 422 },
      );
    }
    return portalErrorResponse(error, "portal_survey_not_sent", "Your rating could not be sent.");
  }
}
