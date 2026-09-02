import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesProfitabilityPanel } from "@/components/services/profitability-panel";

/**
 * The page prints every input beside a margin, explains an unknown one in
 * words, and saves a cost in cents from a dollar field — blank meaning
 * unknown, never zero.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });
}

const group = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
  key, name, visits: 1, known: 1, unknown: 0, revenueCents: 48600, labourCostCents: 5000,
  chemicalCostCents: 300, marginCents: 43300, marginBps: 8909, ...extra,
});

const board = {
  window: { days: 90, visitCeiling: 5000, truncated: false },
  totals: group("all", "All visits", { visits: 2, known: 1, unknown: 1 }),
  byTechnician: [group("t1", "Ada")],
  byService: [group("Monthly IPM", "Monthly IPM")],
  byBranch: [group("b1", "Harbor depot (HRB)")],
  unknowns: { visitsWithoutInvoice: 1, visitsWithoutRate: 0, visitsOnWindowBasis: 1, uncostedApplications: 0 },
  visits: [
    {
      workOrderId: "w2", accountId: "a", accountName: "Maple Street Homes", serviceType: "Quarterly perimeter",
      completedAt: "2026-08-22T10:00:00Z", technicianId: "t1", technicianName: "Ada", branchId: "b1",
      revenueCents: null, invoiceCount: 0, labourMinutes: 120, labourBasis: "window", hourlyCostCents: 4000,
      labourCostCents: 8000, chemicalCostCents: 0, applications: 0, uncostedApplications: 0, marginCents: null, marginBps: null,
    },
    {
      workOrderId: "w1", accountId: "a", accountName: "Harborview Foods", serviceType: "Monthly IPM",
      completedAt: "2026-08-20T10:00:00Z", technicianId: "t1", technicianName: "Ada", branchId: "b1",
      revenueCents: 48600, invoiceCount: 1, labourMinutes: 75, labourBasis: "timesheet", hourlyCostCents: 4000,
      labourCostCents: 5000, chemicalCostCents: 300, applications: 1, uncostedApplications: 0, marginCents: 43300, marginBps: 8909,
    },
  ],
  costs: {
    technicians: [{ id: "t1", name: "Ada", active: true, hourlyCostCents: 4000 }, { id: "t2", name: "Bram", active: true, hourlyCostCents: null }],
    lots: [{ id: "l1", lotNumber: "DEMO-LOT-001-01", unit: "oz", unitCostCents: 150, receivedOn: "2026-08-01", quantityRemaining: 8 }],
  },
};

function mockFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "PATCH") return jsonResponse({ technician: {} });
    return jsonResponse(board);
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ServicesProfitabilityPanel", () => {
  it("prints every input beside the margin and explains the unknown one", async () => {
    mockFetch();
    render(<ServicesProfitabilityPanel />);
    const visits = await screen.findByTestId("profitability-visits");
    expect(within(visits).getByText("$433.00 (89.1%)")).toBeInTheDocument();
    expect(within(visits).getByText(/revenue \$486\.00 − labour \$50\.00 \(75 min at \$40\.00\/h, timesheet\) − chemicals \$3\.00 \(1 application\)/)).toBeInTheDocument();
    expect(within(visits).getByText(/Unknown because no invoice is linked to this visit\./)).toBeInTheDocument();
    expect(screen.getByTestId("profitability-unknowns")).toHaveTextContent("1 visit with no invoice linked");
    expect(within(screen.getByTestId("profitability-by-technician")).getByText("Ada")).toBeInTheDocument();
  });

  it("saves a technician's hourly cost in cents, and a blank as unknown", async () => {
    const calls = mockFetch();
    render(<ServicesProfitabilityPanel />);
    await screen.findByTestId("cost-technicians");

    const bram = screen.getByLabelText("Hourly cost for Bram");
    await userEvent.clear(bram);
    await userEvent.type(bram, "32.50");
    await userEvent.click(within(bram.closest("li")!).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = calls.find((call) => call.init?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch!.init!.body))).toEqual({ technicianId: "t2", hourlyCostCents: 3250 });
    });

    const ada = screen.getByLabelText("Hourly cost for Ada");
    await userEvent.clear(ada);
    await userEvent.click(within(ada.closest("li")!).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patches = calls.filter((call) => call.init?.method === "PATCH");
      expect(JSON.parse(String(patches.at(-1)!.init!.body))).toEqual({ technicianId: "t1", hourlyCostCents: null });
    });
  });

  it("saves a lot's unit cost and re-reads on a wider window", async () => {
    const calls = mockFetch();
    render(<ServicesProfitabilityPanel />);
    await screen.findByTestId("cost-lots");
    const lot = screen.getByLabelText("Unit cost for lot DEMO-LOT-001-01");
    await userEvent.clear(lot);
    await userEvent.type(lot, "1.75");
    await userEvent.click(within(lot.closest("li")!).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = calls.find((call) => call.init?.method === "PATCH");
      expect(JSON.parse(String(patch!.init!.body))).toEqual({ lotId: "l1", unitCostCents: 175 });
    });
    await userEvent.selectOptions(screen.getByLabelText("Window in days"), "365");
    await waitFor(() => {
      expect(calls.some((call) => call.url === "/api/services/profitability?days=365")).toBe(true);
    });
  });
});
