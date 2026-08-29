import { percentOf } from "@/lib/budget/money";

/**
 * The arithmetic behind the Budget Tracker's views.
 *
 * Pure functions over plain data: no I/O, no clock, no Supabase client. That
 * is what lets the interesting cases — a month with no income, a card with no
 * limit, a ledger that stops reconciling in 2015 — be settled by a unit test
 * instead of noticed in production by the person whose money it is.
 *
 * Two rules run through all of it:
 *
 *   1. Transfers between a person's own accounts are not income and not
 *      spending. Counting them doubles both sides of a household's totals.
 *   2. A figure that cannot be computed is `null`, never `0`. A credit card
 *      with no stated limit has unknown utilization, not 0% utilization.
 */

export type AnalyticsTransaction = {
  readonly postedOn: string;
  readonly kind: string;
  readonly amountCents: number;
  readonly categoryId?: string | null;
  readonly balanceAfterCents?: number | null;
  readonly description?: string;
};

export type AnalyticsAccount = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly currentBalanceCents: number;
  readonly creditLimitCents?: number | null;
  readonly aprBps?: number | null;
  readonly isActive?: boolean;
};

export type AnalyticsObligation = {
  readonly id: string;
  readonly name: string;
  readonly dueDay: number;
  readonly amountCents: number;
  readonly balanceCents?: number | null;
  readonly aprBps?: number | null;
  readonly creditLimitCents?: number | null;
  readonly status?: string;
  /** Carried through so the bill list can say so without a second lookup. */
  readonly autopay?: boolean;
};

/** A move between the person's own accounts, in either direction. */
export const TRANSFER_KINDS: ReadonlySet<string> = new Set(["transfer_in", "transfer_out"]);

export function isTransfer(kind: string): boolean {
  return TRANSFER_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export type MonthlyFlow = {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
  readonly transactionCount: number;
};

/**
 * Income, spending and the difference, by calendar month, newest last.
 *
 * Expenses are returned as a positive magnitude — the amount that left —
 * because every chart and table built on this displays them as a size, and
 * a value that is sometimes negative and sometimes not is the thing that
 * eventually gets added where it should have been subtracted.
 */
export function monthlyCashFlow(
  transactions: readonly AnalyticsTransaction[],
): readonly MonthlyFlow[] {
  const months = new Map<string, { income: number; expense: number; count: number }>();

  for (const transaction of transactions) {
    if (isTransfer(transaction.kind)) continue;
    const month = transaction.postedOn.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const bucket = months.get(month) ?? { income: 0, expense: 0, count: 0 };
    if (transaction.amountCents > 0) bucket.income += transaction.amountCents;
    else bucket.expense += Math.abs(transaction.amountCents);
    bucket.count += 1;
    months.set(month, bucket);
  }

  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      incomeCents: bucket.income,
      expenseCents: bucket.expense,
      netCents: bucket.income - bucket.expense,
      transactionCount: bucket.count,
    }));
}

