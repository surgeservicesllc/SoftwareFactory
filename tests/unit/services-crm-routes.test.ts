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

import { GET as listAccounts, POST as createAccount } from "@/app/api/services/accounts/route";
import { GET as readAccount } from "@/app/api/services/accounts/[accountId]/route";
import { POST as recordEvent } from "@/app/api/services/accounts/[accountId]/timeline/route";

/**
 * The CRM routes' own conduct: the database owns tenancy and immutability
 * (proved in the behavior suite); this file pins what the boundary itself
 * promises — org-scoped reads, exact inserts, the manual timeline refusing
 * system kinds, honest 404s, and cross-origin posts refused before anything
 * is touched.
 */

const organizationId = "10000000-0000-4000-8000-0000000c0001";
const userId = "00000000-0000-4000-8000-0000000c0001";
const accountId = "20000000-0000-4000-8000-0000000c0001";

type QueryResult = { data: unknown; error: unknown };

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
    client({ crm_accounts: [{ data: accountRow, error: null }] });
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
