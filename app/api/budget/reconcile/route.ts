import { z } from "zod";

import { reconcile, type AnalyticsTransaction } from "@/lib/budget/analytics";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Where an account's statement stops agreeing with its own amounts.
 *
 * `reconcile()` has existed since the import shipped — it found 38
 * discontinuities in the owner's 8,040 rows — but nothing surfaced it, so
 * the finding lived only in a test. This read runs it over one account's
 * full ledger, oldest first.
 *
 * The anchor: the walk starts so that the FIRST row carrying a stated
 * balance reconciles exactly (stated minus the amounts up to and
 * including it). Rows before that anchor have no stated balance to
 * disagree with; every break after it is the statement's own arithmetic
 * failing, which is precisely what the page should show and an importer
 * should never paper over.
 */

const querySchema = z.object({ accountId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { accountId } = querySchema.parse({ accountId: url.searchParams.get("accountId") });
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("budget_transactions")
      .select("posted_on, kind, description, amount_cents, balance_after_cents")
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .eq("account_id", accountId)
      .order("posted_on", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(10_000);
    if (error) return databaseErrorResponse(error);

    const rows = ((data ?? []) as Array<{
      posted_on: string;
      kind: string;
      description: string;
      amount_cents: number;
      balance_after_cents: number | null;
    }>).map<AnalyticsTransaction>((row) => ({
      postedOn: row.posted_on,
      kind: row.kind,
      description: row.description,
      amountCents: Number(row.amount_cents),
      balanceAfterCents: row.balance_after_cents === null ? null : Number(row.balance_after_cents),
    }));

    const anchorIndex = rows.findIndex(
      (row) => row.balanceAfterCents !== null && row.balanceAfterCents !== undefined,
    );
    if (anchorIndex === -1) {
      return jsonNoStore({
        checkedCount: 0,
        totalBreaks: 0,
        breaks: [],
        note: "No row on this account carries a stated balance, so there is nothing to reconcile against.",
      });
    }
    let upToAnchor = 0;
    for (let index = 0; index <= anchorIndex; index += 1) {
      upToAnchor += rows[index].amountCents;
    }
    const startingBalanceCents = (rows[anchorIndex].balanceAfterCents as number) - upToAnchor;

    const result = reconcile(rows, startingBalanceCents);
    return jsonNoStore({
      checkedCount: result.checkedCount,
      endingComputedCents: result.endingComputedCents,
      totalBreaks: result.breaks.length,
      // Fifty is plenty to act on; the count above is the honest total.
      breaks: result.breaks.slice(0, 50),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_account", message: "A valid accountId is required." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_reconcile_unavailable", message: "The reconciliation could not be run." } },
      { status: 500 },
    );
  }
}
