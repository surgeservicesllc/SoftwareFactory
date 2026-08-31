// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET as dashboards } from "@/app/api/services/dashboards/route";

/**
 * The dashboards boundary.
 *
 * The behavior suite proves the SQL is honest. This file pins what the
 * ROUTE must not undo: a null rate must survive the trip to JSON as a
 * null, the window a caller asks for must be bounded before it becomes a
 * scan, overdue must exclude what is not yet due, and route optimization
 * must stay labelled Not Connected rather than quietly reading as
 * available.
 */

const organizationId = "10000000-0000-4000-8000-0000000d0001";
const userId = "00000000-0000-4000-8000-0000000d0001";
const technicianId = "20000000-0000-4000-8000-0000000d0001";

let rpc: ReturnType<typeof vi.fn>;

function client(responses: Record<string, { data: unknown; error: unknown }>) {
  rpc = vi.fn((name: string) => Promise.resolve(responses[name] ?? { data: [], error: null }));
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { rpc },
  });
}

function ask(url = "https://factory.example/api/services/dashboards") {
  return new Request(url);
}

const emptyBook = {
  crm_revenue_by_month: { data: [], error: null },
  crm_receivable_aging: { data: [], error: null },
  crm_retention_summary: { data: [], error: null },
  crm_technician_productivity: { data: [], error: null },
  crm_route_density: { data: [], error: null },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the dashboards route", () => {
  it("passes a null rate through as null, never as zero", async () => {
    client({
      ...emptyBook,
      crm_revenue_by_month: {
        data: [
          {
            month: "2026-07-01",
            invoiced_cents: "0",
            collected_cents: "0",
            refunded_cents: "0",
            invoice_count: 0,
            collection_rate_bps: null,
          },
          {
            month: "2026-08-01",
            invoiced_cents: "100000",
            collected_cents: "80000",
            refunded_cents: "30000",
            invoice_count: 1,
            collection_rate_bps: 5000,
          },
        ],
        error: null,
      },
      crm_retention_summary: {
        data: [
          {
            customers: 0,
            inactive: 0,
            prospects: 3,
            customers_without_plan: 0,
            contracts_active: 0,
            contracts_ended: 0,
            retention_bps: null,
          },
        ],
        error: null,
      },
    });

    const body = (await (await dashboards(ask())).json()) as {
      revenue: { months: { collectionRateBps: number | null; netCents: number }[] };
      retention: { retentionBps: number | null } | null;
    };
    // A month nobody was billed in has no rate. Rendering 0 there would
    // say the opposite of what happened.
    expect(body.revenue.months[0].collectionRateBps).toBeNull();
    expect(body.revenue.months[1].collectionRateBps).toBe(5000);
    // Collected less refunded: what actually stayed.
    expect(body.revenue.months[1].netCents).toBe(50_000);
    expect(body.retention?.retentionBps).toBeNull();
  });

  it("keeps what is not yet due, and what has no due date, out of overdue", async () => {
    client({
      ...emptyBook,
      crm_receivable_aging: {
        data: [
          { bucket: "current", invoice_count: 2, balance_cents: "40000" },
          { bucket: "1-30", invoice_count: 1, balance_cents: "10000" },
          { bucket: "31-60", invoice_count: 0, balance_cents: "0" },
          { bucket: "61-90", invoice_count: 0, balance_cents: "0" },
          { bucket: "90+", invoice_count: 1, balance_cents: "45000" },
          { bucket: "undated", invoice_count: 1, balance_cents: "7000" },
        ],
        error: null,
      },
    });

    const body = (await (await dashboards(ask())).json()) as {
      receivable: { outstandingCents: number; overdueCents: number; undatedCents: number };
    };
    expect(body.receivable.outstandingCents).toBe(102_000);
    // Only 1-30 and 90+ are actually late.
    expect(body.receivable.overdueCents).toBe(55_000);
    expect(body.receivable.undatedCents).toBe(7_000);
  });

  it("bounds the windows a caller asks for", async () => {
    client(emptyBook);
    await dashboards(
      ask("https://factory.example/api/services/dashboards?months=9999&productivityDays=0&routeDays=abc"),
    );
    expect(rpc).toHaveBeenCalledWith("crm_revenue_by_month", { p_months: 36 });
    // Zero and nonsense fall back rather than becoming an unbounded scan
    // or an empty one.
    expect(rpc).toHaveBeenCalledWith("crm_technician_productivity", { p_days: 90 });
    expect(rpc).toHaveBeenCalledWith("crm_route_density", { p_days: 14 });
  });

  it("counts idle technicians and running shifts rather than hiding them", async () => {
    client({
      ...emptyBook,
      crm_technician_productivity: {
        data: [
          {
            technician_id: technicianId,
            first_name: "Dana",
            last_name: "Okafor",
            branch_id: null,
            active: true,
            scheduled: 3,
            completed: 1,
            cancelled: 1,
            completion_rate_bps: 3333,
            worked_minutes: "450",
            running_shifts: 1,
          },
          {
            technician_id: "20000000-0000-4000-8000-0000000d0002",
            first_name: "Sam",
            last_name: "Trevino",
            branch_id: null,
            active: true,
            scheduled: 0,
            completed: 0,
            cancelled: 0,
            completion_rate_bps: null,
            worked_minutes: null,
            running_shifts: 0,
          },
        ],
        error: null,
      },
    });

    const body = (await (await dashboards(ask())).json()) as {
      productivity: {
        technicians: { name: string; workedMinutes: number | null; completionRateBps: number | null }[];
        idle: number;
        runningShifts: number;
      };
    };
    expect(body.productivity.technicians[0].name).toBe("Dana Okafor");
    expect(body.productivity.technicians[0].workedMinutes).toBe(450);
    // Nothing scheduled means no rate and no worked total — both null, and
    // the row is still present.
    expect(body.productivity.technicians[1].completionRateBps).toBeNull();
    expect(body.productivity.technicians[1].workedMinutes).toBeNull();
    expect(body.productivity.idle).toBe(1);
    expect(body.productivity.runningShifts).toBe(1);
  });

  it("keeps route optimization labelled Not Connected", async () => {
    client({
      ...emptyBook,
      crm_route_density: {
        data: [
          {
            day: "2026-08-31",
            technician_id: technicianId,
            branch_id: null,
            stops: 1,
            first_start: "2026-08-31T15:00:00.000Z",
            last_end: "2026-08-31T16:00:00.000Z",
            span_minutes: 60,
            booked_minutes: 60,
            idle_minutes: null,
            accounts: 1,
          },
        ],
        error: null,
      },
    });

    const body = (await (await dashboards(ask())).json()) as {
      routes: { days: { idleMinutes: number | null }[]; optimization: { available: boolean; label: string } };
    };
    // No mapping provider is configured, so nothing may read as available.
    expect(body.routes.optimization).toEqual({ available: false, label: "Not Connected" });
    // A single stop has no gaps to measure, so idle is unknown rather than
    // zero — a zero there would read as a full day.
    expect(body.routes.days[0].idleMinutes).toBeNull();
  });

  it("never asks the database for a page of rows to tally in JavaScript", async () => {
    client(emptyBook);
    await dashboards(ask());
    // Five aggregate calls and no table reads: a dashboard built on a
    // truncated fetch is right only while the book is small.
    expect(rpc.mock.calls.map((call) => call[0]).sort()).toEqual([
      "crm_receivable_aging",
      "crm_retention_summary",
      "crm_revenue_by_month",
      "crm_route_density",
      "crm_technician_productivity",
    ]);
  });

  it("reports a database refusal as a database refusal", async () => {
    client({ ...emptyBook, crm_revenue_by_month: { data: null, error: { code: "42501", message: "denied" } } });
    const response = await dashboards(ask());
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("answers an empty book with an empty page rather than a crash", async () => {
    client(emptyBook);
    const response = await dashboards(ask());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { retention: unknown; revenue: { totals: { invoicedCents: number } } };
    // No retention row at all reads as null, not as a zeroed one.
    expect(body.retention).toBeNull();
    expect(body.revenue.totals.invoicedCents).toBe(0);
  });
});
