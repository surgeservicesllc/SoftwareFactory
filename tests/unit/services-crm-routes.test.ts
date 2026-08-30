// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization, seedDemoData } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  seedDemoData: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/services/demo-seed", () => ({ seedDemoData }));

import { GET as listAccounts, POST as createAccount } from "@/app/api/services/accounts/route";
import { GET as readAccount } from "@/app/api/services/accounts/[accountId]/route";
import { POST as recordEvent } from "@/app/api/services/accounts/[accountId]/timeline/route";
import { GET as listOpportunities, POST as createOpportunity } from "@/app/api/services/opportunities/route";
import { PATCH as patchOpportunity } from "@/app/api/services/opportunities/[opportunityId]/route";
import { GET as searchBook } from "@/app/api/services/search/route";
import { POST as seedDemo } from "@/app/api/services/demo-seed/route";

/**
 * The CRM routes' own conduct: the database owns tenancy and immutability
 * (proved in the behavior suites); this file pins what the boundary itself
 * promises — org-scoped reads, exact inserts, the manual timeline refusing
 * system kinds, duplicates surfaced and never merged, the loss-reason rule,
 * honest 404s, and cross-origin posts refused before anything is touched.
 */

const organizationId = "10000000-0000-4000-8000-0000000c0001";
const userId = "00000000-0000-4000-8000-0000000c0001";
const accountId = "20000000-0000-4000-8000-0000000c0001";

type QueryResult = { data: unknown; error: unknown; count?: number };

/** A chainable, awaitable stub of the supabase query builder. */
function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "order", "limit", "ilike"]) {
    builder[method] = vi.fn(chain);
  }
  builder.single = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.maybeSingle = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.then = (onFulfilled: (value: QueryResult) => unknown) =>
    Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onFulfilled);
  return builder;
}

const accountRow = {
  id: accountId,
  name: "Harborview Foods",
  kind: "commercial",
  status: "lead",
  email: null,
  phone: null,
  source: "referral",
  billing_address: null,
  notes: null,
  created_at: "2026-08-30T10:00:00Z",
  updated_at: "2026-08-30T10:00:00Z",
};

let from: ReturnType<typeof vi.fn>;

