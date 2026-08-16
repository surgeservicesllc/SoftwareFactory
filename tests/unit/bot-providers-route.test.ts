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
vi.mock("@/lib/providers/stored-credentials", () => ({ loadStoredCredentialOverlay }));

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

    expect(anthropic.subscriptionSlots).toEqual([false, true, false]);
    // Any signed-in slot counts as connected.
    expect(anthropic.subscriptionReady).toBe(true);
    expect(anthropic.credentialReady).toBe(true);
  });

  it("reports not configured when neither key nor subscription exists", async () => {
    const anthropic = (await providerStatuses()).find((provider) => provider.id === "anthropic")!;

    expect(anthropic.subscriptionReady).toBe(false);
    expect(anthropic.credentialReady).toBe(false);
    expect(anthropic.probeVerdict).toBe("not_configured");
  });
});
