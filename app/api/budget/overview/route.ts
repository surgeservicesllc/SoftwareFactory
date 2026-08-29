import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Everything the dashboard shows, in one request.
 *
 * The alternative — four fetches from the browser, each aggregating in the
 * client — would ship the whole ledger to the page to add it up. Twenty years
 * of one checking account is eight thousand rows, so the monthly totals are
 * computed by `budget_monthly_flow` in the database and only the months come
 * back.
 *
 * Every read here is RLS-scoped to the person making it, including the two
 * aggregate functions, which are SECURITY INVOKER for exactly that reason.
 */

type FlowRow = {
  month: string;
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  transaction_count: number;
};

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const [accounts, obligations, flow, recent, batches] = await Promise.all([
      client
        .from("budget_accounts")
        .select(
          "id, name, institution, kind, last4, current_balance_cents, credit_limit_cents, apr_bps, promo_apr_ends_on, is_active, sort_rank",
        )
        .eq("organization_id", activeOrganization.id)
        .order("sort_rank", { ascending: true })
        .order("name", { ascending: true })
        .limit(200),
      client
        .from("budget_obligations")
        .select(
          "id, account_id, name, due_day, amount_cents, balance_cents, credit_limit_cents, apr_bps, status, paid_from, owner_label, payoff_rank, autopay",
        )
        .eq("organization_id", activeOrganization.id)
        .order("due_day", { ascending: true })
        .limit(300),
      client.rpc("budget_monthly_flow", {
        p_organization_id: activeOrganization.id,
        p_months: 24,
      }),
      client
        .from("budget_transactions")
        .select("id, account_id, category_id, posted_on, kind, description, amount_cents")
        .eq("organization_id", activeOrganization.id)
        .order("posted_on", { ascending: false })
        .order("id", { ascending: false })
        .limit(12),
      client
        .from("budget_import_batches")
        .select("id, source_name, sheet_name, rows_read, rows_imported, rows_skipped, notice, created_at")
        .eq("organization_id", activeOrganization.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    for (const result of [accounts, obligations, flow, recent, batches]) {
      if (result.error) return databaseErrorResponse(result.error);
    }

    return jsonNoStore({
      accounts: (accounts.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        institution: row.institution,
        kind: row.kind,
        last4: row.last4,
        currentBalanceCents: Number(row.current_balance_cents),
        creditLimitCents: row.credit_limit_cents === null ? null : Number(row.credit_limit_cents),
        aprBps: row.apr_bps,
        promoAprEndsOn: row.promo_apr_ends_on,
        isActive: row.is_active,
      })),
      obligations: (obligations.data ?? []).map((row) => ({
        id: row.id,
        accountId: row.account_id,
        name: row.name,
        dueDay: row.due_day,
        amountCents: Number(row.amount_cents),
        balanceCents: row.balance_cents === null ? null : Number(row.balance_cents),
        creditLimitCents: row.credit_limit_cents === null ? null : Number(row.credit_limit_cents),
        aprBps: row.apr_bps,
        status: row.status,
        paidFrom: row.paid_from,
        ownerLabel: row.owner_label,
        payoffRank: row.payoff_rank,
        autopay: row.autopay,
      })),
      // Oldest first, which is the order every chart reads them in.
      flows: ((flow.data ?? []) as FlowRow[])
        .map((row) => ({
          month: String(row.month).slice(0, 7),
          incomeCents: Number(row.income_cents),
          expenseCents: Number(row.expense_cents),
          netCents: Number(row.net_cents),
          transactionCount: Number(row.transaction_count),
        }))
        .reverse(),
      recent: (recent.data ?? []).map((row) => ({
        id: row.id,
        accountId: row.account_id,
        categoryId: row.category_id,
        postedOn: row.posted_on,
        kind: row.kind,
        description: row.description,
        amountCents: Number(row.amount_cents),
      })),
      imports: (batches.data ?? []).map((row) => ({
        id: row.id,
        sourceName: row.source_name,
        sheetName: row.sheet_name,
        rowsRead: row.rows_read,
        rowsImported: row.rows_imported,
        rowsSkipped: row.rows_skipped,
        notice: row.notice,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_overview_unavailable", message: "The budget could not be loaded." } },
      { status: 500 },
    );
  }
}
