// @vitest-environment node

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireActiveOrganization = vi.fn();
vi.mock("@/lib/supabase/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/tenant")>(
    "@/lib/supabase/tenant",
  );
  return { ...actual, requireActiveOrganization };
});

// A real 32-byte key: the code route seals for real, and the test opens the
// envelope back to prove the binding, so the store must genuinely work.
process.env.SOFTWAREFACTORY_CREDENTIAL_KEY = randomBytes(32).toString("base64");

const { planConnect, relayCodePurpose } = await import("@/lib/ai-accounts/broker");
const { openSecret } = await import("@/lib/server/secret-box");
const { GET: listAccounts } = await import("@/app/api/ai-accounts/route");
const { POST: connect } = await import("@/app/api/ai-accounts/connect/route");
const { GET: readSession } = await import("@/app/api/ai-accounts/sessions/[sessionId]/route");
const { POST: postCode } = await import("@/app/api/ai-accounts/sessions/[sessionId]/code/route");
const { POST: cancel } = await import("@/app/api/ai-accounts/sessions/[sessionId]/cancel/route");
const { POST: disconnect } = await import("@/app/api/ai-accounts/[accountId]/disconnect/route");

const organizationId = "11111111-2222-4333-8444-555555555555";
const accountId = "22222222-3333-4444-8555-666666666666";
const sessionId = "33333333-4444-4555-8666-777777777777";

type AccountRow = {
  account_id: string;
  provider: string;
  auth_method: string;
  display_name: string;
  status: string;
  credential_purpose: string;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    account_id: accountId,
    provider: "anthropic",
    auth_method: "subscription",
    display_name: "Claude account 1",
    status: "connected",
    credential_purpose: "claude",
    last_verified_at: null,
    last_error: null,
    created_at: "2026-08-16T10:00:00.000Z",
    updated_at: "2026-08-16T10:00:00.000Z",
    ...overrides,
  };
}

const rpc = vi.fn();
const client = { rpc };

