// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({ requireActiveOrganization: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/supabase/request", () => ({ assertSameOriginRequest: () => undefined }));

import { GET as suggestion, PUT as assign } from "@/app/api/services/portal/requests/[requestId]/assignment/route";
import { GET as queue } from "@/app/api/services/portal/queue/route";

const organizationId = "10000000-0000-4000-8000-000000500001";
const requestId = "a0000000-0000-4000-8000-000000500001";
const employeeId = "e0000000-0000-4000-8000-000000500001";

let rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }>;

function client(rpc: Record<string, unknown> = {}, rpcError: { code: string; message: string } | null = null) {
  rpcCalls = [];
  const fn = vi.fn((name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const response = { data: rpcError ? null : (name in rpc ? rpc[name] : []), error: rpcError };
    return Object.assign(Promise.resolve(response), { limit: () => Promise.resolve(response) });
  });
  const from = vi.fn(() => {
    const query = {
      select: () => query, eq: () => query, order: () => query,
      limit: () => Promise.resolve({ data: [{ id: employeeId, first_name: "Ana", last_name: "Cruz", role: "branch_manager" }, { id: "e2", first_name: "Dev", last_name: null, role: "dispatcher" }], error: null }),
    };
    return query;
  });
  requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: organizationId }, user: { id: "u" }, client: { rpc: fn, from } });
}

beforeEach(() => vi.clearAllMocks());

describe("the assignment routes", () => {
  it("reads the suggestion with its reason, and 404s a request the caller cannot see", async () => {
    client({ crm_request_suggested_assignee: [{ employee_id: employeeId, employee_name: "Ana Cruz", role: "branch_manager", reason: "branch manager of North; the address's postal code 93940 is in territory N1", territory_code: "N1", postal_code: "93940", open_requests: 1 }] });
    const body = await (await suggestion(new Request("https://factory.example/x"), { params: Promise.resolve({ requestId }) })).json();
    expect(rpcCalls).toEqual([{ name: "crm_request_suggested_assignee", args: { p_organization: organizationId, p_request: requestId } }]);
    expect(body.suggestion).toMatchObject({ employeeId, employeeName: "Ana Cruz", territoryCode: "N1", openRequests: 1 });
    client({ crm_request_suggested_assignee: [] });
    expect((await suggestion(new Request("https://factory.example/x"), { params: Promise.resolve({ requestId }) })).status).toBe(404);
    expect((await suggestion(new Request("https://factory.example/x"), { params: Promise.resolve({ requestId: "nope" }) })).status).toBe(404);
  });

  it("assigns and unassigns through the function, and names the refusals", async () => {
    client({ crm_request_assign: requestId });
    const ok = await assign(new Request("https://factory.example/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId }) }), { params: Promise.resolve({ requestId }) });
    expect(ok.status).toBe(200);
    expect(rpcCalls[0]).toEqual({ name: "crm_request_assign", args: { p_organization: organizationId, p_request: requestId, p_employee: employeeId } });
    client({ crm_request_assign: requestId });
    await assign(new Request("https://factory.example/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId: null }) }), { params: Promise.resolve({ requestId }) });
    expect(rpcCalls[0]?.args).toMatchObject({ p_employee: null });
    client({}, { code: "23503", message: "that person is not an active member of staff in this workspace" });
    expect((await assign(new Request("https://factory.example/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId }) }), { params: Promise.resolve({ requestId }) })).status).toBe(422);
    client({}, { code: "P0002", message: "no such request in this workspace" });
    expect((await assign(new Request("https://factory.example/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId }) }), { params: Promise.resolve({ requestId }) })).status).toBe(404);
    client();
    expect((await assign(new Request("https://factory.example/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId: "x" }) }), { params: Promise.resolve({ requestId }) })).status).toBe(422);
  });

  it("reads the queue with the people it could go to, the caller's record, and the counts", async () => {
    client({
      crm_request_queue: [
        { request_id: requestId, account_id: "a", account_name: "Harborview Foods", kind: "question", status: "submitted", summary: "Ants", submitted_at: "x", waiting_minutes: 390, assignee_employee_id: null, assignee_name: null, assigned_at: null, suggested_employee_id: employeeId, suggested_name: "Ana Cruz", suggested_reason: "branch manager of North; …" },
        { request_id: "r2", account_id: "a", account_name: "Old Mill", kind: "service", status: "acknowledged", summary: "Gate", submitted_at: "x", waiting_minutes: 30, assignee_employee_id: employeeId, assignee_name: "Ana Cruz", assigned_at: "x", suggested_employee_id: null, suggested_name: null, suggested_reason: null },
      ],
      crm_my_employee: employeeId,
    });
    const body = await (await queue()).json();
    expect(body.employees).toEqual([{ id: employeeId, name: "Ana Cruz", role: "branch_manager" }, { id: "e2", name: "Dev", role: "dispatcher" }]);
    expect(body.myEmployeeId).toBe(employeeId);
    expect(body.counts).toEqual({ open: 2, unassigned: 1, mine: 1 });
    expect(body.queue[0]).toMatchObject({ requestId, suggestedName: "Ana Cruz", waitingMinutes: 390 });
  });
});
