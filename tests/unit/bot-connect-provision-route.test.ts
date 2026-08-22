// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listAiAccounts = vi.fn();
vi.mock("@/lib/ai-accounts/broker", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai-accounts/broker")>(
    "@/lib/ai-accounts/broker",
  );
  return { ...actual, listAiAccounts };
});

const requireActiveOrganization = vi.fn();
vi.mock("@/lib/supabase/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/tenant")>(
    "@/lib/supabase/tenant",
  );
  return { ...actual, requireActiveOrganization };
});

const ensureProviderBot = vi.fn();
vi.mock("@/lib/bots/provisioning", () => ({ ensureProviderBot }));

const synchronizeBotReadiness = vi.fn();
vi.mock("@/lib/bots/readiness-sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/readiness-sync")>(
    "@/lib/bots/readiness-sync",
  );
  return { ...actual, synchronizeBotReadiness };
});

const { POST } = await import("@/app/api/bots/connect/provision/route");
const {
  BOT_READINESS_MIGRATION_PENDING_CODE,
  BotReadinessSyncError,
} = await import("@/lib/bots/readiness-sync");

const organizationId = "11111111-2222-4333-8444-555555555555";
const baseAccountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const secondAccountId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const fortySeventhAccountId = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";

function account(
  accountId: string,
  credentialPurpose: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    account_id: accountId,
    provider: "anthropic",
    auth_method: "subscription",
    display_name: "Claude account",
    status: "connected",
    credential_purpose: credentialPurpose,
    last_verified_at: null,
    last_error: null,
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

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
    user: { id: "99999999-8888-4777-8666-555555555555" },
  });
  ensureProviderBot.mockResolvedValue({ outcome: "created", botId: "bot-1" });
  synchronizeBotReadiness.mockResolvedValue({ readiness: "ready" });
  listAiAccounts.mockResolvedValue([
    account(baseAccountId, "claude"),
    account(secondAccountId, "claude_2"),
    account(fortySeventhAccountId, "claude_47"),
  ]);
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
    const aiAccountId = baseAccountId;
    const response = await POST(post({
      provider: "anthropic", credential: "subscription", aiAccountId,
    }));

    expect(response.status).toBe(200);
    // The browser names an enum value; the variable comes from the catalog —
    // an arbitrary credential ref can never arrive from the client.
    expect(ensureProviderBot).toHaveBeenCalledWith({}, organizationId, "anthropic", {
      additional: false,
      aiAccountId,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });
    expect(await response.json()).toMatchObject({
      provisioned: true, outcome: "created", botId: "bot-1", readiness: "ready",
    });
    expect(synchronizeBotReadiness).toHaveBeenCalledWith(
      {},
      organizationId,
      "bot-1",
      "99999999-8888-4777-8666-555555555555",
    );
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
      aiAccountId: secondAccountId,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2",
    });
    expect(synchronizeBotReadiness).toHaveBeenCalledWith(
      {}, organizationId, "bot-1", "99999999-8888-4777-8666-555555555555",
    );
  });

  it("resolves any slot number — accounts are unbounded by requirement", async () => {
    const response = await POST(post({ provider: "anthropic", credential: "subscription_47" }));

    expect(response.status).toBe(200);
    expect(ensureProviderBot).toHaveBeenCalledWith({}, organizationId, "anthropic", {
      additional: false,
      aiAccountId: fortySeventhAccountId,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_47",
    });
  });

  it("still refuses a credential string that is not a slot", async () => {
    const response = await POST(post({ provider: "anthropic", credential: "subscription_1x" }));

    expect(response.status).toBe(400);
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("refuses an account id on the API-key provisioning path", async () => {
    const response = await POST(post({
      provider: "openrouter",
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }));

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
      aiAccountId: baseAccountId,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });
  });

  it("rejects an explicit account id whose provider slot does not match the request", async () => {
    const response = await POST(post({
      provider: "anthropic",
      credential: "subscription_2",
      aiAccountId: baseAccountId,
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "ai_account_mismatch" } });
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("rejects a random or cross-tenant account id before provisioning", async () => {
    const response = await POST(post({
      provider: "anthropic",
      credential: "subscription",
      aiAccountId: "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb",
    }));

    expect(response.status).toBe(409);
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous cached subscription slot instead of guessing", async () => {
    listAiAccounts.mockResolvedValue([
      account(baseAccountId, "claude"),
      account(secondAccountId, "claude"),
    ]);

    const response = await POST(post({ provider: "anthropic", credential: "subscription" }));

    expect(response.status).toBe(409);
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("rejects an account without a usable subscription credential", async () => {
    listAiAccounts.mockResolvedValue([
      account(baseAccountId, "claude", { status: "disconnected" }),
    ]);

    const response = await POST(post({ provider: "anthropic", credential: "subscription" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "ai_account_unavailable" } });
    expect(ensureProviderBot).not.toHaveBeenCalled();
  });

  it("reports provisioned:false without failing when a bot already exists", async () => {
    ensureProviderBot.mockResolvedValue({ outcome: "exists", botId: "bot-existing" });

    const response = await POST(post({ provider: "openrouter" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provisioned: false, outcome: "exists", botId: "bot-existing",
    });
  });

  it("keeps an existing disabled bot disabled on a provisioning retry", async () => {
    ensureProviderBot.mockResolvedValue({ outcome: "exists", botId: "bot-existing" });
    synchronizeBotReadiness.mockResolvedValue({ readiness: "disabled" });

    const response = await POST(post({
      provider: "anthropic",
      credential: "subscription",
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      provisioned: false,
      outcome: "exists",
      botId: "bot-existing",
      readiness: "disabled",
      error: { code: "bot_not_ready" },
    });
  });

  it("refuses to call an exact-account bot usable when vault readiness cannot be persisted", async () => {
    synchronizeBotReadiness.mockRejectedValue(new Error("readback failed"));

    const response = await POST(post({
      provider: "anthropic",
      credential: "subscription",
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      provisioned: true,
      outcome: "created",
      botId: "bot-1",
      error: { code: "bot_readiness_sync_failed" },
    });
  });

  it("keeps the checked-recorder rollout wait truthful and retryable", async () => {
    synchronizeBotReadiness.mockRejectedValue(new BotReadinessSyncError("record", {
      code: BOT_READINESS_MIGRATION_PENDING_CODE,
      message: "checked recorder missing",
    }));

    const response = await POST(post({
      provider: "anthropic",
      credential: "subscription",
      aiAccountId: baseAccountId,
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: BOT_READINESS_MIGRATION_PENDING_CODE,
        message: expect.stringMatching(/database upgrade/i),
      },
    });
  });

  it("records and reports a credential that cannot currently be opened", async () => {
    synchronizeBotReadiness.mockResolvedValue({ readiness: "not_connected" });

    const response = await POST(post({
      provider: "anthropic",
      credential: "subscription",
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      botId: "bot-1",
      readiness: "not_connected",
      error: { code: "bot_not_ready" },
    });
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