/** The average of the last `count` complete months, or `null` if there are none. */
export function averageMonthlyNet(
  flows: readonly MonthlyFlow[],
  count = 6,
): number | null {
  if (flows.length === 0 || count <= 0) return null;
  const window = flows.slice(-count);
  const total = window.reduce((sum, flow) => sum + flow.netCents, 0);
  return Math.round(total / window.length);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryTotal = {
  readonly categoryId: string | null;
  readonly spentCents: number;
  readonly transactionCount: number;
};

/**
 * Spending by category for one month, largest first.
 *
 * Uncategorised spending is a real bucket with a `null` id rather than a
 * silently dropped remainder: a category breakdown whose parts do not add up
 * to the month's spending is a breakdown of nothing in particular.
 */
export function categoryTotalsForMonth(
  transactions: readonly AnalyticsTransaction[],
  month: string,
): readonly CategoryTotal[] {
  const totals = new Map<string | null, { spent: number; count: number }>();

  for (const transaction of transactions) {
    if (isTransfer(transaction.kind)) continue;
    if (transaction.amountCents >= 0) continue;
    if (transaction.postedOn.slice(0, 7) !== month) continue;
    const key = transaction.categoryId ?? null;
    const bucket = totals.get(key) ?? { spent: 0, count: 0 };
    bucket.spent += Math.abs(transaction.amountCents);
    bucket.count += 1;
    totals.set(key, bucket);
  }

  return [...totals.entries()]
    .map(([categoryId, bucket]) => ({
      categoryId,
      spentCents: bucket.spent,
      transactionCount: bucket.count,
    }))
    .sort((a, b) => b.spentCents - a.spentCents);
}

export type PlanComparison = {
  readonly categoryId: string;
  readonly plannedCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
  readonly usedPercent: number | null;
  readonly overspent: boolean;
};

/** Planned against actual for one month. */
export function compareToPlan(
  plans: readonly { readonly categoryId: string; readonly plannedCents: number }[],
  totals: readonly CategoryTotal[],
): readonly PlanComparison[] {
  const spentByCategory = new Map(
    totals.filter((total) => total.categoryId !== null).map((total) => [total.categoryId, total.spentCents]),
  );
  return plans.map((plan) => {
    const spent = spentByCategory.get(plan.categoryId) ?? 0;
    return {
      categoryId: plan.categoryId,
      plannedCents: plan.plannedCents,
      spentCents: spent,
      remainingCents: plan.plannedCents - spent,
      usedPercent: percentOf(spent, plan.plannedCents),
      overspent: spent > plan.plannedCents,
    };
  });
}

// ---------------------------------------------------------------------------
// Accounts and debt
// ---------------------------------------------------------------------------

/**
 * How much of a credit line is used, as a percentage.
 *
 * `null` when there is no limit to measure against — a mortgage has no
 * utilization, and a card whose limit was never recorded has an unknown one.
 * Balances are held as negative on credit accounts, so the magnitude is what
 * counts here.
 */
export function utilizationPercent(account: AnalyticsAccount): number | null {
  if (account.kind !== "credit_card") return null;
  const limit = account.creditLimitCents;
  if (limit === null || limit === undefined || limit <= 0) return null;
  return percentOf(Math.abs(account.currentBalanceCents), limit);
}

export type NetWorth = {
  readonly assetsCents: number;
  readonly liabilitiesCents: number;
  readonly netCents: number;
};

const ASSET_KINDS: ReadonlySet<string> = new Set(["checking", "savings", "brokerage"]);

/**
 * Assets, liabilities and the difference.
 *
 * A liability is stored as a negative balance, so its magnitude is the debt.
 * Accounts of kind `other` are counted by the sign of their balance, which is
 * the only honest reading available for an account whose kind says nothing.
 */
export function netWorth(accounts: readonly AnalyticsAccount[]): NetWorth {
  let assets = 0;
  let liabilities = 0;
  for (const account of accounts) {
    if (account.isActive === false) continue;
    const isAsset = ASSET_KINDS.has(account.kind)
      || (account.kind === "other" && account.currentBalanceCents >= 0);
    if (isAsset) assets += account.currentBalanceCents;
    else liabilities += Math.abs(account.currentBalanceCents);
  }
  return { assetsCents: assets, liabilitiesCents: liabilities, netCents: assets - liabilities };
}

export type PayoffStrategy = "avalanche" | "snowball";

/**
 * Debts in the order a strategy would clear them.
 *
 * Avalanche takes the highest rate first, which costs the least. Snowball
 * takes the smallest balance first, which clears an account soonest. Both are
 * offered because the cheaper one is not always the one a household will
 * actually stick to, and the tracker's job is to show the order, not to pick.
 *
 * A debt with no rate recorded sorts last under avalanche rather than first:
 * an unknown rate is not a zero rate, and putting it at the top would send
 * money at the debt we know least about.
 */
export function payoffOrder(
  obligations: readonly AnalyticsObligation[],
  strategy: PayoffStrategy,
): readonly AnalyticsObligation[] {
  const owed = obligations.filter(
    (obligation) => (obligation.balanceCents ?? 0) > 0 && obligation.status !== "closed",
  );
  return [...owed].sort((a, b) => {
    if (strategy === "snowball") {
      return (a.balanceCents ?? 0) - (b.balanceCents ?? 0) || a.name.localeCompare(b.name);
    }
    const aprA = a.aprBps ?? -1;
    const aprB = b.aprBps ?? -1;
    return aprB - aprA || (a.balanceCents ?? 0) - (b.balanceCents ?? 0) || a.name.localeCompare(b.name);
  });
}

/** Monthly interest at the stated rate, in cents. `null` without a rate. */
export function monthlyInterestCents(
  balanceCents: number | null | undefined,
  aprBps: number | null | undefined,
): number | null {
  if (balanceCents === null || balanceCents === undefined) return null;
  if (aprBps === null || aprBps === undefined) return null;
  if (balanceCents <= 0) return 0;
  return Math.round((balanceCents * (aprBps / 10_000)) / 12);
}

// ---------------------------------------------------------------------------
// The bill calendar
// ---------------------------------------------------------------------------

export type UpcomingBill = {
  readonly obligation: AnalyticsObligation;
  /** `YYYY-MM-DD`. */
  readonly dueOn: string;
  readonly daysAway: number;
  readonly overdue: boolean;
};

/**
 * The next occurrence of every recurring obligation, soonest first.
 *
 * `today` is a parameter rather than a call to `Date.now()` so that "what is
 * due this week" is testable and does not change under the test suite.
 *
 * A due day later than the month has — the 31st in February — lands on the
 * last day of that month rather than rolling into the next one, which is what
 * a bank does and what the person expects to see.
 */
export function upcomingBills(
  obligations: readonly AnalyticsObligation[],
  today: Date,
  withinDays = 45,
): readonly UpcomingBill[] {
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const bills: UpcomingBill[] = [];

  for (const obligation of obligations) {
    if (obligation.status === "closed") continue;

    for (const monthOffset of [0, 1]) {
      const year = today.getUTCFullYear();
      const month = today.getUTCMonth() + monthOffset;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const day = Math.min(obligation.dueDay, lastDay);
      const dueMs = Date.UTC(year, month, day);
      const daysAway = Math.round((dueMs - startOfToday) / 86_400_000);
      if (daysAway < 0) continue;
      if (daysAway > withinDays) continue;
      bills.push({
        obligation,
        dueOn: new Date(dueMs).toISOString().slice(0, 10),
        daysAway,
        overdue: obligation.status === "overdue",
      });
      break;
    }
  }

  return bills.sort((a, b) => a.daysAway - b.daysAway || a.obligation.name.localeCompare(b.obligation.name));
}

/** What the recurring obligations demand in a month. */
export function monthlyObligationTotalCents(
  obligations: readonly AnalyticsObligation[],
): number {
  return obligations
    .filter((obligation) => obligation.status !== "closed")
    .reduce((sum, obligation) => sum + obligation.amountCents, 0);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type ReconciliationBreak = {
  readonly index: number;
  readonly postedOn: string;
  readonly description: string;
  readonly computedCents: number;
  readonly statedCents: number;
  readonly deltaCents: number;
};

export type Reconciliation = {
  readonly checkedCount: number;
  readonly breaks: readonly ReconciliationBreak[];
  readonly endingComputedCents: number;
};

/**
 * Walk a ledger and find where the statement's own running total stops
 * agreeing with the sum of its amounts.
 *
 * This exists because the spreadsheet this product replaces does not fully
 * reconcile — twenty years of hand edits left thirty-eight discontinuities in
 * eight thousand rows — and the honest thing to do with that is show it. An
 * importer that quietly adopted the stated balance would produce a ledger
 * that looks right and cannot be audited.
 *
 * After each break the walk resumes from the *stated* balance, so one bad row
 * reports as one break rather than making every row after it look wrong.
 */
export function reconcile(
  transactions: readonly AnalyticsTransaction[],
  startingBalanceCents: number,
  toleranceCents = 1,
): Reconciliation {
  let running = startingBalanceCents;
  let checked = 0;
  const breaks: ReconciliationBreak[] = [];

  for (const [index, transaction] of transactions.entries()) {
    running += transaction.amountCents;
    const stated = transaction.balanceAfterCents;
    if (stated === null || stated === undefined) continue;
    checked += 1;
    if (Math.abs(stated - running) > toleranceCents) {
      breaks.push({
        index,
        postedOn: transaction.postedOn,
        description: transaction.description ?? "",
        computedCents: running,
        statedCents: stated,
        deltaCents: stated - running,
      });
      running = stated;
    }
  }

  return { checkedCount: checked, breaks, endingComputedCents: running };
}
