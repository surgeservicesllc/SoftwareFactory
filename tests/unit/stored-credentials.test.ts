// @vitest-environment node

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc }),
}));

const { loadStoredCredentialOverlay, withStoredCredentials } = await import(
  "@/lib/providers/stored-credentials"
);
const { sealSecret } = await import("@/lib/server/secret-box");
const { resolveClaudeAuth } = await import("@/lib/providers/claude-auth");

/**
 * The bridge between the vault and the pure auth resolvers.
 *
 * Two behaviours carry real consequences: a signed-in credential has to beat a
 * stale environment variable, and every failure has to degrade to "no stored
 * credential" rather than throwing — a vault problem must not become an outage
 * for a deployment that only ever used the environment.
 */

const organizationId = "11111111-2222-4333-8444-555555555555";
const oauthToken = "sk-ant-oat01-signed-in-subscription-token";
const OAUTH_KEY = "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN";

beforeEach(() => {
  vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", randomBytes(32).toString("base64"));
  rpc.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function storedClaude(token = oauthToken) {
  const sealed = sealSecret(token, { organizationId, purpose: "claude" });
  rpc.mockImplementation(async (_name: string, args: Record<string, string>) => (
    args.p_purpose === "claude" ? { data: sealed, error: null } : { data: null, error: null }
  ));
}

describe("reading the vault", () => {
  it("opens a stored credential into the variable the resolver reads", async () => {
    storedClaude();

    const overlay = await loadStoredCredentialOverlay(organizationId);

    expect(overlay[OAUTH_KEY]).toBe(oauthToken);
  });

  it("returns nothing when no credential is stored", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    expect(await loadStoredCredentialOverlay(organizationId)).toEqual({});
  });

  it("returns nothing rather than throwing when the vault errors", async () => {
    // A vault problem must not become an outage for a deployment that only
    // ever used the environment.
    rpc.mockRejectedValue(new Error("connection refused"));

    await expect(loadStoredCredentialOverlay(organizationId)).resolves.toEqual({});
  });

  it("skips a credential sealed under a rotated master key", async () => {
    storedClaude();
    vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", randomBytes(32).toString("base64"));

    // Unopenable is not the same as absent, but for this caller it resolves the
    // same way: fall back rather than fail the request.
    expect(await loadStoredCredentialOverlay(organizationId)).toEqual({});
  });

  it("does nothing at all when no master key is configured", async () => {
    vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", "");

    expect(await loadStoredCredentialOverlay(organizationId)).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("precedence", () => {
  it("lets a signed-in credential beat a stale environment variable", async () => {
    storedClaude();
    const overlay = await loadStoredCredentialOverlay(organizationId);

    const merged = withStoredCredentials(
      { [OAUTH_KEY]: "sk-ant-oat01-an-old-token-from-a-dashboard" },
      overlay,
    );

    // Someone who just signed in means the thing they signed in with.
    expect(merged[OAUTH_KEY]).toBe(oauthToken);
  });

  it("leaves unrelated variables untouched", async () => {
    storedClaude();
    const merged = withStoredCredentials(
      { SOFTWAREFACTORY_CLAUDE_AUTH_MODE: "subscription", UNRELATED: "kept" },
      await loadStoredCredentialOverlay(organizationId),
    );

    expect(merged.UNRELATED).toBe("kept");
    expect(merged.SOFTWAREFACTORY_CLAUDE_AUTH_MODE).toBe("subscription");
  });
});

describe("the resolver sees a signed-in credential", () => {
  it("resolves subscription mode with zero token cost", async () => {
    storedClaude();
    const merged = withStoredCredentials({}, await loadStoredCredentialOverlay(organizationId));

    const resolution = resolveClaudeAuth(merged);

    expect(resolution).toMatchObject({ mode: "subscription", zeroToken: true });
    expect(resolution.apiKey).toBeNull();
  });

  it("still refuses an API key that arrived through the vault", async () => {
    // The seal says nothing about what is inside it. A stored API key would
    // bill per token under a subscription label, and the resolver's existing
    // shape check has to keep catching that.
    storedClaude("sk-ant-api03-a-real-api-key-value-here");
    const merged = withStoredCredentials({}, await loadStoredCredentialOverlay(organizationId));

    expect(() => resolveClaudeAuth(merged)).toThrow();
  });

  it("reports the credential as missing when nothing is stored or set", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const merged = withStoredCredentials({}, await loadStoredCredentialOverlay(organizationId));

    expect(() => resolveClaudeAuth(merged)).toThrow(/SUBSCRIPTION_CREDENTIAL_MISSING|setup-token/);
  });
});
