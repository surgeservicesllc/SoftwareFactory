// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization, requireAuthenticatedUser } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/supabase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/auth")>()),
  requireAuthenticatedUser,
}));

import { GET as portalSummary } from "@/app/api/customer-portal/route";
import { GET as portalInvoices } from "@/app/api/customer-portal/invoices/route";
import { GET as portalDocuments } from "@/app/api/customer-portal/documents/route";
import { GET as myRequests, POST as submitRequest } from "@/app/api/customer-portal/requests/route";
import { POST as acceptInvitation } from "@/app/api/customer-portal/accept/route";
import { GET as listPortalUsers, PATCH as patchPortalUser, POST as invite } from "@/app/api/services/portal/route";
import { GET as listRequests, PATCH as triageRequest } from "@/app/api/services/portal/requests/route";

/**
 * The portal boundary's conduct, on both sides of it.
 *
 * The behavior suite proves the database refuses what it must. This file
 * pins what the ROUTES promise, and the promises worth pinning are the ones
 * a careless refactor would quietly break: a caller with no portal link
 * gets one flat 403 with nothing in it; a route never lets the caller name
 * an account; the two provider-gated controls stay labelled Not Connected
 * rather than rendering as available; a staff triage writes a reply without
 * touching the customer's own words; and closing a request supplies the
 * moment it closed rather than leaving the schema to refuse the pair.
 */

const organizationId = "10000000-0000-4000-8000-0000000b0001";
const userId = "00000000-0000-4000-8000-0000000b0001";
const accountId = "20000000-0000-4000-8000-0000000b0001";
const portalUserId = "30000000-0000-4000-8000-0000000b0001";
const requestId = "40000000-0000-4000-8000-0000000b0001";

type QueryResult = { data: unknown; error: unknown };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "in", "order", "limit"]) {
    builder[method] = vi.fn(chain);
  }
  const next = () => Promise.resolve(results[Math.min(call++, results.length - 1)]);
  builder.single = vi.fn(next);
  builder.maybeSingle = vi.fn(next);
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => next().then(onFulfilled);
  return builder;
}

let from: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;
let tables: Map<string, ReturnType<typeof stubTable>>;

/** A staff caller: an organization member, reading through RLS. */
function staffClient(results: Record<string, QueryResult[]>) {
  tables = new Map();
  from = vi.fn((table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created = stubTable(results[table] ?? [{ data: [], error: null }]);
    tables.set(table, created);
    return created;
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { from },
  });
}

/** A portal caller: signed in, not a member, reachable only through RPC. */
function portalClient(responses: Record<string, QueryResult>) {
  rpc = vi.fn((name: string) =>
    Promise.resolve(responses[name] ?? { data: null, error: null }),
  );
  requireAuthenticatedUser.mockResolvedValue({ client: { rpc }, user: { id: userId } });
}

const linked = {
  crm_portal_me: {
    data: [
      {
        organization_id: organizationId,
        account_id: accountId,
        portal_user_id: portalUserId,
        role: "payer",
      },
    ],
    error: null,
  },
};

function send(method: "POST" | "PATCH", url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://factory.example");
});

