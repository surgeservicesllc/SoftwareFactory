// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization, requirePortalUser } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  requirePortalUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/server/customer-portal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/customer-portal")>()),
  requirePortalUser,
}));
vi.mock("@/lib/supabase/request", () => ({ assertSameOriginRequest: () => undefined }));

import { GET as sla, PUT as savePolicy } from "@/app/api/services/portal/sla/route";
import { GET as surveys } from "@/app/api/services/portal/surveys/route";
import { PATCH as markRead, POST as sendStaff } from "@/app/api/services/portal/messages/route";
import { POST as rate } from "@/app/api/customer-portal/surveys/route";
import { GET as myMessages, POST as sendMine } from "@/app/api/customer-portal/messages/route";

/**
 * The customer's-side boundaries. The behavior suite proves the SQL; this
 * file pins what the routes must not undo: windows bounded, a policy that
 * resolves before it acknowledges refused before the database, a response
 * rate null with no denominator, staff messages signed by the caller, a
 * definer's refusal turned into the customer's answer rather than a 500.
 */

const organizationId = "10000000-0000-4000-8000-0000000f0001";
const userId = "00000000-0000-4000-8000-0000000f0001";
const automation = { id: "x" };
void automation;

let rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }>;
let inserted: Record<string, unknown> | null;
let upserted: Record<string, unknown> | null;

function staffClient(options: { rpc?: Record<string, unknown[]>; count?: number; updated?: unknown } = {}) {
  rpcCalls = [];
  inserted = null;
  upserted = null;
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const response = { data: options.rpc?.[name] ?? [], error: null };
    return Object.assign(Promise.resolve(response), { limit: () => Promise.resolve(response) });
  });
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ eq: () => ({ gte: () => Promise.resolve({ count: options.count ?? 0, error: null }) }) }),
    }),
    upsert: (row: Record<string, unknown>) => {
      upserted = row;
      return { select: () => Promise.resolve({ data: [{ id: "p1" }], error: null }) };
    },
    insert: (row: Record<string, unknown>) => {
      inserted = row;
      return { select: () => ({ single: () => Promise.resolve({ data: { id: "m1", account_id: row.account_id, request_id: null, author_kind: "staff", portal_user_id: null, author_user_id: row.author_user_id, body: row.body, sent_at: "2026-04-01T00:00:00Z", read_at: null }, error: null }) }) };
    },
    update: () => ({
      eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: options.updated ?? null, error: null }) }) }) }) }) }),
    }),
  }));
  requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: organizationId }, user: { id: userId }, client: { rpc, from } });
}

function portalClient(errors: Record<string, { message: string }> = {}, data: Record<string, unknown> = {}) {
  rpcCalls = [];
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return Promise.resolve(errors[name] ? { data: null, error: errors[name] } : { data: data[name] ?? "id-1", error: null });
  });
  requirePortalUser.mockResolvedValue({ client: { rpc }, user: { id: "portal" }, identity: { organizationId, accountId: "acc", portalUserId: "pu", role: "viewer" } });
}

