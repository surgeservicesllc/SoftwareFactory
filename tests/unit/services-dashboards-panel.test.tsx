import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesDashboardsPanel } from "@/components/services/dashboards-panel";

/**
 * Every dashboard figure opens: a tile, a month, a bucket, a technician or
 * a day fetches the rows behind it with the figure's own key, and the
 * list renders under the figures with its ceiling stated when reached.
 */

const technicianId = "70000000-0000-4000-8000-0000000d0001";

const dashboards = {
  organizationId: "org-1",
  windows: { months: 12, productivityDays: 90, routeDays: 14, forecastMonths: 12 },
  revenue: {
    months: [{ month: "2026-08-01", invoicedCents: 100000, collectedCents: 80000, refundedCents: 0, netCents: 80000, invoiceCount: 3, collectionRateBps: 8000 }],
    totals: { invoicedCents: 100000, collectedCents: 80000, refundedCents: 0 },
  },
  receivable: {
    buckets: [
      { bucket: "current", invoiceCount: 1, balanceCents: 5000, overdue: false },
      { bucket: "31-60", invoiceCount: 2, balanceCents: 9000, overdue: true },
    ],
    outstandingCents: 14000,
    overdueCents: 9000,
    undatedCents: 0,
  },
  retention: { customers: 10, inactive: 2, prospects: 1, customersWithoutPlan: 3, contractsActive: 4, contractsEnded: 1, retentionBps: 8333 },
  productivity: {
    technicians: [{ technicianId, firstName: "Rosa", lastName: "Vega", name: "Rosa Vega", branchId: null, active: true, scheduled: 12, completed: 10, cancelled: 1, completionRateBps: 8333, workedMinutes: 2400, runningShifts: 0 }],
    idle: 0,
    runningShifts: 0,
  },
  forecast: { months: [], basis: null, assumptions: { churnApplied: false, growthApplied: false, basis: "plans and contracts" } },
  routes: {
    days: [{ day: "2026-08-20", technicianId, branchId: null, stops: 4, firstStart: null, lastEnd: null, spanMinutes: 480, bookedMinutes: 300, idleMinutes: 180, accounts: 4 }],
    optimization: { available: false, label: "Not Connected" },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function serve(rowsBody: unknown) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("/api/services/dashboards/rows")) return Promise.resolve(json(rowsBody));
    return Promise.resolve(json(dashboards));
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the dashboards drill-down", () => {
  it("opens the rows behind a tile with the figure's key, and renders them", async () => {
    const calls = serve({
      figure: "overdue", key: null, window: { days: 90 },
      rows: [{ rowKind: "invoice", rowId: "i1", accountId: "a", accountName: "Harborview Foods", label: "INV-H-2", occurredOn: "2026-07-01", amountCents: 9000, status: "open" }],
      ceiling: { rows: 500, reached: false },
    });
    const user = userEvent.setup();
    render(<ServicesDashboardsPanel />);
    await screen.findByTestId("services-dashboard-figures");
    await user.click(screen.getByRole("button", { name: "Open the rows behind Overdue" }));
    const card = await screen.findByTestId("services-dashboard-rows");
    expect(calls.filter((url) => url.startsWith("/api/services/dashboards/rows"))).toEqual(["/api/services/dashboards/rows?figure=overdue"]);
    expect(within(card).getByText("Behind overdue invoices")).toBeInTheDocument();
    await waitFor(() => expect(within(card).getByText("INV-H-2")).toBeInTheDocument());
    expect(within(card).getByText("Harborview Foods")).toBeInTheDocument();
    expect(within(card).getByText("$90")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("services-dashboard-rows")).toBeNull();
  });

  it("keys a bucket, a technician and a day the way the database expects, and states the ceiling", async () => {
    const calls = serve({
      figure: "aging", key: "31-60", window: { days: 90 }, rows: [], ceiling: { rows: 500, reached: true },
    });
    const user = userEvent.setup();
    render(<ServicesDashboardsPanel />);
    await screen.findByTestId("services-dashboard-figures");

    await user.click(screen.getByRole("tab", { name: /Receivable/ }));
    await user.click(screen.getByRole("button", { name: "31–60 days" }));
    await user.click(screen.getByRole("tab", { name: /Technicians/ }));
    await user.click(screen.getByRole("button", { name: "Rosa Vega" }));
    await user.click(screen.getByRole("tab", { name: /Route density/ }));
    await user.click(screen.getByRole("button", { name: "2026-08-20" }));
    await user.click(screen.getByRole("tab", { name: /Revenue/ }));
    await user.click(screen.getByRole("button", { name: "2026-08" }));

    expect(calls.filter((url) => url.startsWith("/api/services/dashboards/rows")).map((url) => decodeURIComponent(url))).toEqual([
      "/api/services/dashboards/rows?figure=aging&key=31-60",
      `/api/services/dashboards/rows?figure=technician&key=${technicianId}&days=90`,
      `/api/services/dashboards/rows?figure=route_day&key=2026-08-20|${technicianId}`,
      "/api/services/dashboards/rows?figure=invoiced_month&key=2026-08-01",
    ]);
    const card = await screen.findByTestId("services-dashboard-rows");
    await waitFor(() => expect(within(card).getByText("Nothing is behind this figure right now.")).toBeInTheDocument());
  });
});
