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

import { GET as search, POST as create } from "@/app/api/services/knowledge/route";
import { PATCH as patch } from "@/app/api/services/knowledge/[articleId]/route";
import { GET as articles } from "@/app/api/customer-portal/articles/route";
import { GET as customerCalendar } from "@/app/api/customer-portal/visits/[visitId]/calendar/route";
import { GET as staffCalendar } from "@/app/api/services/work-orders/[workOrderId]/calendar/route";

/**
 * The knowledge boundaries: a search passes the question and the filters
 * through and counts the book; a write derives the slug or refuses; a
 * customer's read takes no organization; and both calendar files carry
 * the visit's moments as text/calendar, with a visit that is not theirs
 * reading as 404.
 */

const organizationId = "10000000-0000-4000-8000-000000200001";
const userId = "00000000-0000-4000-8000-000000200001";
const articleId = "a0000000-0000-4000-8000-000000200001";
const visitId = "80000000-0000-4000-8000-000000200001";

let rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }>;
let inserted: Record<string, unknown> | null;
let updated: Record<string, unknown> | null;

const articleRow = {
  id: articleId, organization_id: organizationId, slug: "ant-treatment-what-to-expect", title: "Ant treatment: what to expect",
  body: "We place bait where the ants trail.", category: "Before your visit", audience: "customer", published_at: "2026-09-01T00:00:00Z",
  created_by: userId, updated_by: userId, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};

function staffClient(options: { rpc?: Record<string, unknown[]>; rows?: Array<Record<string, unknown>>; current?: Record<string, unknown> | null; workOrder?: Record<string, unknown> | null } = {}) {
  rpcCalls = [];
  inserted = null;
  updated = null;
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const response = { data: options.rpc?.[name] ?? [], error: null };
    return Object.assign(Promise.resolve(response), { limit: () => Promise.resolve(response) });
  });
  const from = vi.fn((table: string) => ({
    select: (_columns: string) => ({
      eq: () => ({
        limit: () => Promise.resolve({ data: options.rows ?? [], error: null }),
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: table === "crm_work_orders" ? (options.workOrder ?? null) : (options.current ?? null), error: null }) }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      inserted = row;
      return { select: () => ({ single: () => Promise.resolve({ data: { ...articleRow, ...row }, error: null }) }) };
    },
    update: (changes: Record<string, unknown>) => {
      updated = changes;
      return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { ...articleRow, ...changes }, error: null }) }) }) }) };
    },
  }));
  requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: organizationId, name: "Acme Pest" }, user: { id: userId }, client: { rpc, from } });
}

function portalClient(rpc: Record<string, unknown[]>) {
  rpcCalls = [];
  requirePortalUser.mockResolvedValue({
    client: {
      rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return Promise.resolve({ data: rpc[name] ?? [], error: null });
      }),
    },
    identity: { organizationId, accountId: "acct", portalUserId: "pu", role: "viewer" },
  });
}

