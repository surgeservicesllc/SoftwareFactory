// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({ requireActiveOrganization: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/supabase/request", () => ({ assertSameOriginRequest: () => undefined }));

import { POST as bulk } from "@/app/api/services/work-orders/bulk/route";
import { GET as listProjects, POST as createProject } from "@/app/api/services/projects/route";
import { PATCH as cancelProject } from "@/app/api/services/projects/[projectId]/route";

/**
 * The schedule's bending boundaries: a bulk edit passes exactly what was
 * asked and summarises what came back; nothing-to-change and completed are
 * refused before the database; a project is created through the one
 * function with its span and window checked first; cancel maps the
 * database's answer.
 */

const organizationId = "10000000-0000-4000-8000-000000400001";
const userId = "00000000-0000-4000-8000-000000400001";
const a = "80000000-0000-4000-8000-000000400001";
const b = "80000000-0000-4000-8000-000000400002";

let rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }>;

function client(rpc: Record<string, unknown> = {}, rpcError: { code: string; message: string } | null = null) {
  rpcCalls = [];
  const fn = vi.fn((name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const response = { data: rpcError ? null : (rpc[name] ?? []), error: rpcError };
    return Object.assign(Promise.resolve(response), { limit: () => Promise.resolve(response) });
  });
  requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: organizationId }, user: { id: userId }, client: { rpc: fn } });
}

beforeEach(() => vi.clearAllMocks());

describe("the bulk edit route", () => {
  it("passes the change through and summarises every outcome", async () => {
    client({ crm_work_orders_bulk_edit: [
      { work_order_id: a, applied: true, reason: null, technician_id: "t", scheduled_start: "2026-10-07T09:00:00Z", status: "scheduled" },
      { work_order_id: b, applied: false, reason: "completed; not changed", technician_id: null, scheduled_start: null, status: "completed" },
    ] });
    const body = await (await bulk(new Request("https://factory.example/api/services/work-orders/bulk", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [a, b], setTechnician: true, technicianId: "70000000-0000-4000-8000-000000400001", shiftDays: 1 }),
    }))).json();
    expect(rpcCalls).toEqual([{ name: "crm_work_orders_bulk_edit", args: { p_organization: organizationId, p_ids: [a, b], p_set_technician: true, p_technician: "70000000-0000-4000-8000-000000400001", p_shift_days: 1, p_status: null } }]);
    expect(body.summary.sentence).toBe("1 of 2 changed; 1 not: 1 completed.");
    expect(body.outcomes[0]).toMatchObject({ workOrderId: a, applied: true, technicianId: "t" });
  });

  it("refuses nothing-to-change and completed before the database, and clears a technician when asked", async () => {
    client();
    for (const payload of [{ ids: [a] }, { ids: [a], status: "completed" }, { ids: [] }]) {
      const response = await bulk(new Request("https://factory.example/api/services/work-orders/bulk", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      }));
      expect(response.status).toBe(422);
    }
    expect(rpcCalls).toEqual([]);
    await bulk(new Request("https://factory.example/api/services/work-orders/bulk", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [a], setTechnician: true, technicianId: null }),
    }));
    expect(rpcCalls[0]?.args).toMatchObject({ p_set_technician: true, p_technician: null, p_shift_days: 0 });
  });
});

describe("the project routes", () => {
  it("lists progress with counts by state", async () => {
    client({ crm_project_progress: [
      { project_id: "p1", name: "Plant fumigation", account_id: "a", account_name: "Harborview", property_id: "s", property_label: "Plant", technician_id: null, technician_name: null, service_type: "Fumigation", starts_on: "2026-10-12", ends_on: "2026-10-16", status: "planned", note: null, days: 5, completed: 1, cancelled: 0, remaining: 4, next_day: "2026-10-13", state: "active" },
      { project_id: "p2", name: "Later", account_id: "a", account_name: "Harborview", property_id: "s", property_label: "Plant", technician_id: null, technician_name: null, service_type: "Exclusion", starts_on: "2026-11-02", ends_on: "2026-11-04", status: "planned", note: null, days: 3, completed: 0, cancelled: 0, remaining: 3, next_day: "2026-11-02", state: "planned" },
    ] });
    const body = await (await listProjects()).json();
    expect(body.counts).toEqual({ total: 2, active: 1, planned: 1 });
    expect(body.projects[0]).toMatchObject({ projectId: "p1", days: 5, state: "active" });
  });

  it("creates through the one function with the span and window checked first, and passes the database's refusal through", async () => {
    client({ crm_project_create: [{ project_id: "p1", visits: 5 }] });
    const ok = await createProject(new Request("https://factory.example/api/services/projects", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "20000000-0000-4000-8000-000000400001", propertyId: "60000000-0000-4000-8000-000000400001", name: "Plant fumigation", serviceType: "Fumigation", startsOn: "2026-10-12", endsOn: "2026-10-16", dailyStart: "07:00", dailyEnd: "15:30" }),
    }));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ projectId: "p1", visits: 5 });
    expect(rpcCalls[0]?.args).toMatchObject({ p_name: "Plant fumigation", p_starts_on: "2026-10-12", p_ends_on: "2026-10-16", p_daily_start: "07:00", p_daily_end: "15:30", p_include_weekends: false, p_technician: null, p_note: null });

    client();
    for (const patch of [{ endsOn: "2026-10-11" }, { endsOn: "2026-11-15" }, { dailyEnd: "06:00" }]) {
      const response = await createProject(new Request("https://factory.example/api/services/projects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: "20000000-0000-4000-8000-000000400001", propertyId: "60000000-0000-4000-8000-000000400001", name: "x", serviceType: "y", startsOn: "2026-10-12", endsOn: "2026-10-16", dailyStart: "07:00", dailyEnd: "15:30", ...patch }),
      }));
      expect(response.status).toBe(422);
    }
    expect(rpcCalls).toEqual([]);

    client({}, { code: "P0001", message: "that span has no working day in it; include weekends or widen the dates" });
    const refused = await createProject(new Request("https://factory.example/api/services/projects", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "20000000-0000-4000-8000-000000400001", propertyId: "60000000-0000-4000-8000-000000400001", name: "x", serviceType: "y", startsOn: "2026-10-17", endsOn: "2026-10-18", dailyStart: "07:00", dailyEnd: "15:30" }),
    }));
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/no working day/);
  });

  it("cancels through the function and reads 404 for an unknown or already-cancelled project", async () => {
    client({ crm_project_cancel: 3 });
    const response = await cancelProject(new Request("https://factory.example/api/services/projects/p1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }), { params: Promise.resolve({ projectId: "70000000-0000-4000-8000-000000400001" }) });
    expect(await response.json()).toEqual({ projectId: "70000000-0000-4000-8000-000000400001", cancelledVisits: 3 });
    client({}, { code: "P0002", message: "no such project, or it is already cancelled" });
    const missing = await cancelProject(new Request("https://factory.example/api/services/projects/p1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }), { params: Promise.resolve({ projectId: "70000000-0000-4000-8000-000000400001" }) });
    expect(missing.status).toBe(404);
  });
});