describe("the customer's side of the portal", () => {
  it("refuses a signed-in caller with no portal link, and says nothing else", async () => {
    portalClient({ crm_portal_me: { data: [], error: null } });
    const response = await portalSummary();
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("portal_access_required");
    // Not "no such account", not a row count, not the organization: one
    // flat refusal that cannot be used to ask whether an account exists.
    expect(JSON.stringify(body)).not.toContain(accountId);
    expect(JSON.stringify(body)).not.toContain(organizationId);
  });

  it("reads the summary through the resolver, never an account the caller names", async () => {
    portalClient({
      ...linked,
      crm_portal_summary: {
        data: [
          {
            account_name: "Harborview Foods",
            account_status: "customer",
            open_invoices: 2,
            balance_cents: "125000",
            next_visit_on: null,
            open_requests: 1,
          },
        ],
        error: null,
      },
    });

    const response = await portalSummary();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: { accountName: string; nextVisitOn: string | null } };
    expect(body.summary.accountName).toBe("Harborview Foods");
    // Nothing scheduled reads as null, not as today.
    expect(body.summary.nextVisitOn).toBeNull();

    // Every call is argument-free. A route that accepted an account id
    // would be a route that could be pointed at somebody else's.
    for (const call of rpc.mock.calls) {
      expect(call[1]).toBeUndefined();
    }
    expect(rpc).toHaveBeenCalledWith("crm_portal_touch");
  });

  it("keeps paying and downloading labelled Not Connected", async () => {
    portalClient({
      ...linked,
      crm_portal_invoices: {
        data: [
          {
            id: "50000000-0000-4000-8000-0000000b0001",
            number: "INV-1",
            status: "open",
            total_cents: "50000",
            paid_cents: "0",
            balance_cents: "50000",
            issued_on: "2026-01-02",
            due_on: "1999-01-01",
          },
        ],
        error: null,
      },
      crm_portal_documents: { data: [], error: null },
    });

    const invoices = (await (await portalInvoices()).json()) as {
      invoices: { overdue: boolean; balanceCents: number }[];
      counts: { overdue: number; balanceCents: number };
      payment: { available: boolean; label: string };
    };
    expect(invoices.payment).toEqual({ available: false, label: "Not Connected" });
    expect(invoices.invoices[0].overdue).toBe(true);
    expect(invoices.counts.balanceCents).toBe(50_000);

    const documents = (await (await portalDocuments()).json()) as {
      download: { available: boolean; label: string };
    };
    expect(documents.download).toEqual({ available: false, label: "Not Connected" });
  });

  it("counts the requests still waiting on a human apart from the merely open", async () => {
    portalClient({
      ...linked,
      crm_portal_requests_mine: {
        data: [
          {
            id: requestId,
            kind: "service",
            status: "acknowledged",
            summary: "Ants again",
            detail: null,
            preferred_date: null,
            response: "Booked for Tuesday.",
            submitted_at: "2026-08-01T00:00:00.000Z",
            resolved_at: null,
          },
          {
            id: "40000000-0000-4000-8000-0000000b0002",
            kind: "question",
            status: "submitted",
            summary: "What was applied",
            detail: null,
            preferred_date: null,
            response: null,
            submitted_at: "2026-08-02T00:00:00.000Z",
            resolved_at: null,
          },
        ],
        error: null,
      },
    });

    const body = (await (await myRequests()).json()) as {
      counts: { open: number; awaitingReply: number };
    };
    expect(body.counts.open).toBe(2);
    // One of the two has been answered, so only one is actually waiting.
    expect(body.counts.awaitingReply).toBe(1);
  });

  it("turns the database's refusal of somebody else's site into the customer's answer", async () => {
    portalClient({
      ...linked,
      crm_portal_submit_request: {
        data: null,
        error: { code: "23514", message: "that site is not on this account" },
      },
    });

    const response = await submitRequest(
      send("POST", "https://factory.example/api/customer-portal/requests", {
        kind: "service",
        summary: "Ants in the break room",
        propertyId: "60000000-0000-4000-8000-0000000b0001",
      }),
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "property_not_on_account",
    );
  });

  it("answers every accept failure the same way, whatever the reason was", async () => {
    for (const error of [
      { code: "P0002", message: "no open invitation for this address" },
      { code: "0L000", message: "no verified address to match an invitation against" },
    ]) {
      portalClient({ crm_portal_accept_invitation: { data: null, error } });
      const response = await acceptInvitation(
        send("POST", "https://factory.example/api/customer-portal/accept", {}),
      );
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("invitation_not_open");
      // "Never invited" and "already claimed" must not be told apart, or
      // this becomes a way to ask whether an address is a customer.
      expect(body.error.message).toBe("There is no open portal invitation for your address.");
    }
  });
});