function json(url: string, method: string, body?: unknown) {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe("the request clock route", () => {
  it("bounds the window, summarises, and returns the effective policies", async () => {
    staffClient({
      rpc: {
        crm_request_sla: [{ request_id: "r1", account_id: "a", account_name: "Acme", kind: "complaint", status: "submitted", summary: "Ants", submitted_at: "2026-04-01T00:00:00Z", acknowledged_at: null, first_response_at: null, resolved_at: null, acknowledge_hours: 4, resolve_hours: 48, acknowledge_due_at: "2026-04-01T04:00:00Z", resolve_due_at: "2026-04-03T00:00:00Z", acknowledge_state: "overdue", resolve_state: "waiting", waiting_minutes: 500 }],
        crm_effective_sla: [{ kind: "complaint", acknowledge_hours: 4, resolve_hours: 48, overridden: false }],
      },
    });
    const response = await sla(new Request("https://factory.example/api/services/portal/sla?days=9999"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(rpcCalls[0]).toEqual({ name: "crm_request_sla", args: { p_organization: organizationId, p_days: 365 } });
    expect(body.summary).toMatchObject({ requests: 1, open: 1, overdue: 1 });
    expect(body.requests[0]).toMatchObject({ acknowledgeState: "overdue", open: true });
    expect(body.policies).toEqual([{ kind: "complaint", acknowledgeHours: 4, resolveHours: 48, overridden: false }]);
  });

  it("refuses a policy that resolves before it acknowledges, and upserts a sound one as the caller", async () => {
    staffClient({ rpc: { crm_effective_sla: [] } });
    const bad = await savePolicy(json("https://factory.example/api/services/portal/sla", "PUT", { kind: "quote", acknowledgeHours: 48, resolveHours: 24 }));
    expect(bad.status).toBe(422);
    expect(upserted).toBeNull();
    const ok = await savePolicy(json("https://factory.example/api/services/portal/sla", "PUT", { kind: "complaint", acknowledgeHours: 2, resolveHours: 24 }));
    expect(ok.status).toBe(200);
    expect(upserted).toEqual({ organization_id: organizationId, kind: "complaint", acknowledge_hours: 2, resolve_hours: 24, updated_by: userId });
  });
});

describe("the ratings route", () => {
  it("leaves the rate null with no completed visit and computes it otherwise", async () => {
    staffClient({ rpc: { crm_survey_responses: [] }, count: 0 });
    expect((await (await surveys(new Request("https://factory.example/api/services/portal/surveys"))).json()).summary).toMatchObject({ responseRateBps: null, averageScore: null });
    staffClient({
      rpc: { crm_survey_responses: [{ survey_id: "s", work_order_id: "w", account_id: "a", account_name: "Acme", service_type: "General", technician_id: null, technician_name: null, completed_at: null, score: 4, comment: null, submitted_at: "2026-04-01T00:00:00Z" }] },
      count: 8,
    });
    const body = await (await surveys(new Request("https://factory.example/api/services/portal/surveys?days=30"))).json();
    expect(body.summary).toMatchObject({ responses: 1, completedVisits: 8, responseRateBps: 1250, averageScore: 4 });
    expect(rpcCalls[0]).toEqual({ name: "crm_survey_responses", args: { p_organization: organizationId, p_days: 30 } });
  });
});

describe("the staff messages route", () => {
  it("signs a staff message with the caller and reports a mark on nothing as not found", async () => {
    staffClient();
    const sent = await sendStaff(json("https://factory.example/api/services/portal/messages", "POST", { accountId: "20000000-0000-4000-8000-0000000f0001", body: "  Hello  " }));
    expect(sent.status).toBe(201);
    expect(inserted).toEqual({ organization_id: organizationId, account_id: "20000000-0000-4000-8000-0000000f0001", request_id: null, author_kind: "staff", author_user_id: userId, body: "Hello" });
    const missing = await markRead(json("https://factory.example/api/services/portal/messages", "PATCH", { messageId: "20000000-0000-4000-8000-0000000f0002" }));
    expect(missing.status).toBe(404);
  });
});

describe("the customer's routes", () => {
  it("turns each of the definer's refusals into the customer's answer", async () => {
    portalClient({ crm_portal_survey_submit: { message: "that visit has already been rated" } });
    expect((await rate(json("https://factory.example/api/customer-portal/surveys", "POST", { workOrderId: "20000000-0000-4000-8000-0000000f0003", score: 5 }))).status).toBe(409);
    portalClient({ crm_portal_survey_submit: { message: "a visit can be rated once it is completed" } });
    expect((await rate(json("https://factory.example/api/customer-portal/surveys", "POST", { workOrderId: "20000000-0000-4000-8000-0000000f0003", score: 5 }))).status).toBe(409);
    portalClient({ crm_portal_survey_submit: { message: "that visit is not on this account" } });
    expect((await rate(json("https://factory.example/api/customer-portal/surveys", "POST", { workOrderId: "20000000-0000-4000-8000-0000000f0003", score: 5 }))).status).toBe(404);
    portalClient();
    const ok = await rate(json("https://factory.example/api/customer-portal/surveys", "POST", { workOrderId: "20000000-0000-4000-8000-0000000f0003", score: 4, comment: " Good " }));
    expect(ok.status).toBe(201);
    expect(rpcCalls[0]).toEqual({ name: "crm_portal_survey_submit", args: { p_work_order: "20000000-0000-4000-8000-0000000f0003", p_score: 4, p_comment: "Good" } });
    expect((await rate(json("https://factory.example/api/customer-portal/surveys", "POST", { workOrderId: "20000000-0000-4000-8000-0000000f0003", score: 6 }))).status).toBe(422);
  });

  it("sends a message through the definer and counts unread staff replies", async () => {
    portalClient({ crm_portal_message_send: { message: "that request is not on this account" } });
    expect((await sendMine(json("https://factory.example/api/customer-portal/messages", "POST", { body: "hi", requestId: "20000000-0000-4000-8000-0000000f0004" }))).status).toBe(404);
    portalClient({}, {
      crm_portal_messages_mine: [
        { id: "m1", request_id: null, author_kind: "customer", body: "mine", sent_at: "2026-04-01T00:00:00Z", read_at: null },
        { id: "m2", request_id: null, author_kind: "staff", body: "theirs", sent_at: "2026-04-02T00:00:00Z", read_at: null },
        { id: "m3", request_id: null, author_kind: "staff", body: "seen", sent_at: "2026-04-03T00:00:00Z", read_at: "2026-04-03T01:00:00Z" },
      ],
    });
    const body = await (await myMessages()).json();
    expect(body.counts).toEqual({ total: 3, unreadFromStaff: 1 });
    expect(body.messages[1]).toMatchObject({ authorKind: "staff", body: "theirs" });
  });
});
