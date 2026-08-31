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

import { GET as readSequence, PUT as writeSequence } from "@/app/api/services/service-plans/[planId]/steps/route";
import { POST as generateVisit } from "@/app/api/services/service-plans/[planId]/generate/route";

/**
 * The sequencing boundary (ADR-211).
 *
 * The behavior suite proves the SQL puts a twice-monthly account on the
 * days it was sold. This file pins what the ROUTES must not undo: a
 * sequenced plan must advance along its own calendar rather than by an
 * interval, a step's own service must reach the work order, a plan whose
 * sequence yields nothing must be refused rather than quietly put back on
 * the old cadence, and a schedule that cannot be generated must never be
 * accepted as if it could.
 */

const organizationId = "10000000-0000-4000-8000-0000000d0001";
const userId = "00000000-0000-4000-8000-0000000d0001";
const accountId = "20000000-0000-4000-8000-0000000d0001";
const propertyId = "60000000-0000-4000-8000-0000000d0001";
const planId = "90000000-0000-4000-8000-0000000d0001";

type QueryResult = { data: unknown; error: unknown };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "order", "limit"]) {
    builder[method] = vi.fn(chain);
  }
  builder.single = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.maybeSingle = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.then = (onFulfilled: (value: QueryResult) => unknown) =>
    Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onFulfilled);
  return builder;
}

let from: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;

function client(
  tables: Record<string, QueryResult[]>,
  procedures: Record<string, QueryResult> = {},
) {
  const built = new Map<string, ReturnType<typeof stubTable>>();
  from = vi.fn((table: string) => {
    const existing = built.get(table);
    if (existing) return existing;
    const created = stubTable(tables[table] ?? [{ data: null, error: null }]);
    built.set(table, created);
    return created;
  });
  rpc = vi.fn((name: string) => Promise.resolve(procedures[name] ?? { data: [], error: null }));
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { from, rpc },
  });
}

const sequencedPlan = {
  id: planId,
  account_id: accountId,
  property_id: propertyId,
  service_type: "Seasonal program",
  recurrence: "monthly",
  next_due: "2026-03-09",
  technician_id: null,
  value_cents: 154_000,
  active: true,
  notes: null,
  cycle_months: 12,
  created_at: "2026-08-30T10:00:00Z",
  updated_at: "2026-08-30T10:00:00Z",
};

const workOrder = {
  id: "80000000-0000-4000-8000-0000000d0001",
  account_id: accountId,
  property_id: propertyId,
  technician_id: null,
  plan_id: planId,
  status: "scheduled",
  service_type: "perimeter",
  scheduled_start: "2026-03-09T09:00:00Z",
  scheduled_end: "2026-03-09T11:00:00Z",
  instructions: null,
  completion_notes: null,
  completed_at: null,
  created_at: "2026-08-30T10:00:00Z",
  updated_at: "2026-08-30T10:00:00Z",
};

