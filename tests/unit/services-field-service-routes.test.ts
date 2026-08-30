// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { advanceServiceDate } from "@/lib/services/crm";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET as listWorkOrders, POST as createWorkOrder } from "@/app/api/services/work-orders/route";
import { PATCH as patchWorkOrder } from "@/app/api/services/work-orders/[workOrderId]/route";
import { POST as createTechnician } from "@/app/api/services/technicians/route";
import { POST as generateVisit } from "@/app/api/services/service-plans/[planId]/generate/route";

/**
 * The field-service boundaries: exact tenant inserts, the schedule's counts
 * from the same authority, honest refusals before the database where the
 * shape is wrong, and the generate flow's concurrency guard — one due date
 * generates one visit, ever.
 */

const organizationId = "10000000-0000-4000-8000-0000000c0001";
const userId = "00000000-0000-4000-8000-0000000c0001";
const accountId = "20000000-0000-4000-8000-0000000c0001";
const propertyId = "60000000-0000-4000-8000-0000000c0001";
const technicianId = "70000000-0000-4000-8000-0000000c0001";
const workOrderId = "80000000-0000-4000-8000-0000000c0001";
const planId = "90000000-0000-4000-8000-0000000c0001";

type QueryResult = { data: unknown; error: unknown; count?: number };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "order", "limit", "ilike", "gte", "lte"]) {
    builder[method] = vi.fn(chain);
  }
  builder.single = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.maybeSingle = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.then = (onFulfilled: (value: QueryResult) => unknown) =>
    Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onFulfilled);
  return builder;
}

let from: ReturnType<typeof vi.fn>;

function client(results: Record<string, QueryResult[]>) {
  const tables = new Map<string, ReturnType<typeof stubTable>>();
  from = vi.fn((table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created = stubTable(results[table] ?? [{ data: null, error: null }]);
    tables.set(table, created);
    return created;
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { from },
  });
}

