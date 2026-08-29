"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CreditCard,
  Landmark,
  Scale,
} from "lucide-react";

import { CashFlowChart, UtilizationBar } from "@/components/budget/charts";
import type { BudgetOverview } from "@/components/budget/types";
import { ACCOUNT_KIND_LABEL, OBLIGATION_STATUS_LABEL } from "@/components/budget/types";
import { Card, EmptyState, MetricCard, SectionTitle } from "@/components/ui";
import {
  averageMonthlyNet,
  monthlyInterestCents,
  monthlyObligationTotalCents,
  netWorth,
  payoffOrder,
  upcomingBills,
  utilizationPercent,
  type PayoffStrategy,
} from "@/lib/budget/analytics";
import { formatBps, formatCents } from "@/lib/budget/money";

/**
 * The dashboard.
 *
 * Every figure on it is derived from rows the person owns, by the pure
 * functions in `lib/budget/analytics`. Nothing here is seeded, estimated or
 * illustrative — an empty account list produces an empty state that says so,
 * rather than a specimen household with plausible numbers.
 */

export function BudgetOverviewPanel({
  data,
  today,
  strategy,
  onStrategyChange,
}: {
  data: BudgetOverview;
  /** Injected so "due in three days" is testable and does not drift mid-suite. */
  today: Date;
  strategy: PayoffStrategy;
  onStrategyChange: (strategy: PayoffStrategy) => void;
}) {
  const worth = netWorth(
    data.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      currentBalanceCents: account.currentBalanceCents,
      creditLimitCents: account.creditLimitCents,
      aprBps: account.aprBps,
      isActive: account.isActive,
    })),
  );
  const averageNet = averageMonthlyNet(data.flows, 6);
  const latest = data.flows.at(-1) ?? null;
  const bills = upcomingBills(data.obligations, today, 45);
  const monthlyBills = monthlyObligationTotalCents(data.obligations);
  const cards = data.accounts.filter((account) => account.kind === "credit_card");
  const order = payoffOrder(data.obligations, strategy);

  if (data.accounts.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No accounts yet"
          description="Add a checking account, a card or a loan, then import a statement. Nothing here is filled in for you — every figure on this page comes from your own rows."
          icon={Landmark}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Net position"
          value={formatCents(worth.netCents, { whole: true })}
          detail={`${formatCents(worth.assetsCents, { whole: true })} held, ${formatCents(worth.liabilitiesCents, { whole: true })} owed`}
          icon={Scale}
          tone={worth.netCents >= 0 ? "safe" : "danger"}
        />
        <MetricCard
          label="This month"
          value={latest ? formatCents(latest.netCents, { signed: true, whole: true }) : "—"}
          detail={
            latest
              ? `${formatCents(latest.incomeCents, { whole: true })} in, ${formatCents(latest.expenseCents, { whole: true })} out`
              : "No transactions recorded yet"
          }
          icon={latest && latest.netCents >= 0 ? ArrowUpRight : ArrowDownRight}
          tone={latest ? (latest.netCents >= 0 ? "safe" : "danger") : "neutral"}
        />
        <MetricCard
          label="Six-month average"
          value={averageNet === null ? "—" : formatCents(averageNet, { signed: true, whole: true })}
          detail={
            averageNet === null
              ? "Needs at least one month of history"
              : "What a typical month leaves behind"
          }
          icon={Scale}
          tone={averageNet === null ? "neutral" : averageNet >= 0 ? "safe" : "warning"}
        />
        <MetricCard
          label="Committed monthly"
          value={formatCents(monthlyBills, { whole: true })}
          detail={`${data.obligations.filter((o) => o.status !== "closed").length} recurring obligations`}
          icon={CalendarClock}
          tone="neutral"
        />
      </div>

      <Card>
        <SectionTitle
          title="Cash flow"
          description="Income against spending, by month. Transfers between your own accounts are excluded from both."
        />
        {data.flows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No transactions yet. Import a statement and this fills in.
          </p>
        ) : (
          <CashFlowChart flows={data.flows} />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* min-w-0: a grid item's automatic minimum is its min-content, so a
            long unbreakable account name would size the track past a phone
            viewport before truncation ever gets a say. */}
        <Card className="min-w-0">
          <SectionTitle
            title="Due next"
            description="The next occurrence of each recurring obligation, within 45 days."
          />
          {bills.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Nothing recorded as due in the next 45 days.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {bills.slice(0, 8).map((bill) => (
                <li key={bill.obligation.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {bill.obligation.name}
                    </p>
                    <p className="text-xs text-faint">
                      {bill.dueOn} ·{" "}
                      {bill.daysAway === 0
                        ? "today"
                        : bill.daysAway === 1
                          ? "tomorrow"
                          : `in ${bill.daysAway} days`}
                      {bill.obligation.autopay ? " · autopay" : ""}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-medium text-foreground">
                    {formatCents(bill.obligation.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0">
          <SectionTitle
            title="Credit used"
            description="Balance against limit, per card."
          />
          {cards.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No credit cards recorded.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {cards.map((card) => (
                <li key={card.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    {/* min-w-0 lets the flex item shrink so truncate can act;
                        without it a long card name sets the grid's min-content
                        and pushes the whole overview past a phone viewport. */}
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {card.name}
                      {card.last4 ? (
                        <span className="ml-1.5 text-xs text-faint">••{card.last4}</span>
                      ) : null}
                    </span>
                    <span className="tabular shrink-0 text-sm text-muted">
                      {formatCents(Math.abs(card.currentBalanceCents))}
                      {card.creditLimitCents !== null
                        ? ` of ${formatCents(card.creditLimitCents, { whole: true })}`
                        : ""}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <UtilizationBar
                      percent={utilizationPercent({
                        id: card.id,
                        name: card.name,
                        kind: card.kind,
                        currentBalanceCents: card.currentBalanceCents,
                        creditLimitCents: card.creditLimitCents,
                      })}
                      label={card.name}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Payoff order"
          description="Two orders, because the cheaper one is not always the one a household sticks to."
          action={
            <div
              className="flex gap-1 rounded-full border border-line-strong p-0.5"
              role="group"
              aria-label="Payoff strategy"
            >
              {(["avalanche", "snowball"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onStrategyChange(option)}
                  aria-pressed={strategy === option}
                  className={
                    strategy === option
                      ? "rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-foreground"
                      : "rounded-full px-3 py-1 text-xs text-muted hover:text-foreground"
                  }
                >
                  {option === "avalanche" ? "Highest rate" : "Smallest balance"}
                </button>
              ))}
            </div>
          }
        />
        {order.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No balances recorded on your obligations, so there is nothing to rank.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">
                Debts in the order the {strategy === "avalanche" ? "highest rate" : "smallest balance"}{" "}
                strategy would clear them
              </caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">#</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Obligation</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Balance</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Rate</th>
                  <th scope="col" className="py-2 text-right font-medium">Interest / mo.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {order.slice(0, 12).map((debt, index) => (
                  <tr key={debt.id}>
                    <td className="tabular py-2.5 pr-3 text-faint">{index + 1}</td>
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-foreground">{debt.name}</span>
                      {debt.status && debt.status !== "scheduled" ? (
                        <span className="ml-2 text-xs text-faint">
                          {OBLIGATION_STATUS_LABEL[debt.status] ?? debt.status}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-foreground">
                      {formatCents(debt.balanceCents)}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-muted">
                      {formatBps(debt.aprBps)}
                    </td>
                    <td className="tabular py-2.5 text-right text-muted">
                      {formatCents(monthlyInterestCents(debt.balanceCents, debt.aprBps))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Latest activity" description="The most recent rows in your ledger." />
        {data.recent.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nothing imported or entered yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {data.recent.map((transaction) => {
              const account = data.accounts.find((entry) => entry.id === transaction.accountId);
              return (
                <li key={transaction.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{transaction.description}</p>
                    <p className="text-xs text-faint">
                      {transaction.postedOn}
                      {account ? ` · ${account.name}` : ""}
                      {account ? ` · ${ACCOUNT_KIND_LABEL[account.kind] ?? account.kind}` : ""}
                    </p>
                  </div>
                  <span
                    className={
                      transaction.amountCents >= 0
                        ? "tabular shrink-0 text-sm font-medium text-[var(--accent)]"
                        : "tabular shrink-0 text-sm font-medium text-foreground"
                    }
                  >
                    {formatCents(transaction.amountCents, { signed: transaction.amountCents > 0 })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {cards.length > 0 ? (
        <p className="flex items-center gap-2 text-xs text-faint">
          <CreditCard className="size-3.5" aria-hidden="true" />
          Balances are what you last recorded. This product has no bank connection, so nothing
          refreshes on its own.
        </p>
      ) : null}
    </div>
  );
}
