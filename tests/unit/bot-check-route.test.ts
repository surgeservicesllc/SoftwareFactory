// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  requireBotFabricManager,
  synchronizeBotReadiness,
} = vi.hoisted(() => ({
  requireBotFabricManager: vi.fn(),
  synchronizeBotReadiness: vi.fn(),
}));

vi.mock("@/lib/bots/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/route")>("@/lib/bots/route");
  return { ...actual, requireBotFabricManager };
});
vi.mock("@/lib/bots/readiness-sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/readiness-sync")>(
    "@/lib/bots/readiness-sync",
  );
  return { ...actual, synchronizeBotReadiness };
});

const { POST } = await import("@/app/api/bots/[botId]/check/route");
const {
  BOT_READINESS_MIGRATION_PENDING_CODE,
  BotReadinessSyncError,
} = await import("@/lib/bots/readiness-sync");

const organizationId = "11111111-2222-4333-8444-555555555555";
const botId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const credentialRef = "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2";

const client = {};

function request() {
  return new Request(`https://factory.test/api/bots/${botId}/check`, {
    method: "POST",
    headers: { host: "factory.test", origin: "https://factory.test" },
  });
}

beforeEach(() => {
  delete process.env[credentialRef];
  requireBotFabricManager.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client,
    user: { id: "99999999-8888-4777-8666-555555555555" },
  });
  synchronizeBotReadiness.mockResolvedValue({
    id: botId,
    credentialRef,
    credentialPresent: true,
    readiness: "ready",
    currentReadiness: "ready",
  });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env[credentialRef];
});

describe("POST /api/bots/[botId]/check", () => {
  it("records and returns vault-backed readiness for a numbered subscription account", async () => {
    const response = await POST(request(), { params: Promise.resolve({ botId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(synchronizeBotReadiness).toHaveBeenCalledWith(
      client,
      organizationId,
      botId,
      "99999999-8888-4777-8666-555555555555",
    );
    expect(body.bot).toMatchObject({
      id: botId,
      credentialRef,
      credentialPresent: true,
      readiness: "ready",
      currentReadiness: "ready",
    });
    expect(JSON.stringify(body)).not.toContain("opened-subscription-token");
  });

  it("does not overwrite an owner-disabled bot when its credential resolves", async () => {
    synchronizeBotReadiness.mockResolvedValue({
      id: botId,
      readiness: "disabled",
      currentReadiness: "disabled",
      credentialPresent: true,
    });

    const response = await POST(request(), { params: Promise.resolve({ botId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bot).toMatchObject({
      readiness: "disabled",
      currentReadiness: "disabled",
      credentialPresent: true,
    });
    expect(synchronizeBotReadiness).toHaveBeenCalledTimes(1);
  });

  it("reports a retryable migration wait instead of using an unsafe legacy recorder", async () => {
    synchronizeBotReadiness.mockRejectedValue(new BotReadinessSyncError("record", {
      code: BOT_READINESS_MIGRATION_PENDING_CODE,
      message: "checked recorder missing",
    }));

    const response = await POST(request(), { params: Promise.resolve({ botId }) });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: BOT_READINESS_MIGRATION_PENDING_CODE,
        message: expect.stringMatching(/database upgrade/i),
      },
    });
  });
});
