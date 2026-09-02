import {
  summarizeSurveys,
  toSurveyResponseView,
  type CrmSurveyResponseRow,
} from "@/lib/services/customers-side";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * What customers said after their visits. The responses come from
 * `crm_survey_responses` under the caller's RLS; the completed visits in
 * the same window are counted so the response rate has a denominator, and
 * the rate is null — not zero — until there is one.
 */

const RESPONSE_CEILING = 1000;

function window(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const days = window(new URL(request.url).searchParams.get("days"), 90, 365);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [responsesRead, completedRead] = await Promise.all([
      client.rpc("crm_survey_responses", { p_organization: activeOrganization.id, p_days: days }).limit(RESPONSE_CEILING),
      client
        .from("crm_work_orders")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization.id)
        .eq("status", "completed")
        .gte("completed_at", since),
    ]);
    if (responsesRead.error) return databaseErrorResponse(responsesRead.error);
    if (completedRead.error) return databaseErrorResponse(completedRead.error);
    const responses = ((responsesRead.data ?? []) as unknown as CrmSurveyResponseRow[]).map(toSurveyResponseView);
    return jsonNoStore({
      window: { days },
      responses,
      summary: summarizeSurveys(responses, completedRead.count ?? 0),
      ceiling: { responses: RESPONSE_CEILING, reached: responses.length >= RESPONSE_CEILING },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_surveys_unavailable", message: "The survey responses could not be read." } },
      { status: 500 },
    );
  }
}
