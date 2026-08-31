import { z } from "zod";

import {
  categoryTotalsForMonth,
  compareToPlan,
  type AnalyticsTransaction,
} from "@/lib/budget/analytics";
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
 * The month's plan, compared against what actually happened.
 *
 * `budget_month_plans` and `compareToPlan` have existed since the
 * foundation with no surface on top. The comparison reuses
 * `categoryTotalsForMonth` — the same spend definition the overview uses
 * (money out, transfers excluded) — so "spent" here can never disagree
 * with "spent" there.
 */

const MONTH_PATTERN = /^\d{4}-\d{2}-01$/;

const putSchema = z
  .object({
    categoryId: z.string().uuid(),
    month: z.string().regex(MONTH_PATTERN, "A month is its first day, like 2026-08-01."),
    // null clears the plan for that category and month.
    plannedCents: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requested = url.searchParams.get("month");
    const month = requested && MONTH_PATTERN.test(requested)
      ? requested
      : `${new Date().toISOString().slice(0, 7)}-01`;
    const monthKey = month.slice(0, 7);
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const [plansRead, transactionsRead] = await Promise.all([
      client
        .from("budget_month_plans")
        .select("category_id, planned_cents")
        .eq("organization_id", activeOrganization.id)
        .eq("user_id", user.id)
        .eq("month", month)
        .limit(300),
      client
        .from("budget_transactions")
        .select("category_id, posted_on, kind, amount_cents")
        .eq("organization_id", activeOrganization.id)
        .eq("user_id", user.id)
        .gte("posted_on", month)
        .lt("posted_on", nextMonth(month))
        .limit(10_000),
    ]);
    if (plansRead.error) return databaseErrorResponse(plansRead.error);
    if (transactionsRead.error) return databaseErrorResponse(transactionsRead.error);

    const plans = ((plansRead.data ?? []) as Array<{ category_id: string; planned_cents: number }>).map(
      (row) => ({ categoryId: row.category_id, plannedCents: Number(row.planned_cents) }),
    );
    const transactions = ((transactionsRead.data ?? []) as Array<{
      category_id: string | null;
      posted_on: string;
      kind: string;
      amount_cents: number;
    }>).map<AnalyticsTransaction>((row) => ({
      postedOn: row.posted_on,
      kind: row.kind,
      amountCents: Number(row.amount_cents),
      categoryId: row.category_id,
    }));

    const comparisons = compareToPlan(plans, categoryTotalsForMonth(transactions, monthKey));
    return jsonNoStore({ month, comparisons });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_plans_unavailable", message: "The month's plan could not be loaded." } },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = putSchema.parse(await readBoundedJson(request, 8_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    if (payload.plannedCents === null) {
      const { error } = await client
        .from("budget_month_plans")
        .delete()
        .eq("organization_id", activeOrganization.id)
        .eq("user_id", user.id)
        .eq("category_id", payload.categoryId)
        .eq("month", payload.month);
      if (error) return databaseErrorResponse(error);
      return jsonNoStore({ cleared: true });
    }

    const { error } = await client
      .from("budget_month_plans")
      .upsert(
        {
          organization_id: activeOrganization.id,
          user_id: user.id,
          category_id: payload.categoryId,
          month: payload.month,
          planned_cents: payload.plannedCents,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,user_id,category_id,month" },
      );
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ saved: true });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_plan",
            message: error.issues[0]?.message ?? "The plan could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_plan_not_saved", message: "The plan could not be saved." } },
      { status: 500 },
    );
  }
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const rolled = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
  return `${rolled}-01`;
}