function client(results: Record<string, QueryResult[]>) {
  // One stub per table, shared across from() calls, so a route's second read
  // of the same table advances to the next scripted result.
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the accounts boundary", () => {
  it("lists the book with counts from the same authority", async () => {
    client({
      crm_accounts: [
        { data: [accountRow], error: null },
        { data: [{ status: "lead", kind: "commercial" }, { status: "customer", kind: "residential" }], error: null },
      ],
    });
    const response = await listAccounts(
      new Request("https://factory.example/api/services/accounts?status=lead"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts[0]).toMatchObject({ id: accountId, name: "Harborview Foods", billingAddress: null });
    expect(body.counts).toEqual({
      byStatus: { lead: 1, customer: 1 },
      byKind: { commercial: 1, residential: 1 },
      total: 2,
    });
  });

  it("records a new account with the exact tenant identity", async () => {
    client({
      crm_accounts: [
        // The duplicate probe (name only here) finds nothing, then the insert.
        { data: [], error: null },
        { data: accountRow, error: null },
      ],
    });
    const response = await createAccount(
      post("https://factory.example/api/services/accounts", {
        name: "Harborview Foods",
        kind: "commercial",
        source: "referral",
      }),
    );
    expect(response.status).toBe(201);
    const table = from.mock.results[0]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId,
      created_by: userId,
      name: "Harborview Foods",
      kind: "commercial",
      status: "lead",
    }));
  });

  it("surfaces a likely duplicate as a 409 with the matches, inserting nothing", async () => {
    client({ crm_accounts: [{ data: [accountRow], error: null }] });
    const response = await createAccount(
      post("https://factory.example/api/services/accounts", {
        name: "harborview-foods!",
        kind: "commercial",
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("possible_duplicate");
    expect(body.duplicates).toHaveLength(1);
    expect(body.duplicates[0]).toMatchObject({ id: accountId, name: "Harborview Foods" });
    const table = from.mock.results[0]?.value as {
      insert: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
    };
    expect(table.insert).not.toHaveBeenCalled();
    // The probe ran on the database's normalized column, with the same
    // normalization the generated column stores.
    expect(table.eq).toHaveBeenCalledWith("name_normal", "harborviewfoods");
  });

  it("records anyway once the caller has decided the duplicate is genuine", async () => {
    client({ crm_accounts: [{ data: accountRow, error: null }] });
    const response = await createAccount(
      post("https://factory.example/api/services/accounts", {
        name: "Harborview Foods",
        kind: "commercial",
        allowDuplicate: true,
      }),
    );
    expect(response.status).toBe(201);
    const table = from.mock.results[0]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(table.insert).toHaveBeenCalledTimes(1);
  });

  it("refuses a cross-origin post before touching anything", async () => {
    client({ crm_accounts: [{ data: accountRow, error: null }] });
    const response = await createAccount(
      post("https://factory.example/api/services/accounts",
        { name: "X", kind: "residential" }, "https://evil.example"),
    );
    expect(response.ok).toBe(false);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("refuses a shape it does not recognise instead of guessing", async () => {
    client({ crm_accounts: [{ data: accountRow, error: null }] });
    const response = await createAccount(
      post("https://factory.example/api/services/accounts", { name: "X", kind: "franchise" }),
    );
    expect(response.status).toBe(422);
  });

  it("answers an unknown account with an honest 404", async () => {
    client({ crm_accounts: [{ data: null, error: null }] });
    const response = await readAccount(
      new Request("https://factory.example/api/services/accounts/x"),
      { params: Promise.resolve({ accountId }) },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("account_not_found");
  });
});

describe("the timeline boundary", () => {
  it("records a hand-entered call with the actor who recorded it", async () => {
    client({
      crm_timeline_events: [{
        data: {
          id: "30000000-0000-4000-8000-0000000c0001",
          account_id: accountId,
          kind: "call",
          summary: "Intro call.",
          detail: null,
          occurred_at: "2026-08-30T09:00:00Z",
          recorded_at: "2026-08-30T09:05:00Z",
          actor_user_id: userId,
        },
        error: null,
      }],
    });
    const response = await recordEvent(
      post(`https://factory.example/api/services/accounts/${accountId}/timeline`,
        { kind: "call", summary: "Intro call." }),
      { params: Promise.resolve({ accountId }) },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.event).toMatchObject({ kind: "call", recordedBySystem: false });
  });

  it("refuses the system kinds a person must not type into the audit trail", async () => {
    client({ crm_timeline_events: [{ data: null, error: null }] });
    for (const kind of ["status_change", "service", "payment"]) {
      const response = await recordEvent(
        post(`https://factory.example/api/services/accounts/${accountId}/timeline`,
          { kind, summary: "Forged history." }),
        { params: Promise.resolve({ accountId }) },
      );
      expect(response.status).toBe(422);
    }
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("refuses an account id that is not a UUID before the database", async () => {
    client({ crm_timeline_events: [{ data: null, error: null }] });
    const response = await recordEvent(
      post("https://factory.example/api/services/accounts/nope/timeline",
        { kind: "note", summary: "x" }),
      { params: Promise.resolve({ accountId: "nope" }) },
    );
    expect(response.status).toBe(400);
  });
});

const opportunityId = "40000000-0000-4000-8000-0000000c0001";
const opportunityRow = {
  id: opportunityId,
  account_id: accountId,
  name: "Quarterly IPM program",
  stage: "new",
  value_cents: 240000,
  expected_close_date: null,
  notes: null,
  lost_reason: null,
  closed_at: null,
  created_at: "2026-08-30T10:00:00Z",
  updated_at: "2026-08-30T10:00:00Z",
};

function patch(url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("the pipeline boundary", () => {
  it("lists the pipeline with a report computed over the whole book", async () => {
    client({
      crm_opportunities: [
        { data: [opportunityRow], error: null },
        {
          data: [
            { stage: "new", value_cents: 240000 },
            { stage: "won", value_cents: 100000 },
            { stage: "lost", value_cents: null },
          ],
          error: null,
        },
      ],
    });
    const response = await listOpportunities(
      new Request("https://factory.example/api/services/opportunities?stage=new"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.opportunities[0]).toMatchObject({
      id: opportunityId,
      valueCents: 240000,
      stage: "new",
    });
    expect(body.report).toMatchObject({
      openCount: 1,
      openValueCents: 240000,
      wonCount: 1,
      wonValueCents: 100000,
      lostCount: 1,
      winRatePercent: 50,
    });
  });

  it("records a new deal with the exact tenant identity, only in an open stage", async () => {
    client({ crm_opportunities: [{ data: opportunityRow, error: null }] });
    const response = await createOpportunity(
      post("https://factory.example/api/services/opportunities", {
        accountId,
        name: "Quarterly IPM program",
        valueCents: 240000,
      }),
    );
    expect(response.status).toBe(201);
    const table = from.mock.results[0]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId,
      account_id: accountId,
      created_by: userId,
      stage: "new",
      value_cents: 240000,
    }));

    // Born-closed deals never went through the pipeline.
    const refused = await createOpportunity(
      post("https://factory.example/api/services/opportunities", {
        accountId,
        name: "Fabricated win",
        stage: "won",
      }),
    );
    expect(refused.status).toBe(422);
  });

  it("answers a deal on a foreign or missing account with an honest 404", async () => {
    client({ crm_opportunities: [{ data: null, error: { code: "23503", message: "fk" } }] });
    const response = await createOpportunity(
      post("https://factory.example/api/services/opportunities", {
        accountId,
        name: "Orphan deal",
      }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("account_not_found");
  });

  it("refuses a loss reason that does not travel with a move to lost", async () => {
    client({ crm_opportunities: [{ data: opportunityRow, error: null }] });
    const response = await patchOpportunity(
      patch(`https://factory.example/api/services/opportunities/${opportunityId}`, {
        lostReason: "Too expensive",
      }),
      { params: Promise.resolve({ opportunityId }) },
    );
    expect(response.status).toBe(422);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("clears the loss reason when a deal leaves lost", async () => {
    client({
      crm_opportunities: [{ data: { ...opportunityRow, stage: "contacted" }, error: null }],
    });
    const response = await patchOpportunity(
      patch(`https://factory.example/api/services/opportunities/${opportunityId}`, {
        stage: "contacted",
      }),
      { params: Promise.resolve({ opportunityId }) },
    );
    expect(response.status).toBe(200);
    const table = from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    expect(table.update).toHaveBeenCalledWith({ stage: "contacted", lost_reason: null });
  });
});

describe("the demo-seed boundary", () => {
  it("refuses a cross-origin post before touching anything", async () => {
    client({ crm_accounts: [{ data: null, error: null, count: 0 }] });
    const response = await seedDemo(
      post("https://factory.example/api/services/demo-seed", {}, "https://evil.example"),
    );
    expect(response.ok).toBe(false);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("seeds only an empty book — a workspace with accounts answers 409", async () => {
    client({ crm_accounts: [{ data: null, error: null, count: 3 }] });
    const response = await seedDemo(post("https://factory.example/api/services/demo-seed", {}));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("book_not_empty");
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("seeds an empty book through the caller's own session and reports the counts", async () => {
    client({ crm_accounts: [{ data: null, error: null, count: 0 }] });
    const seededCounts = {
      accounts: 14,
      contacts: 18,
      properties: 18,
      opportunities: 15,
      timelineEvents: 90,
    };
    seedDemoData.mockResolvedValue({ seeded: seededCounts });
    const response = await seedDemo(post("https://factory.example/api/services/demo-seed", {}));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ seeded: seededCounts });
    expect(seedDemoData).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(Function) }),
      organizationId,
      userId,
    );
  });
});

describe("the search boundary", () => {
  it("searches every record type inside the organization and de-duplicates the hits", async () => {
    const contactRow = {
      id: "50000000-0000-4000-8000-0000000c0001",
      account_id: accountId,
      first_name: "Dana",
      last_name: "Reyes",
      role: null,
      email: "dana@harborview.example",
      phone: null,
      is_primary: true,
      created_at: "2026-08-30T10:00:00Z",
    };
    const propertyRow = {
      id: "60000000-0000-4000-8000-0000000c0001",
      account_id: accountId,
      label: "Distribution Center",
      address: "14 Dock Road, Portsview",
      property_type: null,
      access_notes: null,
      created_at: "2026-08-30T10:00:00Z",
    };
    client({
      // The same account matches by name AND email: one hit, not two.
      crm_accounts: [
        { data: [accountRow], error: null },
        { data: [accountRow], error: null },
      ],
      crm_contacts: [
        { data: [contactRow], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ],
      crm_properties: [
        { data: [], error: null },
        { data: [propertyRow], error: null },
      ],
      crm_opportunities: [{ data: [opportunityRow], error: null }],
    });
    const response = await searchBook(
      new Request("https://factory.example/api/services/search?q=harborview"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.contacts[0]).toMatchObject({ firstName: "Dana", accountId });
    expect(body.properties[0]).toMatchObject({ label: "Distribution Center", accountId });
    expect(body.opportunities[0]).toMatchObject({ name: "Quarterly IPM program", accountId });
  });

  it("refuses a needle too short to mean anything", async () => {
    client({ crm_accounts: [{ data: [], error: null }] });
    const response = await searchBook(
      new Request("https://factory.example/api/services/search?q=a"),
    );
    expect(response.status).toBe(400);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });
});
