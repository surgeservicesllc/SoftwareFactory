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

const rpc = vi.fn();
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc }),
}));

const probeProviderCredential = vi.fn();
vi.mock("@/lib/bots/provider-probe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/provider-probe")>(
    "@/lib/bots/provider-probe",
  );
  return { ...actual, probeProviderCredential };
});

const { POST } = await import("@/app/api/bots/connect/key/route");

/**
 * The pasted-key route.
 *
 * Anthropic restricted OAuth to its own products in February 2026, so an API
 * key is the only supported way for software like this to reach Claude. That
 * makes this the front door, and the rule that matters most is that a key which
 * does not work never becomes a stored credential reading as configured — the
 * exact failure the live probe was added to prevent.
 */

const organizationId = "11111111-2222-4333-8444-555555555555";
const key = "sk-ant-api03-a-real-looking-key-value";

function post(body: unknown, origin = "https://factory.test") {
  return new Request(`${origin}/api/bots/connect/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin, host: "factory.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: {},
  });
  probeProviderCredential.mockResolvedValue({
    verdict: "verified", reason: "The provider accepted this key.", live: true,
  });
  rpc.mockResolvedValue({ data: true, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("verify before store", () => {
  it("stores a key the provider accepted", async () => {
    const response = await POST(post({ provider: "anthropic", key }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connected: true, verdict: "verified" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("provisions a ready default bot through the tenant client after storing", async () => {
    // A tenant client that reports no existing bot for the provider and accepts
    // the register_bot insert: the connect response should say a bot is waiting.
    const register = vi.fn(() => ({ single: async () => ({ data: { id: "auto-bot" }, error: null }) }));
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "owner" },
      client: {
        // One `eq` (organization) then `limit`: `ensureProviderBot` reads every
        // bot name in the organization, because names are unique per
        // organization and the old per-provider filter numbered around
        // collisions it could not see.
        from: () => ({
          select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        }),
        rpc: register,
      },
    });

    const response = await POST(post({ provider: "anthropic", key }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connected: true, botProvisioned: true });
    expect(register).toHaveBeenCalledWith("register_bot", expect.objectContaining({
      p_provider: "anthropic",
      p_credential_ref: "ANTHROPIC_API_KEY",
    }));
  });

  it("still connects cleanly when a default bot is not auto-created", async () => {
    // The default client mock ({}) cannot provision; the connection must still
    // succeed, just without the bot-waiting note.
    const response = await POST(post({ provider: "anthropic", key }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connected: true, botProvisioned: false });
  });

  it("refuses a rejected key without storing it", async () => {
    probeProviderCredential.mockResolvedValue({
      verdict: "rejected", reason: "The provider rejected this key.", live: true,
    });

    const response = await POST(post({ provider: "anthropic", key }));

    // Storing first would recreate the failure the probe exists to prevent:
    // a credential that reads as configured and cannot work.
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a key on an account with no credit, and says which", async () => {
    probeProviderCredential.mockResolvedValue({
      verdict: "no_credit",
      reason: "The key is valid but the account has no available credit.",
      live: true,
    });

    const response = await POST(post({ provider: "anthropic", key }));
    const body = await response.json();

    // Reissuing a working key is the wrong fix; the reason has to survive.
    expect(body).toMatchObject({ connected: false, verdict: "no_credit" });
    expect(body.message).toMatch(/no available credit/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("probes with the pasted key rather than the environment", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-different-key-already-set");

    await POST(post({ provider: "anthropic", key }));

    expect(probeProviderCredential).toHaveBeenCalledWith("anthropic", "ANTHROPIC_API_KEY", key);
  });
});

describe("what it never does", () => {
  it("seals the key and never sends the plaintext to the database", async () => {
    await POST(post({ provider: "anthropic", key }));

    const args = rpc.mock.calls[0][1] as Record<string, string>;
    expect(args.p_sealed_envelope).toMatch(/^v1\./);
    expect(args.p_sealed_envelope).not.toContain(key);
    expect(args.p_purpose).toBe("anthropic_api");
  });

  it("never returns the key, on success or failure", async () => {
    const ok = await (await POST(post({ provider: "anthropic", key }))).json();
    expect(JSON.stringify(ok)).not.toContain(key);

    probeProviderCredential.mockResolvedValue({
      verdict: "rejected", reason: "no", live: true,
    });
    const failed = await (await POST(post({ provider: "anthropic", key }))).json();
    expect(JSON.stringify(failed)).not.toContain(key);
  });

  it("seals under the same purpose it stores under, so the key can be reopened", async () => {
    // The seal is bound to (organization, purpose). If those two disagree the
    // write succeeds and the credential is silently dead — unopenable by every
    // reader, with nothing reporting a problem until an agent run fails.
    const { openSecret } = await import("@/lib/server/secret-box");

    await POST(post({ provider: "anthropic", key }));

    const args = rpc.mock.calls[0][1] as Record<string, string>;
    expect(
      openSecret(args.p_sealed_envelope, {
        organizationId: args.p_organization_id,
        purpose: args.p_purpose,
      }),
    ).toBe(key);
  });

  it("keeps an API key under a different purpose than a subscription token", async () => {
    // The seal is bound to the purpose, so one can never be opened as the
    // other. They bill differently and must not be interchangeable.
    await POST(post({ provider: "anthropic", key }));

    expect((rpc.mock.calls[0][1] as Record<string, string>).p_purpose).not.toBe("claude");
  });
});

describe("who may paste", () => {
  it("refuses a member who is not an owner or admin", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: {},
    });

    expect((await POST(post({ provider: "anthropic", key }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post", async () => {
    const foreign = new Request("https://factory.test/api/bots/connect/key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://evil.test",
        host: "factory.test",
      },
      body: JSON.stringify({ provider: "anthropic", key }),
    });

    expect((await POST(foreign)).status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unknown provider and a key too short to be one", async () => {
    expect((await POST(post({ provider: "nope", key }))).status).toBe(400);
    expect((await POST(post({ provider: "anthropic", key: "short" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses before probing when no credential key is configured", async () => {
    vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", "");

    const response = await POST(post({ provider: "anthropic", key }));

    expect(response.status).toBe(503);
    expect(probeProviderCredential).not.toHaveBeenCalled();
  });
});