function send(method: "POST" | "PUT", url: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generating a visit from a sequenced plan", () => {
  it("advances along the plan's own calendar, not by its recurrence", async () => {
    client(
      {
        crm_service_plans: [
          { data: sequencedPlan, error: null },
          { data: { ...sequencedPlan, next_due: "2026-06-08" }, error: null },
        ],
        crm_work_orders: [{ data: workOrder, error: null }],
      },
      {
        crm_plan_occurrences: {
          data: [
            { step_position: 1, occurs_on: "2026-03-09", service_type: "perimeter" },
            { step_position: 2, occurs_on: "2026-06-08", service_type: "mosquito" },
          ],
          error: null,
        },
      },
    );

    const response = await generateVisit(
      send("POST", `https://factory.example/api/services/service-plans/${planId}/generate`, {}),
      { params: Promise.resolve({ planId }) },
    );

    expect(response.status).toBe(201);
    // A monthly recurrence would have said 2026-04-09. The schedule says June.
    const plans = from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    expect(plans.update).toHaveBeenCalledWith({ next_due: "2026-06-08" });
  });

  it("puts the step's own service on the visit, not the plan's generic one", async () => {
    client(
      {
        crm_service_plans: [
          { data: sequencedPlan, error: null },
          { data: { ...sequencedPlan, next_due: "2026-06-08" }, error: null },
        ],
        crm_work_orders: [{ data: workOrder, error: null }],
      },
      {
        crm_plan_occurrences: {
          data: [
            { step_position: 1, occurs_on: "2026-03-09", service_type: "perimeter" },
            { step_position: 2, occurs_on: "2026-06-08", service_type: "mosquito" },
          ],
          error: null,
        },
      },
    );

    await generateVisit(
      send("POST", `https://factory.example/api/services/service-plans/${planId}/generate`, {}),
      { params: Promise.resolve({ planId }) },
    );

    const ordersIndex = from.mock.calls.findIndex(([table]) => table === "crm_work_orders");
    const orders = from.mock.results[ordersIndex]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(orders.insert).toHaveBeenCalledWith(expect.objectContaining({
      service_type: "perimeter",
    }));
  });

  it("refuses a sequenced plan with nothing ahead of it rather than falling back to the cadence", async () => {
    client(
      { crm_service_plans: [{ data: sequencedPlan, error: null }] },
      { crm_plan_occurrences: { data: [], error: null } },
    );

    const response = await generateVisit(
      send("POST", `https://factory.example/api/services/service-plans/${planId}/generate`, {}),
      { params: Promise.resolve({ planId }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("plan_sequence_empty");
    // And nothing was written: no advance, no visit.
    const plans = from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    expect(plans.update).not.toHaveBeenCalled();
    expect(from.mock.calls.some(([table]) => table === "crm_work_orders")).toBe(false);
  });

  it("leaves an unsequenced plan on its interval, exactly as before", async () => {
    const plain = { ...sequencedPlan, cycle_months: null, next_due: "2026-09-15", service_type: "Monthly IPM" };
    client({
      crm_service_plans: [
        { data: plain, error: null },
        { data: { ...plain, next_due: "2026-10-15" }, error: null },
      ],
      crm_work_orders: [{ data: workOrder, error: null }],
    });

    await generateVisit(
      send("POST", `https://factory.example/api/services/service-plans/${planId}/generate`, {}),
      { params: Promise.resolve({ planId }) },
    );

    expect(rpc).not.toHaveBeenCalled();
    const plans = from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    expect(plans.update).toHaveBeenCalledWith({ next_due: "2026-10-15" });
  });
});

describe("reading and writing a schedule", () => {
  it("reports the dates the database generated, beside visits and bills", async () => {
    client(
      {
        crm_service_plans: [{ data: { id: planId, cycle_months: 12 }, error: null }],
        crm_plan_steps: [{
          data: [{
            id: "a0000000-0000-4000-8000-0000000d0001",
            plan_id: planId,
            position: 1,
            month_offset: 2,
            anchor: "nth_weekday",
            day_of_month: null,
            week_of_month: 2,
            weekday: 1,
            service_type: "perimeter",
            created_at: "2026-08-30T10:00:00Z",
            updated_at: "2026-08-30T10:00:00Z",
          }],
          error: null,
        }],
      },
      {
        crm_plan_occurrences: {
          data: [{ step_position: 1, occurs_on: "2027-03-08", service_type: "perimeter" }],
          error: null,
        },
        crm_plan_cadence: {
          data: [{ sequenced: true, visits_per_year: "4.0000", bills_per_year: "12" }],
          error: null,
        },
      },
    );

    const response = await readSequence(new Request(`https://factory.example/x`), {
      params: Promise.resolve({ planId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.occurrences).toEqual([
      { stepPosition: 1, occursOn: "2027-03-08", serviceType: "perimeter" },
    ]);
    // Numeric, not the string Postgres hands back for a numeric column.
    expect(body.cadence).toEqual({ sequenced: true, visitsPerYear: 4, billsPerYear: 12 });
  });

  it("reads a plan in another book as absent, not as an empty schedule", async () => {
    client({ crm_service_plans: [{ data: null, error: null }] });

    const response = await readSequence(new Request("https://factory.example/x"), {
      params: Promise.resolve({ planId }),
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("plan_not_found");
  });

  it("refuses a step that falls outside the cycle before the database has to", async () => {
    client({});

    const response = await writeSequence(
      send("PUT", `https://factory.example/api/services/service-plans/${planId}/steps`, {
        cycleMonths: 1,
        steps: [{ position: 1, monthOffset: 3, anchor: "day_of_month", dayOfMonth: 15 }],
      }),
      { params: Promise.resolve({ planId }) },
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a step carrying two anchors", async () => {
    client({});

    const response = await writeSequence(
      send("PUT", `https://factory.example/api/services/service-plans/${planId}/steps`, {
        cycleMonths: 1,
        steps: [{
          position: 1, monthOffset: 0, anchor: "day_of_month",
          dayOfMonth: 15, weekOfMonth: 2, weekday: 1,
        }],
      }),
      { params: Promise.resolve({ planId }) },
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses steps with no cycle, which would be a plan that generates nothing", async () => {
    client({});

    const response = await writeSequence(
      send("PUT", `https://factory.example/api/services/service-plans/${planId}/steps`, {
        cycleMonths: null,
        steps: [{ position: 1, monthOffset: 0, anchor: "day_of_month", dayOfMonth: 1 }],
      }),
      { params: Promise.resolve({ planId }) },
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("re-reads after writing rather than echoing what it was sent", async () => {
    client(
      {
        crm_service_plans: [{ data: { id: planId, cycle_months: 1 }, error: null }],
        crm_plan_steps: [{ data: [], error: null }],
      },
      {
        crm_plan_set_sequence: { data: 2, error: null },
        crm_plan_occurrences: {
          data: [{ step_position: 1, occurs_on: "2026-09-01", service_type: "General pest" }],
          error: null,
        },
        crm_plan_cadence: {
          data: [{ sequenced: true, visits_per_year: "24", bills_per_year: "12" }],
          error: null,
        },
      },
    );

    const response = await writeSequence(
      send("PUT", `https://factory.example/api/services/service-plans/${planId}/steps`, {
        cycleMonths: 1,
        steps: [
          { position: 1, monthOffset: 0, anchor: "day_of_month", dayOfMonth: 1 },
          { position: 2, monthOffset: 0, anchor: "day_of_month", dayOfMonth: 15 },
        ],
      }),
      { params: Promise.resolve({ planId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("crm_plan_set_sequence", expect.objectContaining({
      p_plan: planId,
      p_cycle_months: 1,
    }));
    // The dates come back from the generator, not from the request body.
    expect(body.occurrences[0].occursOn).toBe("2026-09-01");
  });

  it("turns the database's refusal of somebody else's plan into a 404", async () => {
    client({}, {
      crm_plan_set_sequence: {
        data: null,
        error: { message: "no such service plan in this workspace", code: "P0002" },
      },
    });

    const response = await writeSequence(
      send("PUT", `https://factory.example/api/services/service-plans/${planId}/steps`, {
        cycleMonths: null,
        steps: [],
      }),
      { params: Promise.resolve({ planId }) },
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("plan_not_found");
  });
});
