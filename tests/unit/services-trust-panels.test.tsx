import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesDashboardsPanel } from "@/components/services/dashboards-panel";
import { ServicesDataPanel } from "@/components/services/data-panel";

/**
 * The trust surfaces: the forecast tab's scenario card applies what is
 * saved, tries a what-if without saving it, and saves the owner's numbers
 * in basis points with their provenance; the data page's hygiene card
 * states the reasons and lists each flagged contact without a broom.
 */

const dashboards = {
  organizationId: "org-1",
  windows: { months: 12, productivityDays: 90, routeDays: 14, forecastMonths: 12 },
  revenue: { months: [], totals: { invoicedCents: 0, collectedCents: 0, refundedCents: 0 } },
  receivable: { buckets: [], outstandingCents: 0, overdueCents: 0, undatedCents: 0 },
  retention: null,
  productivity: { technicians: [], idle: 0, runningShifts: 0 },
  forecast: { months: [], basis: null, assumptions: { churnApplied: false, growthApplied: false, basis: "plans and contracts" } },
  routes: { days: [], optimization: { available: false, label: "Not Connected" } },
};

function scenarioPayload(source: "stored" | "query" | "none", churnBps: number, growthBps: number) {
  return {
    window: { months: 12 },
    assumptions: source === "stored" ? { id: "f1", annualChurnBps: churnBps, annualGrowthBps: growthBps, note: "Two years of cancellations.", updatedBy: "u", updatedAt: "2026-04-01T00:00:00Z" } : null,
    applied: { churnBps, growthBps, source },
    months: [
      { month: "2026-09-01", monthsAhead: 0, recordedCents: 10000, scenarioCents: 10000, factorBps: 10000, plans: 1, contracts: 0 },
      { month: "2026-10-01", monthsAhead: 1, recordedCents: 10000, scenarioCents: 9894, factorBps: 9894, plans: 1, contracts: 0 },
    ],
    totals: { recordedCents: 20000, scenarioCents: 19894, differenceCents: -106 },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the scenario card", () => {
  it("applies the saved assumptions, tries a what-if without saving, and saves in basis points with provenance", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === "PUT") return Promise.resolve(json({ assumptions: scenarioPayload("stored", 1500, 200).assumptions }));
      if (url.startsWith("/api/services/forecast/scenario?")) return Promise.resolve(json(scenarioPayload("query", 2000, 0)));
      if (url.startsWith("/api/services/forecast/scenario")) return Promise.resolve(json(scenarioPayload("stored", 1200, 300)));
      return Promise.resolve(json(dashboards));
    }));
    const user = userEvent.setup();
    render(<ServicesDashboardsPanel />);
    await user.click(await screen.findByRole("tab", { name: /Forecast/ }));
    const card = await screen.findByTestId("services-forecast-scenario-card");
    await waitFor(() => expect(screen.getByTestId("services-forecast-scenario-applied")).toHaveTextContent("Applying 12.0% annual churn and 3.0% annual growth."));
    expect(screen.getByTestId("services-forecast-scenario-applied")).toHaveTextContent("recorded $200, scenario $199 (−$1)");
    const table = within(card).getByTestId("services-forecast-scenario-table");
    expect(within(table).getByText("×0.9894")).toBeInTheDocument();
    expect(screen.getByLabelText("Annual churn percent")).toHaveValue(12);
    expect(screen.getByLabelText("Where the numbers came from")).toHaveValue("Two years of cancellations.");

    const churn = screen.getByLabelText("Annual churn percent");
    await user.clear(churn);
    await user.type(churn, "20");
    await user.click(within(card).getByRole("button", { name: "Try it" }));
    await waitFor(() => expect(screen.getByTestId("services-forecast-scenario-applied")).toHaveTextContent("Trying 20.0% annual churn and 0.0% annual growth (not saved)."));
    expect(calls.some((call) => call.url === "/api/services/forecast/scenario?churnBps=2000&growthBps=300")).toBe(true);
    expect(calls.some((call) => call.init?.method === "PUT")).toBe(false);

    await user.clear(churn);
    await user.type(churn, "15");
    const growth = screen.getByLabelText("Annual growth percent");
    await user.clear(growth);
    await user.type(growth, "2");
    await user.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = calls.find((call) => call.init?.method === "PUT");
      expect(put).toBeDefined();
      expect(JSON.parse(String(put!.init!.body))).toEqual({ annualChurnBps: 1500, annualGrowthBps: 200, note: "Two years of cancellations." });
    });
  });
});

describe("the hygiene card", () => {
  it("states the reasons and lists each flagged contact, or says the book is clean", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/services/data/hygiene")) {
        return Promise.resolve(json({
          contacts: [
            { contactId: "c1", accountId: "a1", accountName: "Old Mill", accountStatus: "inactive", contactName: "Sam Ortiz", email: "dup@harborview.example", phone: null, isPrimary: true, lastTouchAt: null, daysSinceTouch: null, flags: ["duplicate_email", "inactive_account"], labels: ["Same email on another contact", "Account is inactive"], flagCount: 2 },
            { contactId: "c2", accountId: "a2", accountName: "Harborview Foods", accountStatus: "customer", contactName: "Pat Quinn", email: null, phone: null, isPrimary: false, lastTouchAt: "2026-04-01T00:00:00Z", daysSinceTouch: 3, flags: ["unreachable"], labels: ["No email and no phone"], flagCount: 1 },
          ],
          summary: { contacts: 2, multiFlagged: 1, byFlag: [{ flag: "unreachable", label: "No email and no phone", count: 1 }, { flag: "duplicate_email", label: "Same email on another contact", count: 1 }, { flag: "inactive_account", label: "Account is inactive", count: 1 }] },
          ceiling: { contacts: 1000, reached: false },
        }));
      }
      return Promise.resolve(json({ tables: [], totalRows: 0 }));
    }));
    render(<ServicesDataPanel />);
    const card = await screen.findByTestId("services-hygiene");
    await waitFor(() => expect(screen.getByTestId("services-hygiene-summary")).toHaveTextContent("2 contacts flagged, 1 for more than one reason: 1 no email and no phone · 1 same email on another contact · 1 account is inactive"));
    const list = within(card).getByTestId("services-hygiene-list");
    expect(within(list).getByText("Sam Ortiz")).toBeInTheDocument();
    expect(within(list).getByText("Same email on another contact; Account is inactive")).toBeInTheDocument();
    expect(within(list).getByText(/never touched/)).toBeInTheDocument();
    expect(within(list).getByText(/touched 3 days ago/)).toBeInTheDocument();

    cleanup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/services/data/hygiene")) return Promise.resolve(json({ contacts: [], summary: { contacts: 0, byFlag: [], multiFlagged: 0 }, ceiling: { contacts: 1000, reached: false } }));
      return Promise.resolve(json({ tables: [], totalRows: 0 }));
    }));
    render(<ServicesDataPanel />);
    await screen.findByTestId("services-hygiene-clean");
  });
});
