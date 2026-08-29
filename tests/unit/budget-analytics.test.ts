// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  averageMonthlyNet,
  categoryTotalsForMonth,
  compareToPlan,
  monthlyCashFlow,
  monthlyInterestCents,
  monthlyObligationTotalCents,
  netWorth,
  payoffOrder,
  reconcile,
  upcomingBills,
  utilizationPercent,
} from "@/lib/budget/analytics";

/**
 * The arithmetic the dashboard shows.
 *
 * Two rules are load-bearing and each has its own case here: transfers
 * between a person's own accounts are neither income nor spending, and a
 * figure that cannot be computed is null rather than zero.
 */

const transactions = [
  { postedOn: "2026-08-04", kind: "deposit", amountCents: 512300 },
  { postedOn: "2026-08-05", kind: "debit", amountCents: -123456 },
  { postedOn: "2026-08-06", kind: "transfer_out", amountCents: -2000000 },
  { postedOn: "2026-09-04", kind: "deposit", amountCents: 512300 },
  { postedOn: "2026-09-05", kind: "debit", amountCents: -9900 },
  { postedOn: "2026-09-06", kind: "transfer_in", amountCents: 364106 },
];

describe("monthlyCashFlow", () => {
  it("totals income and spending by month, oldest first", () => {
    const flows = monthlyCashFlow(transactions);
    expect(flows).toEqual([
      {
        month: "2026-08",
        incomeCents: 512300,
        expenseCents: 123456,
        netCents: 388844,
        transactionCount: 2,
      },
      {
        month: "2026-09",
        incomeCents: 512300,
        expenseCents: 9900,
        netCents: 502400,
        transactionCount: 2,
      },
    ]);
  });

  it("leaves transfers out of both sides", () => {
    // The two transfers above are 20,000 and 3,641.06 and appear in neither
    // column, nor in the counts.
    const flows = monthlyCashFlow(transactions);
    expect(flows.every((flow) => flow.transactionCount === 2)).toBe(true);
  });

  it("returns expenses as a positive magnitude", () => {
    // Every chart and table reads this as a size. A value that is sometimes
    // negative eventually gets added where it should have been subtracted.
    expect(monthlyCashFlow(transactions).every((flow) => flow.expenseCents >= 0)).toBe(true);
  });

  it("ignores a row whose date is not a date", () => {
    expect(monthlyCashFlow([{ postedOn: "not-a-date", kind: "debit", amountCents: -100 }])).toEqual([]);
  });
});

describe("averageMonthlyNet", () => {
  it("averages the recent window", () => {
    expect(averageMonthlyNet(monthlyCashFlow(transactions), 6)).toBe(445622);
  });

  it("returns null with no months rather than zero", () => {
    expect(averageMonthlyNet([], 6)).toBeNull();
  });
});

describe("categoryTotalsForMonth", () => {
  const rows = [
    { postedOn: "2026-09-05", kind: "debit", amountCents: -9900, categoryId: "utilities" },
    { postedOn: "2026-09-06", kind: "debit", amountCents: -6400, categoryId: "utilities" },
    { postedOn: "2026-09-07", kind: "debit", amountCents: -4000, categoryId: null },
    { postedOn: "2026-09-08", kind: "transfer_out", amountCents: -50000, categoryId: "utilities" },
    { postedOn: "2026-08-05", kind: "debit", amountCents: -99999, categoryId: "utilities" },
  ];

  it("sums the month's spending per category, largest first", () => {
    expect(categoryTotalsForMonth(rows, "2026-09")).toEqual([
      { categoryId: "utilities", spentCents: 16300, transactionCount: 2 },
      { categoryId: null, spentCents: 4000, transactionCount: 1 },
    ]);
  });

  it("keeps uncategorised spending as its own bucket", () => {
    // A breakdown whose parts do not add up to the month's spending is a
    // breakdown of nothing in particular.
    const totals = categoryTotalsForMonth(rows, "2026-09");
    const sum = totals.reduce((total, entry) => total + entry.spentCents, 0);
    expect(sum).toBe(20300);
  });
});