const hit = { id: articleId, slug: "ant-treatment-what-to-expect", title: "Ant treatment: what to expect", category: "Before your visit", audience: "customer", published_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", rank: 4, title_hits: 1, body_hits: 1, excerpt: "We place bait where the ants trail." };

beforeEach(() => vi.clearAllMocks());

describe("the staff knowledge routes", () => {
  it("passes the question and filters through, and counts the book beside the hits", async () => {
    staffClient({ rpc: { crm_kb_search: [hit] }, rows: [
      { id: "1", audience: "customer", published_at: "2026-09-01T00:00:00Z" },
      { id: "2", audience: "staff", published_at: "2026-09-01T00:00:00Z" },
      { id: "3", audience: "customer", published_at: null },
    ] });
    const body = await (await search(new Request("https://factory.example/api/services/knowledge?q=ants&audience=customer&published=1"))).json();
    expect(rpcCalls).toEqual([{ name: "crm_kb_search", args: { p_organization: organizationId, p_query: "ants", p_audience: "customer", p_published_only: true } }]);
    expect(body.hits[0]).toMatchObject({ slug: "ant-treatment-what-to-expect", rank: 4, titleHits: 1, bodyHits: 1 });
    expect(body.counts).toEqual({ total: 3, published: 2, customer: 1 });
    staffClient({ rpc: { crm_kb_search: [] } });
    await search(new Request("https://factory.example/api/services/knowledge?audience=nonsense"));
    expect(rpcCalls[0]?.args).toEqual({ p_organization: organizationId, p_query: null, p_audience: null, p_published_only: false });
  });

  it("derives the slug from the title, stamps the publisher, and refuses a title with nothing to make one from", async () => {
    staffClient();
    const response = await create(new Request("https://factory.example/api/services/knowledge", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Ant treatment: what to expect", body: "We place bait.", audience: "customer", published: true }),
    }));
    expect(response.status).toBe(201);
    expect(inserted).toMatchObject({ organization_id: organizationId, slug: "ant-treatment-what-to-expect", audience: "customer", created_by: userId, updated_by: userId });
    expect(typeof (inserted as { published_at: string }).published_at).toBe("string");
    staffClient();
    const refused = await create(new Request("https://factory.example/api/services/knowledge", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "!!", body: "x" }),
    }));
    expect(refused.status).toBe(422);
    expect(inserted).toBeNull();
    const bad = await create(new Request("https://factory.example/api/services/knowledge", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Fine title", body: "x", slug: "Not A Slug" }),
    }));
    expect(bad.status).toBe(422);
  });

  it("keeps the first publication moment on re-save and clears it on withdrawal", async () => {
    staffClient({ current: { published_at: "2026-08-01T00:00:00Z" } });
    await patch(
      new Request(`https://factory.example/api/services/knowledge/${articleId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ published: true, body: "Edited." }) }),
      { params: Promise.resolve({ articleId }) },
    );
    expect(updated).toEqual({ updated_by: userId, body: "Edited.", published_at: "2026-08-01T00:00:00Z" });
    staffClient({ current: { published_at: "2026-08-01T00:00:00Z" } });
    await patch(
      new Request(`https://factory.example/api/services/knowledge/${articleId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ published: false }) }),
      { params: Promise.resolve({ articleId }) },
    );
    expect(updated).toEqual({ updated_by: userId, published_at: null });
    const empty = await patch(
      new Request(`https://factory.example/api/services/knowledge/${articleId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }),
      { params: Promise.resolve({ articleId }) },
    );
    expect(empty.status).toBe(422);
  });
});

describe("the customer's help and calendar", () => {
  it("reads articles through the definer with only the question, never an organization", async () => {
    portalClient({ crm_portal_articles: [{ id: articleId, slug: "ant-treatment-what-to-expect", title: "Ant treatment: what to expect", category: null, body: "Full body.", published_at: "2026-09-01T00:00:00Z", rank: 3, excerpt: "Full body." }] });
    const body = await (await articles(new Request("https://factory.example/api/customer-portal/articles?q=ants"))).json();
    expect(rpcCalls).toEqual([{ name: "crm_portal_articles", args: { p_query: "ants" } }]);
    expect(body.articles[0]).toMatchObject({ slug: "ant-treatment-what-to-expect", body: "Full body.", rank: 3 });
    expect(body.counts).toEqual({ total: 1 });
  });

  it("hands over a text/calendar file for the customer's own booked visit, and 404 for any other", async () => {
    portalClient({ crm_portal_visit_calendar: [{ id: visitId, service_type: "General pest", status: "scheduled", scheduled_start: "2026-10-05T14:00:00Z", scheduled_end: "2026-10-05T15:30:00Z", property_label: "Plant", address: "1 Loaf Lane", technician_name: "Rosa Vega", organization_name: "Acme Pest" }] });
    const response = await customerCalendar(new Request(`https://factory.example/api/customer-portal/visits/${visitId}/calendar`), { params: Promise.resolve({ visitId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="general-pest-2026-10-05.ics"');
    const text = await response.text();
    expect(text).toContain("DTSTART:20261005T140000Z");
    expect(text).toContain("DTEND:20261005T153000Z");
    expect(text).toContain("SUMMARY:General pest — Acme Pest");
    expect(text).toContain("LOCATION:Plant\\, 1 Loaf Lane");
    expect(text).toContain("Technician: Rosa Vega.");
    expect(text).toContain(`UID:visit-${visitId}@softwarefactory-services`);
    portalClient({ crm_portal_visit_calendar: [] });
    const missing = await customerCalendar(new Request("https://factory.example/api/customer-portal/visits/x/calendar"), { params: Promise.resolve({ visitId }) });
    expect(missing.status).toBe(404);
    const malformed = await customerCalendar(new Request("https://factory.example/api/customer-portal/visits/x/calendar"), { params: Promise.resolve({ visitId: "not-a-uuid" }) });
    expect(malformed.status).toBe(404);
  });

  it("builds the staff file from the work order under RLS, instructions included, and assumes an hour when no end is recorded", async () => {
    staffClient({ workOrder: { id: visitId, service_type: "Rodent", status: "scheduled", scheduled_start: "2026-10-05T14:00:00Z", scheduled_end: null, instructions: "Gate code 4411.", crm_properties: { label: "Plant", address: "1 Loaf Lane" }, crm_technicians: { first_name: "Rosa", last_name: "Vega" }, crm_accounts: { name: "Harborview Foods" } } });
    const response = await staffCalendar(new Request(`https://factory.example/api/services/work-orders/${visitId}/calendar`), { params: Promise.resolve({ workOrderId: visitId }) });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("SUMMARY:Rodent — Harborview Foods");
    expect(text).toContain("DTEND:20261005T150000Z");
    expect(text).toContain("Instructions: Gate code 4411.");
    expect(text).toContain("No end time was recorded");
    staffClient({ workOrder: null });
    expect((await staffCalendar(new Request("https://factory.example/x"), { params: Promise.resolve({ workOrderId: visitId }) })).status).toBe(404);
  });
});
