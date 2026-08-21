// @vitest-environment node

import { createHash, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireActiveOrganization = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/tenant")>(
    "@/lib/supabase/tenant",
  );
  return { ...actual, requireActiveOrganization };
});

vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc }),
}));

const { POST: startConnect } = await import("@/app/api/bots/connect/route");
const { POST: claimConnect } = await import("@/app/api/bots/connect/claim/route");

/**
 * The sign-in pair. The start route mints a bearer code; the claim route is the
 * only place in the application that accepts credential material.
 *
 * So the assertions concentrate on the two ways this could go wrong quietly:
 * a code or token appearing somewhere it should not, and a failure that tells
 * an attacker which guess was closer.
 */

const organizationId = "11111111-2222-4333-8444-555555555555";
const token = "sk-ant-oat01-a-real-looking-subscription-token";

function startRequest(body: unknown, origin = "https://factory.test") {
  return new Request(`${origin}/api/bots/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin, host: "factory.test" },
    body: JSON.stringify(body),
  });
}

function claimRequest(body: unknown) {
  return new Request("https://factory.test/api/bots/connect/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc: vi.fn(async () => ({ data: "session-id", error: null })) },
  });
  rpc.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("starting a sign-in", () => {
  it("returns a command carrying a fresh code", async () => {
    const response = await startConnect(startRequest({ purpose: "claude" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.command).toContain("scripts/connect.mts claude");
    expect(body.command).toContain("--host https://factory.test");
    expect(body.expiresInSeconds).toBe(600);
  });

  it("never stores the code in the clear, only its digest", async () => {
    const rpcSpy = vi.fn(
      async (_name: string, _args: Record<string, unknown>) => ({ data: "session-id", error: null }),
    );
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "owner" },
      client: { rpc: rpcSpy },
    });

    const response = await startConnect(startRequest({ purpose: "claude" }));
    const body = await response.json();
    const code = String(body.command).split("--code ")[1].split(" ")[0];

    const sent = rpcSpy.mock.calls[0]![1] as Record<string, string>;
    // Reading the sessions table must not let anyone claim a pending sign-in.
    expect(sent.p_code_digest).toBe(createHash("sha256").update(code).digest("hex"));
    expect(JSON.stringify(sent)).not.toContain(code);
  });

  it("accepts any numbered account slot — there is no hard-coded maximum", async () => {
    const rpcSpy = vi.fn(
      async (_name: string, _args: Record<string, unknown>) => ({ data: "session-id", error: null }),
    );
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "owner" },
      client: { rpc: rpcSpy },
    });

    const response = await startConnect(startRequest({ purpose: "claude_47" }));

    expect(response.status).toBe(200);
    expect((rpcSpy.mock.calls[0]![1] as Record<string, string>).p_purpose).toBe("claude_47");
    // `claude_1` is not a slot name — slot 1 is the bare purpose. Accepting
    // both would give one account two credential rows.
    expect((await startConnect(startRequest({ purpose: "claude_1" }))).status).toBe(400);
  });

  it("issues a different code every time", async () => {
    const first = await (await startConnect(startRequest({ purpose: "claude" }))).json();
    const second = await (await startConnect(startRequest({ purpose: "claude" }))).json();

    expect(first.command).not.toBe(second.command);
  });

  it("refuses before minting a code when no credential key is configured", async () => {
    vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", "");

    const response = await startConnect(startRequest({ purpose: "claude" }));

    // A code that could never be redeemed would fail minutes later on the
    // operator's machine with no explanation.
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("credential_store_not_configured");
  });

  it("refuses an unknown provider and a cross-origin post", async () => {
    expect((await startConnect(startRequest({ purpose: "not-a-provider" }))).status).toBe(400);

    const foreign = new Request("https://factory.test/api/bots/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://evil.test",
        host: "factory.test",
      },
      body: JSON.stringify({ purpose: "claude" }),
    });
    expect((await startConnect(foreign)).status).toBeGreaterThanOrEqual(400);
  });
});

describe("claiming a sign-in", () => {
  const code = "a".repeat(28);

  function resolveThenClaim() {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_provider_connect_session") {
        return {
          data: [{ session_organization_id: organizationId, session_purpose: "claude" }],
          error: null,
        };
      }
      return { data: [{ claimed_organization_id: organizationId, claimed_purpose: "claude" }], error: null };
    });
  }

  it("seals the token before it reaches the database", async () => {
    resolveThenClaim();

    const response = await claimConnect(claimRequest({ code, token }));

    expect(response.status).toBe(200);
    const claimCall = rpc.mock.calls.find(([name]) => name === "claim_provider_connect_session");
    const envelope = (claimCall?.[1] as Record<string, string>).p_sealed_envelope;

    // The token must be encrypted before storage, not after and not never.
    expect(envelope).toMatch(/^v1\./);
    expect(envelope).not.toContain(token);
    expect(envelope).not.toContain("sk-ant");
  });

  it("never returns the token, even on success", async () => {
    resolveThenClaim();

    const response = await claimConnect(claimRequest({ code, token }));
    const body = await response.json();

    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain("sk-ant");
    expect(body).toMatchObject({ connected: true, purpose: "claude" });
  });

  it("says the lookup is unavailable rather than calling a good code invalid", async () => {
    // `resolve_provider_connect_session` is absent from hosted (audit run
    // 32316446825). Reporting that as "not a valid link" sent operators to mint
    // another code, which failed the same way.
    rpc.mockImplementation(async (name: string) => (
      name === "resolve_provider_connect_session"
        ? { data: null, error: { message: "Could not find the function public.resolve_provider_connect_session" } }
        : { data: [], error: null }
    ));

    const response = await claimConnect(claimRequest({ code, token }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "connect_unavailable" } });
    // The credential never reaches a claim attempt on a lookup that failed.
    expect(rpc.mock.calls.some(([name]) => name === "claim_provider_connect_session")).toBe(false);
  });

  it("keeps that branch unreachable by choosing a code", async () => {
    // The oracle the uniform failures close stays closed: this branch depends
    // on the lookup working at all, never on which code was presented.
    rpc.mockResolvedValue({ data: [], error: null });
    const unknown = await claimConnect(claimRequest({ code, token }));
    const malformed = await claimConnect(claimRequest({ code: "short", token }));
    expect(unknown.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(await unknown.json())).toBe(JSON.stringify(await malformed.json()));
  });

  it("answers identically for an unknown, expired and spent code", async () => {
    const answers: Array<{ status: number; body: string }> = [];

    // Unknown or expired: resolve finds nothing.
    rpc.mockResolvedValue({ data: [], error: null });
    let response = await claimConnect(claimRequest({ code, token }));
    answers.push({ status: response.status, body: JSON.stringify(await response.json()) });

    // Spent: resolve succeeds, the claim loses the race.
    rpc.mockImplementation(async (name: string) => (
      name === "resolve_provider_connect_session"
        ? { data: [{ session_organization_id: organizationId, session_purpose: "claude" }], error: null }
        : { data: null, error: { message: "not valid" } }
    ));
    response = await claimConnect(claimRequest({ code, token }));
    answers.push({ status: response.status, body: JSON.stringify(await response.json()) });

    // Malformed.
    rpc.mockResolvedValue({ data: [], error: null });
    response = await claimConnect(claimRequest({ code: "short", token }));
    answers.push({ status: response.status, body: JSON.stringify(await response.json()) });

    // Anything that separates these turns the endpoint into an oracle for
    // guessing codes.
    expect(new Set(answers.map((entry) => entry.body)).size).toBe(1);
    expect(new Set(answers.map((entry) => entry.status)).size).toBe(1);
  });

  it("never leaks the token when something throws", async () => {
    rpc.mockImplementation(async () => {
      throw new Error(`upstream failed while sending ${token}`);
    });

    const response = await claimConnect(claimRequest({ code, token }));
    const body = JSON.stringify(await response.json());

    // An exception can carry the token in a message or a request context.
    expect(body).not.toContain(token);
    expect(body).not.toContain("sk-ant");
  });

  it("does not store anything when the session cannot be resolved", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await claimConnect(claimRequest({ code, token }));

    expect(rpc.mock.calls.some(([name]) => name === "claim_provider_connect_session")).toBe(false);
  });

  it("refuses an oversized token rather than storing it", async () => {
    resolveThenClaim();

    const response = await claimConnect(claimRequest({ code, token: "x".repeat(9000) }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
