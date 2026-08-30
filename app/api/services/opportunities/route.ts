import { z } from "zod";

import {
  CRM_OPEN_OPPORTUNITY_STAGES,
  CRM_OPPORTUNITY_COLUMNS,
  CRM_OPPORTUNITY_STAGES,
  toOpportunityView,
  type CrmOpportunityRow,
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
 * The pipeline: list and create opportunities.
 *
 * The list carries a whole-book report — per-stage counts and value sums,
 * open value, won value, and the win rate over closed deals — computed from
 * a second read of the same table the list renders, so the numbers a
 * manager quotes and the rows a rep works are one authority. New deals
 * start in an open stage: won and lost are moves, recorded on the account
 * timeline by the database, never starting points.
 */

const listQuerySchema = z
  .object({
    stage: z.enum(CRM_OPPORTUNITY_STAGES).optional(),
    accountId: z.string().uuid().optional(),
  })
  .strict();

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    stage: z.enum(CRM_OPEN_OPPORTUNITY_STAGES).default("new"),
    valueCents: z.number().int().min(0).max(100_000_000_000).nullish(),
    expectedCloseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.")
      .nullish(),
    notes: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict();

type StageTally = { count: number; valueCents: number };

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      stage: url.searchParams.get("stage") ?? undefined,
      accountId: url.searchParams.get("accountId") ?? undefined,
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_opportunities_query", message: "The pipeline query is invalid." } },
        { status: 400 },
      );
    }

    const { client, activeOrganization } = await requireActiveOrganization();

    let query = client
      .from("crm_opportunities")
      .select(CRM_OPPORTUNITY_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (parsed.data.stage) query = query.eq("stage", parsed.data.stage);
    if (parsed.data.accountId) query = query.eq("account_id", parsed.data.accountId);
    const { data, error } = await query;
    if (error) return databaseErrorResponse(error);

    // The report reads the whole book, not the filtered page — a win rate
    // over one stage's slice would be a number that lies politely.
    const counted = await client
      .from("crm_opportunities")
      .select("stage, value_cents")
      .eq("organization_id", activeOrganization.id)
      .limit(10_000);
    if (counted.error) return databaseErrorResponse(counted.error);

    const byStage: Record<string, StageTally> = {};
    for (const stage of CRM_OPPORTUNITY_STAGES) byStage[stage] = { count: 0, valueCents: 0 };
    for (const row of (counted.data ?? []) as { stage: string; value_cents: number | null }[]) {
      const tally = (byStage[row.stage] ??= { count: 0, valueCents: 0 });
      tally.count += 1;
      tally.valueCents += row.value_cents ?? 0;
    }
    const open = CRM_OPEN_OPPORTUNITY_STAGES.reduce(
      (sum, stage) => ({
        count: sum.count + byStage[stage].count,
        valueCents: sum.valueCents + byStage[stage].valueCents,
      }),
      { count: 0, valueCents: 0 },
    );
    const closedCount = byStage.won.count + byStage.lost.count;

    return jsonNoStore({
      opportunities: ((data ?? []) as unknown as CrmOpportunityRow[]).map(toOpportunityView),
      report: {
        byStage,
        openCount: open.count,
        openValueCents: open.valueCents,
        wonCount: byStage.won.count,
        wonValueCents: byStage.won.valueCents,
        lostCount: byStage.lost.count,
        // Null until a deal has closed: 0% of nothing is not a rate.
        winRatePercent: closedCount === 0 ? null : Math.round((byStage.won.count / closedCount) * 100),
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_opportunities_unavailable", message: "The pipeline could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_opportunities")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        name: payload.name,
        stage: payload.stage,
        value_cents: payload.valueCents ?? null,
        expected_close_date: payload.expectedCloseDate ?? null,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_OPPORTUNITY_COLUMNS)
      .single();
    if (error) {
      // The composite FK refuses an account outside this organization — or
      // one that does not exist. Both read as the same honest answer.
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "account_not_found", message: "No such account in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { opportunity: toOpportunityView(data as unknown as CrmOpportunityRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_opportunity",
            message: error.issues[0]?.message ?? "The opportunity could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_opportunity_not_recorded", message: "The opportunity could not be recorded." } },
      { status: 500 },
    );
  }
}
