import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetTransactionsPanel } from "@/components/budget/transactions-panel";

/**
 * The ledger stops being append-only through the UI.
 *
 * The honesty rules under the new controls: an edit never touches the
 * statement's stated balance (reconciliation is where a disagreement
 * shows up), a delete asks first because it cannot be undone, and the
 * reconciliation card reports the statement's own arithmetic instead of
 * papering over it.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const accounts = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Everyday checking",
    institution: null,
    kind: "checking",
    last4: null,
    currentBalanceCents: 100_000,
    creditLimitCents: null,
    aprBps: null,
    promoAprEndsOn: null,
    isActive: true,
  },
];

const listing = {
  transactions: [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      accountId: accounts[0].id,
      categoryId: null,
      postedOn: "2026-08-01",
      kind: "debit",
      description: "Groceries run",
      amountCents: -4250,
      balanceAfterCents: 95_750,
      createdAt: "2026-08-01T12:00:00Z",
    },
  ],
  total: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ledger editing", () => {
  it("saves a description and amount through PATCH, never the stated balance", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(jsonResponse(listing)));
    render(<BudgetTransactionsPanel accounts={accounts} />);
    await screen.findByText("Groceries run");

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Edit description"));
    await userEvent.type(screen.getByLabelText("Edit description"), "Groceries and pharmacy");
    fetchMock.mockResolvedValueOnce(jsonResponse({ transaction: {} }));
    fetchMock.mockResolvedValueOnce(jsonResponse(listing));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch?.[1]?.body));
      expect(body.description).toBe("Groceries and pharmacy");
      expect(body.amountCents).toBe(-4250);
      expect(body).not.toHaveProperty("balanceAfterCents");
    });
  });

  it("asks before deleting, and does nothing when refused", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(jsonResponse(listing)));
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BudgetTransactionsPanel accounts={accounts} />);
    await screen.findByText("Groceries run");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("shows the statement's breaks instead of papering over them", async () => {
    // Route-aware rather than queued: the panel refetches its listing on
    // its own schedule, and a queued payload landing on the wrong request
    // is a test bug, not a panel bug.
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/budget/reconcile")) {
        return Promise.resolve(
          jsonResponse({
            checkedCount: 120,
            totalBreaks: 2,
            breaks: [
              {
                postedOn: "2026-05-04",
                description: "Hand edit",
                computedCents: 90_000,
                statedCents: 91_000,
                deltaCents: 1_000,
              },
              {
                postedOn: "2026-06-11",
                description: "",
                computedCents: 70_000,
                statedCents: 69_500,
                deltaCents: -500,
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(listing));
    });
    render(<BudgetTransactionsPanel accounts={accounts} />);
    await screen.findByText("Groceries run");

    await userEvent.selectOptions(screen.getByRole("combobox"), accounts[0].id);
    const card = await screen.findByTestId("budget-reconciliation");
    expect(card).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Check this account" }));
    expect(await screen.findByText(/2 breaks across 120 stated balances/)).toBeInTheDocument();
    expect(screen.getByText(/Hand edit/)).toBeInTheDocument();
    expect(screen.getByText(/\(no description\)/)).toBeInTheDocument();
  });
});
