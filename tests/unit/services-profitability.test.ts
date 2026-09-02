import { describe, expect, it } from "vitest";

import {
  summarizeProfitability,
  toVisitProfitabilityView,
  unknownReasons,
  type CrmVisitProfitabilityRow,
} from "@/lib/services/profitability";

/**
 * A group sums only the visits whose margin is KNOWN and counts the rest
 * beside them; an unknown margin is explained in words, never rendered as
 * zero.
 */

function row(overrides: Partial<CrmVisitProfitabilityRow>): CrmVisitProfitabilityRow {
  return {
    work_order_id: "w", account_id: "a", account_name: "Harborview Foods", service_type: "Monthly IPM",
    completed_at: "2026-08-20T10:00:00Z", technician_id: "t1", technician_name: "Ada", branch_id: "b1",
    revenue_cents: 48600, invoice_count: 1, labour_minutes: 75, labour_basis: "timesheet",
    hourly_cost_cents: 4000, labour_cost_cents: 5000, chemical_cost_cents: 300, applications: 1,
    uncosted_applications: 0, margin_cents: 43300, margin_bps: 8909,
    ...overrides,
  };
}

describe("summarizeProfitability", () => {
  it("sums known margins per group and counts the unknown ones beside them", () => {
    const visits = [
      row({ work_order_id: "w1" }),
      row({ work_order_id: "w2", revenue_cents: 20000, labour_cost_cents: 4000, chemical_cost_cents: 0, margin_cents: 16000, margin_bps: 8000 }),
      row({ work_order_id: "w3", technician_id: "t2", technician_name: "Bram", hourly_cost_cents: null, labour_cost_cents: null, margin_cents: null, margin_bps: null }),
      row({ work_order_id: "w4", technician_id: "t2", technician_name: "Bram", revenue_cents: null, invoice_count: 0, margin_cents: null, margin_bps: null, labour_basis: "window" }),
    ].map(toVisitProfitabilityView);
    const summary = summarizeProfitability(visits);

    expect(summary.totals).toMatchObject({ visits: 4, known: 2, unknown: 2, revenueCents: 68600, marginCents: 59300 });
    expect(summary.totals.marginBps).toBe(Math.round((59300 * 10000) / 68600));
    const ada = summary.byTechnician.find((group) => group.key === "t1");
    const bram = summary.byTechnician.find((group) => group.key === "t2");
    expect(ada).toMatchObject({ visits: 2, known: 2, marginCents: 59300 });
    expect(bram).toMatchObject({ visits: 2, known: 0, unknown: 2, marginCents: 0, marginBps: null });
    expect(summary.unknowns).toEqual({
      visitsWithoutInvoice: 1, visitsWithoutRate: 1, visitsOnWindowBasis: 1, uncostedApplications: 0,
    });
  });

  it("orders groups worst margin first", () => {
    const visits = [
      row({ work_order_id: "w1", service_type: "Good", margin_cents: 5000 }),
      row({ work_order_id: "w2", service_type: "Bad", revenue_cents: 1000, labour_cost_cents: 5000, margin_cents: -4300, margin_bps: -43000 }),
    ].map(toVisitProfitabilityView);
    expect(summarizeProfitability(visits).byService.map((group) => group.name)).toEqual(["Bad", "Good"]);
  });
});

describe("unknownReasons", () => {
  it("names every reason a margin is unknown", () => {
    const visit = toVisitProfitabilityView(row({
      revenue_cents: null, hourly_cost_cents: null, labour_cost_cents: null, uncosted_applications: 2, margin_cents: null,
    }));
    expect(unknownReasons(visit)).toEqual([
      "no invoice is linked to this visit",
      "the technician has no hourly cost on file",
      "2 applications with no lot cost or a unit that does not match the lot",
    ]);
    expect(unknownReasons(toVisitProfitabilityView(row({})))).toEqual([]);
    expect(unknownReasons(toVisitProfitabilityView(row({ technician_id: null, technician_name: null, hourly_cost_cents: null, labour_cost_cents: null }))))
      .toEqual(["no technician is recorded"]);
  });
});