describe("compareToPlan", () => {
  it("reports what is left and whether it was overspent", () => {
    const totals = [{ categoryId: "food", spentCents: 92000, transactionCount: 9 }];
    expect(compareToPlan([{ categoryId: "food", plannedCents: 80000 }], totals)).toEqual([
      {
        categoryId: "food",
        plannedCents: 80000,
        spentCents: 92000,
        remainingCents: -12000,
        usedPercent: 115,
        overspent: true,
      },
    ]);
  });

  it("treats a category with no spending as zero spent, not as missing", () => {
    expect(compareToPlan([{ categoryId: "food", plannedCents: 80000 }], [])[0]).toMatchObject({
      spentCents: 0,
      overspent: false,
    });
  });
});

describe("utilizationPercent", () => {
  it("computes usage against the limit", () => {
    expect(
      utilizationPercent({
        id: "a",
        name: "Everyday card",
        kind: "credit_card",
        currentBalanceCents: -451_682,
        creditLimitCents: 500000,
      }),
    ).toBeCloseTo(90.34, 1);
  });

  it("returns null without a limit rather than zero", () => {
    // An unknown utilization is not 0% utilization, and a bar at zero reads
    // as a card with nothing on it.
    expect(
      utilizationPercent({
        id: "a",
        name: "Card",
        kind: "credit_card",
        currentBalanceCents: -320000,
        creditLimitCents: null,
      }),
    ).toBeNull();
  });

  it("returns null for anything that is not revolving credit", () => {
    expect(
      utilizationPercent({
        id: "a",
        name: "Mortgage",
        kind: "mortgage",
        currentBalanceCents: -12345600,
      }),
    ).toBeNull();
  });
});

describe("netWorth", () => {
  it("separates what is held from what is owed", () => {
    const worth = netWorth([
      { id: "1", name: "Checking", kind: "checking", currentBalanceCents: 1_000_000 },
      { id: "2", name: "Savings", kind: "savings", currentBalanceCents: 5_000_000 },
      { id: "3", name: "Everyday card", kind: "credit_card", currentBalanceCents: -320_000 },
      { id: "4", name: "Mortgage", kind: "mortgage", currentBalanceCents: -30_000_000 },
    ]);
    expect(worth).toEqual({
      assetsCents: 6_000_000,
      liabilitiesCents: 30_320_000,
      netCents: -24_320_000,
    });
  });

  it("leaves a closed account out", () => {
    const worth = netWorth([
      { id: "1", name: "Checking", kind: "checking", currentBalanceCents: 1_000_000 },
      { id: "2", name: "Old card", kind: "credit_card", currentBalanceCents: -900_000, isActive: false },
    ]);
    expect(worth.liabilitiesCents).toBe(0);
  });
});

describe("payoffOrder", () => {
  const debts = [
    { id: "1", name: "Small card", dueDay: 1, amountCents: 15_400, balanceCents: 150_000, aprBps: 1800 },
    { id: "2", name: "Big card", dueDay: 3, amountCents: 25_000, balanceCents: 3_200_000, aprBps: 1999 },
    { id: "3", name: "Unrated loan", dueDay: 5, amountCents: 7_700, balanceCents: 62_500, aprBps: null },
    { id: "4", name: "Cleared", dueDay: 7, amountCents: 0, balanceCents: 0, aprBps: 1899 },
  ];

  it("takes the highest rate first under avalanche", () => {
    expect(payoffOrder(debts, "avalanche").map((debt) => debt.name)).toEqual([
      "Big card",
      "Small card",
      "Unrated loan",
    ]);
  });

  it("sorts a debt with no recorded rate last, not first", () => {
    // An unknown rate is not a zero rate, and putting it first would send
    // money at the debt we know least about.
    expect(payoffOrder(debts, "avalanche").at(-1)?.name).toBe("Unrated loan");
  });

  it("takes the smallest balance first under snowball", () => {
    expect(payoffOrder(debts, "snowball").map((debt) => debt.name)).toEqual([
      "Unrated loan",
      "Small card",
      "Big card",
    ]);
  });

  it("leaves out anything already cleared or closed", () => {
    expect(payoffOrder(debts, "avalanche").some((debt) => debt.name === "Cleared")).toBe(false);
    expect(
      payoffOrder([{ ...debts[0], status: "closed" }], "avalanche"),
    ).toEqual([]);
  });
});

