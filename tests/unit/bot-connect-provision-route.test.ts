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

const ensureProviderBot = vi.fn();
vi.mock("@/lib/bots/provisioning", () => ({ ensureProviderBot }));

const { POST } = await import("@/app/api/bots/connect/provision/route");

const organizationId = "11111111-2222-4333-8444-555555555555";

function post(body: unknown, origin = "https://factory.test") {
  return new Request(`${origin}/api/bots/connect/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin, host: "factory.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: {},
  });
  ensureProviderBot.mockResolvedValue({ outcome: "created", botId: "bot-1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/bots/connect/provision", () => {
  it("provisions the just-connected provider as the authenticated owner", async () => {
    const response = await POST(post({ provider: "openrouter" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provisioned: true, outcome: "created" });
    expect(ensureProviderBot).toHaveBeenCalledWith({}, organizationId, "openrouter", {
      additional: false,
    });
  });

  it("wires a subscription sign-in to the subscription credential, resolved server-side", async () => {
    const response = await POST(post({ provider: "anthropic", credential: "subscription" }));

    expect(response.status).toBe(200);
    // The browser names an enum value; the variable comes from the catalog —
    // an arbitrary credential ref can never arrive from the client.
    expect(ensureProviderBot).toHaveBeenCalledWith({}, organizationId, "anthropic", {
      additional: false,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });
  });

  it("refuses a subscription request for a provider that has no subscription sign-in", async () => {
    const response = await POST(post({ provider: "google", credential: "subscription" }));

    expect(response.status).toBe(400);
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("resolves account slots to the suffixed subscription variables, server-side", async () => {
    const response = await POST(post({ provider: "anthropic", credential: "subscription_2" }));

    expect(response.status).toBe(200);
    expect(ensureProviderBot).toHaveBeenCalledWith({}, organizationId, "anthropic", {
      additional: false,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2",
    });
  });

  it("resolves any slot number — accounts are unbounded by requirement", async () => {
    const response = await POST(post({ provider: "anthropic", credential: "subscription_47" }));

    expect(response.status).toBe(200);
    expect(ensureProviderBot).toHaveBeenCalledWith({}, organizationId, "anthropic", {
      additional: false,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_47",
    });
  });

  it("still refuses a credential string that is not a slot", async () => {
    const response = await POST(post({ provider: "anthropic", credential: "subscription_1x" }));

    expect(response.status).toBe(400);
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("keeps broker purpose names out of the server-side credential-choice boundary", async () => {
    const response = await POST(post({ provider: "anthropic", credential: "claude" }));

    expect(response.status).toBe(400);
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("passes the additional flag through so many bots can be connected", async () => {
    const response = await POST(post({
      provider: "anthropic", credential: "subscription", additional: true,
    }));

    expect(response.status).toBe(200);
    expect(ensureProviderBot).toHaveBeenCalledWith({}, organizationId, "anthropic", {
      additional: true,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });
  });

  it("reports provisioned:false without failing when a bot already exists", async () => {
    ensureProviderBot.mockResolvedValue({ outcome: "exists" });

    const response = await POST(post({ provider: "openrouter" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provisioned: false, outcome: "exists" });
  });

  it("rejects an unknown provider before touching the fabric", async () => {
    const response = await POST(post({ provider: "not-a-provider" }));

    expect(response.status).toBe(400);
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("refuses a member who is not an owner or admin", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: {},
    });

    const response = await POST(post({ provider: "openrouter" }));

    expect(response.status).toBe(403);
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before any tenant work", async () => {
    // The request URL is the site's own; the Origin header is a foreign site —
    // the shape of a cross-site forgery, which the same-origin assert rejects.
    const request = new Request("https://factory.test/api/bots/connect/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://attacker.test" },
      body: JSON.stringify({ provider: "openrouter" }),
    });

    const response = await POST(request);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });
});
