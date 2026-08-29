// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/job-seeker/saved-searches/route";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";

const organizationId = "10000000-0000-4000-8000-000000000042";
const searchId = "11111111-2222-4333-8444-555555555555";

const row = {
  id: searchId,
  name: "Remote marketing",
  query: { text: "marketing", filters: { keywords: ["remote"] } },
  last_run_at: null,
  created_at: "2026-08-29T14:00:00Z",
  updated_at: "2026-08-29T14:00:00Z",
};

/**
 * A chainable query stub: every builder method returns itself, and the
 * terminal reads resolve to whatever the test staged. `calls` records the
 * filters applied, because the ownership scoping IS the behavior under test.
 */
function stubTable(result: { data?: unknown; error?: { code?: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    });
  }
  chain.single = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  chain.maybeSingle = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  chain.then = undefined; // never awaited directly except via single/maybeSingle…
  return { chain, calls };
}

function clientWith(result: { data?: unknown; error?: { code?: string } | null }, listRows?: unknown[]) {
  const { chain, calls } = stubTable(result);
  // GET awaits the chain itself; make it thenable resolving the list.
  (chain as { then?: unknown }).then = (resolve: (value: unknown) => void) =>
    resolve({ data: listRows ?? [row], error: null });
  return { client: { from: vi.fn(() => chain) }, calls };
}

function request(method: string, body: unknown) {
  return new Request("https://factory.example/api/job-seeker/saved-searches", {
    method,
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

function signIn(result: { data?: unknown; error?: { code?: string } | null }, listRows?: unknown[]) {
  const { client, calls } = clientWith(result, listRows);
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: "user-1" },
    client,
  });
  return calls;
}

describe("saved searches", () => {
  it("refuses a signed-out caller", async () => {
    harness.requireActiveOrganization.mockRejectedValue(
      new SupabaseAuthenticationError("authentication_required", "Authentication is required."),
    );
    expect((await GET()).status).toBeGreaterThanOrEqual(401);
    expect((await POST(request("POST", { name: "x", query: { text: "y" } }))).status)
      .toBeGreaterThanOrEqual(401);
  });

  it("lists only the signed-in person's rows in their workspace", async () => {
    const calls = signIn({});
    const response = await GET();
    const payload = (await response.json()) as { savedSearches: Array<{ id: string; lastRunAt: string | null }> };

    expect(payload.savedSearches[0]?.id).toBe(searchId);
    const eqs = calls.filter(([method]) => method === "eq").map(([, column, value]) => [column, value]);
    expect(eqs).toContainEqual(["organization_id", organizationId]);
    expect(eqs).toContainEqual(["user_id", "user-1"]);
  });

  it("creates a search bound to the caller, never to ids from the payload", async () => {
    const calls = signIn({ data: row });
    const response = await POST(request("POST", {
      name: "Remote marketing",
      query: { text: "marketing", filters: { keywords: ["remote"] } },
    }));

    expect(response.status).toBe(201);
    const inserted = calls.find(([method]) => method === "insert")?.[1] as Record<string, unknown>;
    expect(inserted.organization_id).toBe(organizationId);
    expect(inserted.user_id).toBe("user-1");
  });

  it("answers a duplicate name with a clear conflict, not a raw database error", async () => {
    signIn({ error: { code: "23505" } });
    const response = await POST(request("POST", { name: "Remote marketing", query: { text: "m" } }));
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("saved_search_name_taken");
  });

  it("refuses a query shape it does not recognise", async () => {
    signIn({ data: row });
    const response = await POST(request("POST", {
      name: "x",
      query: { text: "y", surprise: { nested: true } },
    }));
    expect(response.status).toBe(422);
  });

  it("refuses a credential-shaped value instead of persisting it", async () => {
    signIn({ data: row });
    const response = await POST(request("POST", {
      name: "sneaky",
      query: { text: "ghp_0123456789abcdef0123456789abcdef012345" },
    }));
    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("sensitive_content");
  });

  it("records a run through markRun", async () => {
    const calls = signIn({ data: { ...row, last_run_at: "2026-08-29T14:05:00Z" } });
    const response = await PATCH(request("PATCH", { id: searchId, markRun: true }));

    expect(response.status).toBe(200);
    const updated = calls.find(([method]) => method === "update")?.[1] as Record<string, unknown>;
    expect(typeof updated.last_run_at).toBe("string");
  });

  it("answers 404 for a row that is not the caller's, identically to one that does not exist", async () => {
    signIn({ data: null });
    expect((await PATCH(request("PATCH", { id: searchId, name: "renamed" }))).status).toBe(404);
    expect((await DELETE(request("DELETE", { id: searchId }))).status).toBe(404);
  });

  it("deletes with both ownership filters applied", async () => {
    const calls = signIn({ data: { id: searchId } });
    const response = await DELETE(request("DELETE", { id: searchId }));
    expect(response.status).toBe(200);
    const eqs = calls.filter(([method]) => method === "eq").map(([, column, value]) => [column, value]);
    expect(eqs).toContainEqual(["organization_id", organizationId]);
    expect(eqs).toContainEqual(["user_id", "user-1"]);
  });

  it("refuses a cross-origin mutation", async () => {
    signIn({ data: row });
    const response = await POST(new Request("https://factory.example/api/job-seeker/saved-searches", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ name: "x", query: { text: "y" } }),
    }));
    expect(response.ok).toBe(false);
  });
});