describe("monthlyInterestCents", () => {
  it("computes a month of interest at the stated rate", () => {
    // 3,200.00 at 25.53% is about 96.10 a month, which is what the source
    // spreadsheet's own column says.
    expect(monthlyInterestCents(320_000, 1999)).toBe(5331);
  });

  it("returns null without a rate rather than zero", () => {
    expect(monthlyInterestCents(320_000, null)).toBeNull();
    expect(monthlyInterestCents(null, 1999)).toBeNull();
  });

  it("is zero on a cleared balance", () => {
    expect(monthlyInterestCents(0, 1999)).toBe(0);
  });
});

describe("upcomingBills", () => {
  const today = new Date("2026-09-04T12:00:00Z");
  const obligations = [
    { id: "1", name: "Mortgage", dueDay: 1, amountCents: 123_456 },
    { id: "2", name: "Car", dueDay: 8, amountCents: 30_912 },
    { id: "3", name: "Card", dueDay: 5, amountCents: 7_700 },
    { id: "4", name: "Closed", dueDay: 6, amountCents: 1000, status: "closed" },
  ];

  it("lists the next occurrence of each, soonest first", () => {
    const bills = upcomingBills(obligations, today);
    expect(bills.map((bill) => [bill.obligation.name, bill.dueOn, bill.daysAway])).toEqual([
      ["Card", "2026-09-05", 1],
      ["Car", "2026-09-08", 4],
      // The 1st has passed this month, so the next one is next month's.
      ["Mortgage", "2026-10-01", 27],
    ]);
  });

  it("leaves a closed obligation out", () => {
    expect(upcomingBills(obligations, today).some((bill) => bill.obligation.name === "Closed")).toBe(
      false,
    );
  });

  it("lands a 31st due day on the last day of a shorter month", () => {
    // What a bank does, and what the person expects to see.
    const bills = upcomingBills(
      [{ id: "1", name: "Rent", dueDay: 31, amountCents: 100 }],
      new Date("2026-02-01T12:00:00Z"),
    );
    expect(bills[0].dueOn).toBe("2026-02-28");
  });

  it("respects the window", () => {
    expect(upcomingBills(obligations, today, 2).map((bill) => bill.obligation.name)).toEqual([
      "Card",
    ]);
  });
});

describe("monthlyObligationTotalCents", () => {
  it("adds up what repeats, ignoring closed rows", () => {
    expect(
      monthlyObligationTotalCents([
        { id: "1", name: "A", dueDay: 1, amountCents: 1000 },
        { id: "2", name: "B", dueDay: 2, amountCents: 2000 },
        { id: "3", name: "C", dueDay: 3, amountCents: 9999, status: "closed" },
      ]),
    ).toBe(3000);
  });
});

describe("reconcile", () => {
  it("agrees with a ledger that adds up", () => {
    const result = reconcile(
      [
        { postedOn: "2026-09-01", kind: "deposit", amountCents: 100_000, balanceAfterCents: 200_000 },
        { postedOn: "2026-09-02", kind: "debit", amountCents: -50_000, balanceAfterCents: 150_000 },
      ],
      100_000,
    );
    expect(result.breaks).toEqual([]);
    expect(result.checkedCount).toBe(2);
    expect(result.endingComputedCents).toBe(150_000);
  });

  it("reports one break, not every row after it", () => {
    /*
     * The spreadsheet this replaces has thirty-eight discontinuities in eight
     * thousand rows, from twenty years of hand edits. Resuming from the stated
     * balance after each is what keeps that thirty-eight rather than
     * seven thousand.
     */
    const result = reconcile(
      [
        { postedOn: "2026-09-01", kind: "deposit", amountCents: 100_000, balanceAfterCents: 200_000 },
        { postedOn: "2026-09-02", kind: "debit", amountCents: -50_000, balanceAfterCents: 999_999 },
        { postedOn: "2026-09-03", kind: "debit", amountCents: -1_000, balanceAfterCents: 998_999 },
      ],
      100_000,
    );
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0]).toMatchObject({
      index: 1,
      statedCents: 999_999,
      computedCents: 150_000,
      deltaCents: 849_999,
    });
  });

  it("skips rows that carried no stated balance", () => {
    const result = reconcile(
      [
        { postedOn: "2026-09-01", kind: "deposit", amountCents: 100_000, balanceAfterCents: null },
        { postedOn: "2026-09-02", kind: "debit", amountCents: -50_000, balanceAfterCents: 150_000 },
      ],
      100_000,
    );
    expect(result.checkedCount).toBe(1);
    expect(result.breaks).toEqual([]);
  });
});