function post(url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const workOrderRow = {
  id: workOrderId,
  account_id: accountId,
  property_id: propertyId,
  technician_id: technicianId,
  plan_id: null,
  status: "scheduled",
  service_type: "Monthly IPM service",
  scheduled_start: "2026-09-02T09:00:00Z",
  scheduled_end: "2026-09-02T11:00:00Z",
  instructions: null,
  completion_notes: null,
  completed_at: null,
  created_at: "2026-08-30T10:00:00Z",
  updated_at: "2026-08-30T10:00:00Z",
};

const planRow = {
  id: planId,
  account_id: accountId,
  property_id: propertyId,
  service_type: "Monthly IPM service",
  recurrence: "monthly",
  next_due: "2026-09-15",
  technician_id: technicianId,
  value_cents: 154_000,
  active: true,
  notes: null,
  created_at: "2026-08-30T10:00:00Z",
  updated_at: "2026-08-30T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recurrence date arithmetic", () => {
  it("advances by weeks and by clamped months", () => {
    expect(advanceServiceDate("2026-09-01", "weekly")).toBe("2026-09-08");
    expect(advanceServiceDate("2026-09-01", "biweekly")).toBe("2026-09-15");
    expect(advanceServiceDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(advanceServiceDate("2028-01-31", "monthly")).toBe("2028-02-29");
    expect(advanceServiceDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(advanceServiceDate("2026-03-15", "semiannual")).toBe("2026-09-15");
    expect(advanceServiceDate("2026-06-01", "annual")).toBe("2027-06-01");
  });
});

describe("the work-order boundary", () => {
  it("lists the schedule with counts from the same authority", async () => {
    client({
      crm_work_orders: [
        { data: [workOrderRow], error: null },
        { data: [{ status: "scheduled" }, { status: "completed" }, { status: "completed" }], error: null },
      ],
    });
    const response = await listWorkOrders(
      new Request("https://factory.example/api/services/work-orders?status=scheduled"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workOrders[0]).toMatchObject({ id: workOrderId, serviceType: "Monthly IPM service" });
    expect(body.counts).toMatchObject({
      byStatus: { scheduled: 1, completed: 2, cancelled: 0 },
      total: 3,
    });
  });

  it("books a visit with the exact tenant identity", async () => {
    client({ crm_work_orders: [{ data: workOrderRow, error: null }] });
    const response = await createWorkOrder(
      post("https://factory.example/api/services/work-orders", {
        accountId,
        propertyId,
        technicianId,
        serviceType: "Monthly IPM service",
        scheduledStart: "2026-09-02T09:00:00Z",
        scheduledEnd: "2026-09-02T11:00:00Z",
      }),
    );
    expect(response.status).toBe(201);
    const table = from.mock.results[0]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId,
      account_id: accountId,
      property_id: propertyId,
      created_by: userId,
    }));
  });

  it("refuses a visit that ends before it starts, before the database", async () => {
    client({ crm_work_orders: [{ data: workOrderRow, error: null }] });
    const response = await createWorkOrder(
      post("https://factory.example/api/services/work-orders", {
        accountId,
        propertyId,
        serviceType: "Backwards visit",
        scheduledStart: "2026-09-02T11:00:00Z",
        scheduledEnd: "2026-09-02T09:00:00Z",
      }),
    );
    expect(response.status).toBe(422);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("answers a cross-account property with an honest 404 from the composite key", async () => {
    client({ crm_work_orders: [{ data: null, error: { code: "23503", message: "fk" } }] });
    const response = await createWorkOrder(
      post("https://factory.example/api/services/work-orders", {
        accountId,
        propertyId,
        serviceType: "Misdirected visit",
        scheduledStart: "2026-09-02T09:00:00Z",
        scheduledEnd: "2026-09-02T11:00:00Z",
      }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("reference_not_found");
  });

  it("progresses a visit through PATCH — the timeline write is the database's", async () => {
    client({
      crm_work_orders: [{ data: { ...workOrderRow, status: "completed", completion_notes: "Done." }, error: null }],
    });
    const response = await patchWorkOrder(
      patch(`https://factory.example/api/services/work-orders/${workOrderId}`, {
        status: "completed",
        completionNotes: "Done.",
      }),
      { params: Promise.resolve({ workOrderId }) },
    );
    expect(response.status).toBe(200);
    const table = from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    expect(table.update).toHaveBeenCalledWith({ status: "completed", completion_notes: "Done." });
  });
});

describe("the technician boundary", () => {
  it("records a technician with the exact tenant identity", async () => {
    client({
      crm_technicians: [{
        data: {
          id: technicianId,
          first_name: "Miguel",
          last_name: "Santos",
          email: null,
          phone: null,
          license_number: "DEMO-APP-10482",
          active: true,
          created_at: "2026-08-30T10:00:00Z",
          updated_at: "2026-08-30T10:00:00Z",
        },
        error: null,
      }],
    });
    const response = await createTechnician(
      post("https://factory.example/api/services/technicians", {
        firstName: "Miguel",
        lastName: "Santos",
        licenseNumber: "DEMO-APP-10482",
      }),
    );
    expect(response.status).toBe(201);
    const table = from.mock.results[0]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId,
      created_by: userId,
      license_number: "DEMO-APP-10482",
    }));
  });
});

describe("the generate-visit boundary", () => {
  it("creates the due visit and advances the plan by its recurrence", async () => {
    client({
      crm_service_plans: [
        { data: planRow, error: null },
        { data: { ...planRow, next_due: "2026-10-15" }, error: null },
      ],
      crm_work_orders: [{ data: { ...workOrderRow, plan_id: planId }, error: null }],
    });
    const response = await generateVisit(
      post(`https://factory.example/api/services/service-plans/${planId}/generate`, {}),
      { params: Promise.resolve({ planId }) },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.plan.nextDue).toBe("2026-10-15");
    expect(body.workOrder.planId).toBe(planId);
    const plans = from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    expect(plans.update).toHaveBeenCalledWith({ next_due: "2026-10-15" });
    const ordersIndex = from.mock.calls.findIndex(([table]) => table === "crm_work_orders");
    const orders = from.mock.results[ordersIndex]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(orders.insert).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: planId,
      scheduled_start: "2026-09-15T09:00:00Z",
      scheduled_end: "2026-09-15T11:00:00Z",
      created_by: userId,
    }));
  });

  it("answers a concurrent double-generate with one visit and one honest 409", async () => {
    client({
      crm_service_plans: [
        { data: planRow, error: null },
        // The guarded advance found next_due already moved: no row.
        { data: null, error: null },
      ],
      crm_work_orders: [{ data: workOrderRow, error: null }],
    });
    const response = await generateVisit(
      post(`https://factory.example/api/services/service-plans/${planId}/generate`, {}),
      { params: Promise.resolve({ planId }) },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("plan_already_generated");
    const orders = from.mock.calls.some(([table]) => table === "crm_work_orders");
    expect(orders).toBe(false);
  });

  it("refuses to generate from a paused plan", async () => {
    client({ crm_service_plans: [{ data: { ...planRow, active: false }, error: null }] });
    const response = await generateVisit(
      post(`https://factory.example/api/services/service-plans/${planId}/generate`, {}),
      { params: Promise.resolve({ planId }) },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("plan_inactive");
  });

  it("compensates the advance when the visit insert fails", async () => {
    client({
      crm_service_plans: [
        { data: planRow, error: null },
        { data: { ...planRow, next_due: "2026-10-15" }, error: null },
        // The compensation update.
        { data: null, error: null },
      ],
      crm_work_orders: [{ data: null, error: { code: "23503", message: "fk" } }],
    });
    const response = await generateVisit(
      post(`https://factory.example/api/services/service-plans/${planId}/generate`, {}),
      { params: Promise.resolve({ planId }) },
    );
    expect(response.ok).toBe(false);
    const plans = from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    // First the advance, then the compensation back to the original date.
    expect(plans.update).toHaveBeenNthCalledWith(1, { next_due: "2026-10-15" });
    expect(plans.update).toHaveBeenNthCalledWith(2, { next_due: "2026-09-15" });
  });
});
