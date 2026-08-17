// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireActiveOrganization = vi.fn();
vi.mock("@/lib/supabase/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/tenant")>(
    "@/lib/supabase/tenant",
  );
  return { ...actual, requireActiveOrganization };
});

const loadStoredCredentialOverlay = vi.fn(async () => ({}) as Record<string, string>);
vi.mock("@/lib/providers/stored-credentials", async () => {
  const actual = await vi.importActual<typeof import("@/lib/providers/stored-credentials")>(
    "@/lib/providers/stored-credentials",
  );
  return { ...actual, loadStoredCredentialOverlay };
});

const probeProviderCredential = vi.fn(async () => ({
  verdict: "verified" as const,
  reason: null,
  live: true,
}));
vi.mock("@/lib/bots/provider-probe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/provider-probe")>(
    "@/lib/bots/provider-probe",
  );
  return { ...actual, probeProviderCredential };
});

const { GET } = await import("@/app/api/bots/providers/route");
const { findBotProvider } = await import("@/lib/bots/catalog");
const { CLAUDE_AUTH_ENVIRONMENT_KEYS } = await import("@/lib/providers/claude-auth");

const organizationId = "11111111-2222-4333-8444-555555555555";

type ProviderStatus = {
  id: string;
  credentialReady: boolean;
  subscriptionReady: boolean;
  probeVerdict: string;
};

async function providerStatuses(): Promise<ProviderStatus[]> {
  const response = await GET(new Request("https://factory.test/api/bots/providers"));
  const body = (await response.json()) as { providers: ProviderStatus[] };
  return body.providers;
}

beforeEach(() => {
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: {},
  });
  loadStoredCredentialOverlay.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the catalog's subscription refs", () => {
  it("pins the browser-safe literals to the server-side key constants", () => {
    // The catalog cannot import server-only modules, so its subscription refs
    // are literals. This is the drift guard the catalog comment promises.
    expect(findBotProvider("anthropic")?.subscriptionCredentialRef)
      .toBe(CLAUDE_AUTH_ENVIRONMENT_KEYS.oauthToken);
    expect(findBotProvider("openai")?.subscriptionCredentialRef)
      .toBe("SOFTWAREFACTORY_CODEX_AUTH_JSON");
  });
});

describe("GET /api/bots/providers", () => {
  it("counts a signed-in Claude subscription as connected without probing it", async () => {
    loadStoredCredentialOverlay.mockResolvedValue({
      SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: "opened-subscription-token",
    });

    const anthropic = (await providerStatuses()).find((provider) => provider.id === "anthropic")!;

    expect(anthropic.subscriptionReady).toBe(true);
    expect(anthropic.credentialReady).toBe(true);
    // The model-list probe authenticates API keys, not subscription tokens —
    // probing would be a guaranteed 401 misread as a bad sign-in.
    expect(probeProviderCredential).not.toHaveBeenCalledWith(
      "anthropic", expect.anything(), expect.anything(),
    );
    expect(anthropic.probeVerdict).toBe("not_probed");
  });

  it("reports per-account-slot readiness so several accounts can be signed in at once", async () => {
    loadStoredCredentialOverlay.mockResolvedValue({
      SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2: "second-account-token",
    });

    const anthropic = (await providerStatuses()).find(
      (provider) => provider.id === "anthropic",
    )! as ProviderStatus & { subscriptionSlots?: boolean[] };

    // The array is as long as the highest slot present — never a fixed three.
    expect(anthropic.subscriptionSlots).toEqual([false, true]);
    // Any signed-in slot counts as connected.
    expect(anthropic.subscriptionReady).toBe(true);
    expect(anthropic.credentialReady).toBe(true);
  });

  it("reports a high-numbered slot rather than capping the account count", async () => {
    loadStoredCredentialOverlay.mockResolvedValue({
      SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_5: "fifth-account-token",
    });

    const anthropic = (await providerStatuses()).find(
      (provider) => provider.id === "anthropic",
    )! as ProviderStatus & { subscriptionSlots?: boolean[] };

    expect(anthropic.subscriptionSlots).toHaveLength(5);
    expect(anthropic.subscriptionSlots?.[4]).toBe(true);
    expect(anthropic.subscriptionReady).toBe(true);
  });

  it("reports not configured when neither key nor subscription exists", async () => {
    const anthropic = (await providerStatuses()).find((provider) => provider.id === "anthropic")!;

    expect(anthropic.subscriptionReady).toBe(false);
    expect(anthropic.credentialReady).toBe(false);
    expect(anthropic.probeVerdict).toBe("not_configured");
  });
});

describe("a Claude connection made through Google sign-in", () => {
  // The end-to-end gap this covers: the callback stored a credential under the
  // `vertex` purpose and nothing read it, so a successful sign-in still showed
  // "needs a key".

  function connectedThroughGoogle(document: unknown) {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    loadStoredCredentialOverlay.mockResolvedValue({
      SOFTWAREFACTORY_VERTEX_CREDENTIAL: JSON.stringify(document),
    });
  }

  async function claudeRow() {
    return (await providerStatuses()).find((entry) => entry.id === "anthropic");
  }

  it("reports Claude as ready and verified with no API key anywhere", async () => {
    connectedThroughGoogle({ refreshToken: "1//refresh", projectId: "my-project" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ access_token: "fresh-access" }),
    })));

    expect(await claudeRow()).toMatchObject({ credentialReady: true, probeVerdict: "verified" });
  });

  it("reports a withdrawn Google grant as rejected, not unreachable", async () => {
    connectedThroughGoogle({ refreshToken: "1//revoked", projectId: "my-project" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: "invalid_grant" }),
    })));

    const claude = await claudeRow();

    // A withdrawn grant needs another sign-in; being unreachable does not.
    expect(claude).toMatchObject({ probeVerdict: "rejected" });
    expect(String((claude as unknown as { probeReason: string }).probeReason))
      .toMatch(/sign in again/i);
  });

  it("does not report Google being down as a bad connection", async () => {
    connectedThroughGoogle({ refreshToken: "1//refresh", projectId: "my-project" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 503, json: async () => ({}),
    })));

    expect(await claudeRow()).toMatchObject({ probeVerdict: "unreachable" });
  });

  it("never returns the refresh token or the fresh access token to the browser", async () => {
    connectedThroughGoogle({ refreshToken: "1//secret-refresh", projectId: "secret-project" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ access_token: "fresh-access" }),
    })));

    const providers = await providerStatuses();

    expect(JSON.stringify(providers)).not.toContain("1//secret-refresh");
    expect(JSON.stringify(providers)).not.toContain("fresh-access");
  });

  it("refuses a stored document that is not a usable connection", async () => {
    // Half a credential must not read as connected: without a project there is
    // nothing for Vertex to address.
    connectedThroughGoogle({ refreshToken: "1//refresh" });

    expect(await claudeRow()).toMatchObject({ probeVerdict: "rejected" });
  });
});