function post(path: string, body?: unknown) {
  return new Request(`https://factory.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "https://factory.test", host: "factory.test" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

function sessionParams() {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client,
  });
  rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("planConnect", () => {
  it("creates on the first free slot with the slot visible in the name", () => {
    expect(planConnect("anthropic", [])).toEqual({
      kind: "create", displayName: "Claude account 1", purpose: "claude",
    });
    expect(planConnect("anthropic", [accountRow()])).toEqual({
      kind: "create", displayName: "Claude account 2", purpose: "claude_2",
    });
  });

  it("prefers reconnecting an account that is not connected over creating another", () => {
    const plan = planConnect("anthropic", [
      accountRow({ account_id: "aa", status: "disconnected", credential_purpose: "claude" }),
    ]);
    expect(plan).toEqual({ kind: "reuse", accountId: "aa" });
  });

  it("keeps creating past three — accounts have no hard-coded maximum", () => {
    const plan = planConnect("anthropic", [
      accountRow({ account_id: "a1", credential_purpose: "claude" }),
      accountRow({ account_id: "a2", credential_purpose: "claude_2", display_name: "Claude account 2" }),
      accountRow({ account_id: "a3", credential_purpose: "claude_3", display_name: "Claude account 3" }),
    ]);
    expect(plan).toEqual({
      kind: "create", displayName: "Claude account 4", purpose: "claude_4",
    });
  });

  it("fills a gap left by an earlier slot before extending the range", () => {
    const plan = planConnect("anthropic", [
      accountRow({ account_id: "a1", credential_purpose: "claude" }),
      accountRow({ account_id: "a3", credential_purpose: "claude_3", display_name: "Claude account 3" }),
    ]);
    expect(plan).toEqual({
      kind: "create", displayName: "Claude account 2", purpose: "claude_2",
    });
  });

  it("reports full only at the configured capacity ceiling", () => {
    const accounts = [
      accountRow({ account_id: "a1", credential_purpose: "claude" }),
      accountRow({ account_id: "a2", credential_purpose: "claude_2", display_name: "Claude account 2" }),
    ];
    expect(planConnect("anthropic", accounts, undefined, 2)).toEqual({ kind: "full" });
    expect(planConnect("anthropic", accounts, undefined, 3)).toMatchObject({ kind: "create" });
  });

  it("treats an explicitly named account as the reconnect it is", () => {
    expect(planConnect("anthropic", [], "explicit-id")).toEqual({
      kind: "reuse", accountId: "explicit-id",
    });
  });
});

describe("POST /api/ai-accounts/connect", () => {
  it("creates an account on a free slot and opens a session on it", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "list_ai_accounts") return { data: [], error: null };
      if (fn === "create_ai_account") return { data: accountId, error: null };
      if (fn === "open_ai_auth_session") return { data: sessionId, error: null };
      return { data: null, error: null };
    });

    const response = await connect(post("/api/ai-accounts/connect", { provider: "anthropic" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accountId, sessionId });
    expect(rpc).toHaveBeenCalledWith("create_ai_account", {
      p_organization_id: organizationId,
      p_provider: "anthropic",
      p_auth_method: "subscription",
      p_display_name: "Claude account 1",
      p_credential_purpose: "claude",
    });
    expect(rpc).toHaveBeenCalledWith("open_ai_auth_session", {
      p_organization_id: organizationId,
      p_ai_account_id: accountId,
      p_ttl_seconds: 900,
    });
  });

  it("resumes an open session on refresh instead of superseding it", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "list_ai_accounts") {
        return { data: [accountRow({ status: "pending" })], error: null };
      }
      if (fn === "find_open_ai_auth_session") {
        return {
          data: [{
            open_session_id: sessionId,
            open_status: "awaiting_user",
            open_expires_at: new Date(Date.now() + 600_000).toISOString(),
          }],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const response = await connect(post("/api/ai-accounts/connect", { provider: "anthropic" }));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ sessionId, resumed: true });
    // The session a worker may already be driving is NOT superseded.
    expect(rpc).not.toHaveBeenCalledWith("open_ai_auth_session", expect.anything());
  });

  it("reuses a disconnected account rather than burning a slot", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "list_ai_accounts") {
        return { data: [accountRow({ status: "disconnected" })], error: null };
      }
      if (fn === "open_ai_auth_session") return { data: sessionId, error: null };
      return { data: null, error: null };
    });

    const response = await connect(post("/api/ai-accounts/connect", { provider: "anthropic" }));

    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalledWith("create_ai_account", expect.anything());
  });

  it("refuses only at the configured capacity, never at a built-in count", async () => {
    vi.stubEnv("SOFTWAREFACTORY_MAX_AI_ACCOUNTS_PER_PROVIDER", "3");
    try {
      rpc.mockImplementation(async (fn: string) => {
        if (fn === "list_ai_accounts") {
          return {
            data: [
              accountRow({ account_id: "a1", credential_purpose: "claude" }),
              accountRow({ account_id: "a2", credential_purpose: "claude_2" }),
              accountRow({ account_id: "a3", credential_purpose: "claude_3" }),
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const response = await connect(post("/api/ai-accounts/connect", { provider: "anthropic" }));

      expect(response.status).toBe(409);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("creates a fourth account when capacity allows — no hard-coded maximum", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "list_ai_accounts") {
        return {
          data: [
            accountRow({ account_id: "a1", credential_purpose: "claude" }),
            accountRow({ account_id: "a2", credential_purpose: "claude_2" }),
            accountRow({ account_id: "a3", credential_purpose: "claude_3" }),
          ],
          error: null,
        };
      }
      if (fn === "create_ai_account") return { data: accountId, error: null };
      if (fn === "open_ai_auth_session") return { data: sessionId, error: null };
      return { data: null, error: null };
    });

    const response = await connect(post("/api/ai-accounts/connect", { provider: "anthropic" }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_ai_account", expect.objectContaining({
      p_credential_purpose: "claude_4",
      p_display_name: "Claude account 4",
    }));
  });

  it("refuses a provider without broker sign-in", async () => {
    const response = await connect(post("/api/ai-accounts/connect", { provider: "google" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a member", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client,
    });
    const response = await connect(post("/api/ai-accounts/connect", { provider: "anthropic" }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/ai-accounts", () => {
  it("lists identity and lifecycle, never a credential", async () => {
    rpc.mockResolvedValue({ data: [accountRow()], error: null });

    const response = await listAccounts();
    const body = await response.json() as { accounts: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.accounts[0]).toMatchObject({
      id: accountId,
      provider: "anthropic",
      providerLabel: "Claude",
      displayName: "Claude account 1",
      status: "connected",
    });
    expect(JSON.stringify(body)).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
  });
});

describe("GET /api/ai-accounts/sessions/[sessionId]", () => {
  it("returns the projection the browser polls", async () => {
    rpc.mockResolvedValue({
      data: [{
        session_id: sessionId,
        session_account_id: accountId,
        status: "awaiting_user",
        login_url: "https://claude.ai/oauth/authorize?x=1",
        failure_reason: null,
        heartbeat_at: "2026-08-16T10:00:05.000Z",
        expires_at: "2026-08-16T10:15:00.000Z",
        updated_at: "2026-08-16T10:00:05.000Z",
      }],
      error: null,
    });

    const response = await readSession(
      new Request("https://factory.test/api/ai-accounts/sessions/x"),
      sessionParams(),
    );
    const body = await response.json() as { session: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.session).toMatchObject({
      status: "awaiting_user",
      loginUrl: "https://claude.ai/oauth/authorize?x=1",
    });
    expect(body.session).not.toHaveProperty("relayCodeSealed");
  });

  it("says not found for a session outside the organization", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const response = await readSession(
      new Request("https://factory.test/api/ai-accounts/sessions/x"),
      sessionParams(),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/ai-accounts/sessions/[sessionId]/code", () => {
  it("seals the pasted code bound to this session before it is stored", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    const response = await postCode(
      post(`/api/ai-accounts/sessions/${sessionId}/code`, { code: "AC-1234-XYZZY" }),
      sessionParams(),
    );

    expect(response.status).toBe(200);
    const call = rpc.mock.calls.find(([fn]) => fn === "attach_ai_auth_relay_code");
    const sealed = (call?.[1] as { p_relay_code_sealed: string }).p_relay_code_sealed;
    // Sealed, not plaintext…
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("AC-1234-XYZZY");
    // …and bound to exactly this session: it opens under the session purpose.
    expect(openSecret(sealed, {
      organizationId,
      purpose: relayCodePurpose(sessionId),
    })).toBe("AC-1234-XYZZY");
  });

  it("reads one refusal for a session that stopped waiting", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const response = await postCode(
      post(`/api/ai-accounts/sessions/${sessionId}/code`, { code: "AC-1234-XYZZY" }),
      sessionParams(),
    );
    expect(response.status).toBe(409);
  });

  it("refuses free text where a code belongs", async () => {
    const response = await postCode(
      post(`/api/ai-accounts/sessions/${sessionId}/code`, { code: "not a code at all" }),
      sessionParams(),
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("session cancel and account disconnect", () => {
  it("cancels through the owner-side function", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const response = await cancel(
      post(`/api/ai-accounts/sessions/${sessionId}/cancel`),
      sessionParams(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cancelled: true });
    expect(rpc).toHaveBeenCalledWith("cancel_ai_auth_session", {
      p_organization_id: organizationId,
      p_session_id: sessionId,
    });
  });

  it("disconnects through the credential-deleting function", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const response = await disconnect(
      post(`/api/ai-accounts/${accountId}/disconnect`),
      { params: Promise.resolve({ accountId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ disconnected: true });
    expect(rpc).toHaveBeenCalledWith("disconnect_ai_account", {
      p_organization_id: organizationId,
      p_ai_account_id: accountId,
    });
  });

  it("refuses a member for both", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client,
    });
    const cancelResponse = await cancel(
      post(`/api/ai-accounts/sessions/${sessionId}/cancel`),
      sessionParams(),
    );
    const disconnectResponse = await disconnect(
      post(`/api/ai-accounts/${accountId}/disconnect`),
      { params: Promise.resolve({ accountId }) },
    );
    expect(cancelResponse.status).toBe(403);
    expect(disconnectResponse.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
