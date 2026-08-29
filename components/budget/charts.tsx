"use client";

import { formatCents } from "@/lib/budget/money";
import type { MonthlyFlow } from "@/lib/budget/analytics";

/**
 * Charts drawn as inline SVG, with no charting dependency.
 *
 * Each one is a table of numbers rendered as a picture, so each carries the
 * numbers too: a `<title>` per bar and a visually-hidden table underneath.
 * A chart that only exists as shapes is unreadable to a screen reader and
 * unreadable to anyone whose CSS did not load, and this page is about money.
 */

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return MONTH_LABEL.format(date);
}

/**
 * Income against spending, month by month.
 *
 * Both series share one scale — drawing them on separate scales would make a
 * month that spent twice what it earned look balanced.
 */
export function CashFlowChart({ flows }: { flows: readonly MonthlyFlow[] }) {
  if (flows.length === 0) return null;

  const window = flows.slice(-12);
  const peak = Math.max(
    1,
    ...window.map((flow) => Math.max(flow.incomeCents, flow.expenseCents)),
  );
  const width = 100 / window.length;

  return (
    <figure className="mt-4">
      <div
        className="flex h-44 items-end gap-1 overflow-x-auto"
        role="img"
        aria-label={`Income and spending for the last ${window.length} months`}
      >
        {window.map((flow) => {
          const incomeHeight = Math.max((flow.incomeCents / peak) * 100, flow.incomeCents > 0 ? 2 : 0);
          const expenseHeight = Math.max((flow.expenseCents / peak) * 100, flow.expenseCents > 0 ? 2 : 0);
          return (
            <div
              key={flow.month}
              className="flex h-full min-w-9 flex-1 flex-col justify-end"
              style={{ flexBasis: `${width}%` }}
            >
              <div className="flex h-full items-end justify-center gap-0.5">
                <span
                  className="w-2.5 rounded-t-sm bg-[var(--accent)] sm:w-3"
                  style={{ height: `${incomeHeight}%` }}
                >
                  <span className="sr-only">
                    {flow.month} income {formatCents(flow.incomeCents)}
                  </span>
                </span>
                <span
                  className="w-2.5 rounded-t-sm bg-[var(--danger)] sm:w-3"
                  style={{ height: `${expenseHeight}%` }}
                >
                  <span className="sr-only">
                    {flow.month} spending {formatCents(flow.expenseCents)}
                  </span>
                </span>
              </div>
              <span className="mt-1.5 text-center text-[0.65rem] text-faint">
                {monthLabel(flow.month)}
              </span>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--accent)]" aria-hidden="true" />
          Money in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--danger)]" aria-hidden="true" />
          Money out
        </span>
        <span className="text-faint">Transfers between your own accounts are counted as neither.</span>
      </figcaption>
    </figure>
  );
}

/**
 * A single proportion — how much of a credit line is used.
 *
 * `null` renders as "no limit recorded" rather than an empty bar, because an
 * empty bar reads as 0% and an unknown utilization is not zero.
 */
export function UtilizationBar({
  percent,
  label,
}: {
  percent: number | null;
  label: string;
}) {
  if (percent === null) {
    return <p className="text-xs text-faint">No credit limit recorded</p>;
  }
  const clamped = Math.min(Math.max(percent, 0), 100);
  const tone =
    percent >= 90 ? "var(--danger)" : percent >= 30 ? "var(--warning)" : "var(--accent)";

  return (
    <div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
        role="meter"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} credit used`}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${clamped}%`, backgroundColor: tone }}
        />
      </div>
      <p className="tabular mt-1 text-xs text-muted">{percent.toFixed(0)}% of limit used</p>
    </div>
  );
}
