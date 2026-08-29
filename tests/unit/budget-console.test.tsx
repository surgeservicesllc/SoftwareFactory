import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetTrackerConsole } from "@/components/budget/console";

/**
 * The Budget Tracker console.
 *
 * The cases that matter here are the ones about not lying: the page keeps its
 * heading in every state including the failed one, an unrecorded credit limit
 * does not render as 0% used, and the page says plainly that nothing refreshes
 * on its own because there is no bank connection.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const overview = {
  accounts: [
    {
      id: "account-1",
      name: "Everyday checking",
      institution: "Community Bank",
      kind: "checking",
      last4: "1234",
      currentBalanceCents: 1_000_000,
      creditLimitCents: null,
      aprBps: null,
      promoAprEndsOn: null,
      isActive: true,
    },
    {
      id: "account-2",
      name: "Everyday card",
      institution: null,
      kind: "credit_card",
      last4: "4321",
      currentBalanceCents: -320_000,
      creditLimitCents: 500_000,
      aprBps: 1999,
      promoAprEndsOn: null,
      isActive: true,
    },
  ],
  obligations: [
    {
      id: "obligation-1",
      accountId: "account-2",
      name: "Card payment",
      dueDay: 5,
      amountCents: 8_500,
      balanceCents: 320_000,
      creditLimitCents: 500_000,
      aprBps: 1999,
      status: "repeats_monthly",
      paidFrom: "Checking",
      ownerLabel: null,
      payoffRank: 3,
      autopay: false,
    },
  ],
  flows: [
    {
      month: "2026-08",
      incomeCents: 512_300,
      expenseCents: 123_456,
      netCents: 413_942,
      transactionCount: 2,
    },
  ],
  recent: [
    {
      id: "transaction-1",
      accountId: "account-1",
      categoryId: null,
      postedOn: "2026-08-04",
      kind: "deposit",
      description: "PAYROLL",
      amountCents: 512_300,
    },
  ],
  imports: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BudgetTrackerConsole", () => {
  it("keeps the page heading while loading, so the outline never disappears", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<BudgetTrackerConsole />);
    expect(screen.getByRole("heading", { level: 1, name: "Budget Tracker" })).toBeInTheDocument();
  });

  it("keeps the page heading when the load fails", async () => {
    // A blocked state that replaces the whole page removes its h1 along with
    // everything else, exactly when a person most needs to know where they are.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    render(<BudgetTrackerConsole />);
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { level: 1, name: "Budget Tracker" })).toBeInTheDocument();
  });

  it("names workspace onboarding as a next step rather than a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "organization_onboarding_required" } }, 409),
      ),
    );
    render(<BudgetTrackerConsole />);
    expect(await screen.findByText(/do not have one yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the derived figures once the overview loads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(overview)));
    render(<BudgetTrackerConsole />);

    // Assets 10,000.00 less liabilities 3,200.00 is 6,800.00.
    expect(await screen.findByText("$6,800")).toBeInTheDocument();
    expect(screen.getByText("$10,000 held, $3,200 owed")).toBeInTheDocument();
  });

  it("states that nothing refreshes on its own", async () => {
    // There is no bank connection, and the page must not imply one.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(overview)));
    render(<BudgetTrackerConsole />);
    expect(
      await screen.findByText(/no bank connection, so nothing\s+refreshes on its own/i),
    ).toBeInTheDocument();
  });

  it("reports credit used against the recorded limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(overview)));
    render(<BudgetTrackerConsole />);
    // 3,200.00 of a 5,000.00 limit.
    expect(await screen.findByText("64% of limit used")).toBeInTheDocument();
  });

  it("says no limit is recorded rather than drawing an empty bar", async () => {
    // An empty bar reads as 0% used, which is the opposite of unknown.
    const withoutLimit = {
      ...overview,
      accounts: [{ ...overview.accounts[1], creditLimitCents: null }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(withoutLimit)));
    render(<BudgetTrackerConsole />);
    expect(await screen.findByText("No credit limit recorded")).toBeInTheDocument();
    expect(screen.queryByText(/% of limit used/)).not.toBeInTheDocument();
  });

  it("offers both payoff orders and switches between them", async () => {
    /*
     * The two debts are deliberately arranged so the strategies disagree: the
     * larger balance carries the higher rate. Data where both orders agree
     * would let this test pass with the switch doing nothing at all.
     */
    const twoDebts = {
      ...overview,
      obligations: [
        { ...overview.obligations[0], id: "big", name: "Big card", balanceCents: 320_000, aprBps: 2500 },
        { ...overview.obligations[0], id: "small", name: "Small loan", balanceCents: 62_500, aprBps: 1000 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(twoDebts)));
    render(<BudgetTrackerConsole />);

    const firstRanked = () =>
      screen
        .getAllByRole("row")
        .map((row) => row.textContent ?? "")
        .filter((text) => /Big card|Small loan/.test(text))[0] ?? "";

    await screen.findByText("Payoff order");
    // Highest rate first by default: the big card, at 25%.
    expect(firstRanked()).toContain("Big card");

    await userEvent.click(screen.getByRole("button", { name: "Smallest balance" }));
    await waitFor(() => expect(firstRanked()).toContain("Small loan"));
  });

  it("switches sections without losing the heading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(overview)));
    render(<BudgetTrackerConsole />);
    await screen.findByText("Cash flow");

    await userEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(await screen.findByText("Add an account")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Budget Tracker" })).toBeInTheDocument();
  });

  it("tells someone with no accounts what to do first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ accounts: [], obligations: [], flows: [], recent: [], imports: [] }),
      ),
    );
    render(<BudgetTrackerConsole />);
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
  });
});