describe("the staff side of the portal", () => {
  const portalUserRow = {
    id: portalUserId,
    account_id: accountId,
    contact_id: null,
    user_id: null,
    email: "ap@harborview.example",
    role: "viewer",
    invited_at: "2026-06-01T00:00:00.000Z",
    activated_at: null,
    last_seen_at: null,
    active: true,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };

  it("reports the two figures a rollout is actually judged on", async () => {
    staffClient({
      crm_portal_users: [
        {
          data: [
            portalUserRow,
            {
              ...portalUserRow,
              id: "30000000-0000-4000-8000-0000000b0002",
              email: "manager@harborview.example",
              user_id: userId,
              activated_at: "2026-06-02T00:00:00.000Z",
              last_seen_at: "2026-08-20T00:00:00.000Z",
            },
          ],
          error: null,
        },
      ],
      crm_accounts: [
        {
          data: [
            { id: accountId, name: "Harborview Foods" },
            { id: "20000000-0000-4000-8000-0000000b0002", name: "Cedar Point Deli" },
            { id: "20000000-0000-4000-8000-0000000b0003", name: "Rivermill Bakery" },
          ],
          error: null,
        },
      ],
    });

    const body = (await (await listPortalUsers()).json()) as {
      portalUsers: { state: string; accountName: string | null; linked: boolean }[];
      counts: { active: number; invited: number; neverSignedIn: number; accountsWithoutPortal: number };
    };
    expect(body.portalUsers.map((row) => row.state)).toEqual(["invited", "active"]);
    expect(body.portalUsers[0].accountName).toBe("Harborview Foods");
    // The row says whether a login is attached, never which one.
    expect(body.portalUsers[0].linked).toBe(false);
    expect(body.counts.invited).toBe(1);
    expect(body.counts.active).toBe(1);
    expect(body.counts.neverSignedIn).toBe(1);
    // Three accounts, one of them served by the portal.
    expect(body.counts.accountsWithoutPortal).toBe(2);
  });

  it("invites an address and never a login", async () => {
    staffClient({ crm_portal_users: [{ data: portalUserRow, error: null }] });
    const response = await invite(
      send("POST", "https://factory.example/api/services/portal", {
        accountId,
        email: "ap@harborview.example",
        role: "payer",
      }),
    );
    expect(response.status).toBe(201);

    const inserted = (
      tables.get("crm_portal_users") as unknown as { insert: ReturnType<typeof vi.fn> }
    ).insert.mock.calls[0][0] as Record<string, unknown>;
    // Not present at all — not null, not the caller's own id. Attaching a
    // login is the customer's act, and the database refuses any other.
    expect(inserted).not.toHaveProperty("user_id");
    expect(inserted).not.toHaveProperty("activated_at");
  });

  it("refuses an address already invited on that account, without a 500", async () => {
    staffClient({ crm_portal_users: [{ data: null, error: { code: "23505" } }] });
    const response = await invite(
      send("POST", "https://factory.example/api/services/portal", {
        accountId,
        email: "ap@harborview.example",
      }),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "portal_user_exists",
    );
  });

  const requestRow = {
    id: requestId,
    account_id: accountId,
    property_id: null,
    portal_user_id: portalUserId,
    kind: "service",
    status: "resolved",
    summary: "Ants along the back wall again",
    detail: "Started after the weekend.",
    preferred_date: null,
    response: "Treated on the follow-up visit.",
    work_order_id: null,
    submitted_at: "2026-08-01T00:00:00.000Z",
    resolved_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
  };

  it("supplies the closing moment when a request is closed, and clears it when reopened", async () => {
    staffClient({ crm_portal_requests: [{ data: requestRow, error: null }] });
    await triageRequest(
      send("PATCH", "https://factory.example/api/services/portal/requests", {
        requestId,
        status: "resolved",
      }),
    );
    const closed = (
      tables.get("crm_portal_requests") as unknown as { update: ReturnType<typeof vi.fn> }
    ).update.mock.calls[0][0] as Record<string, unknown>;
    expect(closed.status).toBe("resolved");
    expect(typeof closed.resolved_at).toBe("string");

    staffClient({ crm_portal_requests: [{ data: { ...requestRow, status: "scheduled" }, error: null }] });
    await triageRequest(
      send("PATCH", "https://factory.example/api/services/portal/requests", {
        requestId,
        status: "scheduled",
      }),
    );
    const reopened = (
      tables.get("crm_portal_requests") as unknown as { update: ReturnType<typeof vi.fn> }
    ).update.mock.calls[0][0] as Record<string, unknown>;
    expect(reopened.resolved_at).toBeNull();
  });

  it("writes a reply without touching the words the customer wrote", async () => {
    staffClient({ crm_portal_requests: [{ data: requestRow, error: null }] });
    await triageRequest(
      send("PATCH", "https://factory.example/api/services/portal/requests", {
        requestId,
        response: "Booked for the next route through your area.",
      }),
    );
    const changes = (
      tables.get("crm_portal_requests") as unknown as { update: ReturnType<typeof vi.fn> }
    ).update.mock.calls[0][0] as Record<string, unknown>;
    expect(changes.response).toBe("Booked for the next route through your area.");
    expect(changes).not.toHaveProperty("summary");
    expect(changes).not.toHaveProperty("detail");
  });

  it("rejects a triage that tries to rewrite the customer's own words", async () => {
    staffClient({ crm_portal_requests: [{ data: requestRow, error: null }] });
    const response = await triageRequest(
      send("PATCH", "https://factory.example/api/services/portal/requests", {
        requestId,
        summary: "Something the customer never said",
      }),
    );
    expect(response.status).toBe(422);
  });

  it("counts the queue by who is still waiting on a human", async () => {
    staffClient({
      crm_portal_requests: [
        {
          data: [
            requestRow,
            { ...requestRow, id: "40000000-0000-4000-8000-0000000b0002", status: "submitted", response: null, resolved_at: null },
            { ...requestRow, id: "40000000-0000-4000-8000-0000000b0003", status: "acknowledged", response: "Looking into it.", resolved_at: null },
          ],
          error: null,
        },
      ],
    });
    const body = (await (
      await listRequests(new Request("https://factory.example/api/services/portal/requests"))
    ).json()) as { counts: { open: number; awaitingReply: number; byStatus: Record<string, number> } };
    expect(body.counts.open).toBe(2);
    expect(body.counts.awaitingReply).toBe(1);
    expect(body.counts.byStatus.resolved).toBe(1);
  });

  it("suspends a portal login without being able to reassign it", async () => {
    staffClient({ crm_portal_users: [{ data: { ...portalUserRow, active: false }, error: null }] });
    const response = await patchPortalUser(
      send("PATCH", "https://factory.example/api/services/portal", {
        portalUserId,
        active: false,
      }),
    );
    expect(response.status).toBe(200);
    const changes = (
      tables.get("crm_portal_users") as unknown as { update: ReturnType<typeof vi.fn> }
    ).update.mock.calls[0][0] as Record<string, unknown>;
    expect(changes).toEqual({ active: false });

    // And the schema has no seat for a caller-supplied login.
    const refused = await patchPortalUser(
      send("PATCH", "https://factory.example/api/services/portal", {
        portalUserId,
        userId: "00000000-0000-4000-8000-0000000b0009",
      }),
    );
    expect(refused.status).toBe(422);
  });
});
