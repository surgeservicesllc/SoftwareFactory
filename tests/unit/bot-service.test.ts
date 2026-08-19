// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { loadStoredCredentialOverlay } = vi.hoisted(() => ({
  loadStoredCredentialOverlay: vi.fn(async () => ({}) as Record<string, string>),
}));
vi.mock("@/lib/providers/stored-credentials", () => ({ loadStoredCredentialOverlay }));

import { BotCredentialError } from "@/lib/bots/credentials";
import {
  BotFabricForbiddenError,
  botFabricErrorResponse,
  botMutationErrorResponse,
} from "@/lib/bots/route";
import {
  BotFabricQueryError,
  canManageBotFabric,
  loadBotFabric,
  serializeAssignment,
  serializeBot,
  serializeBotRole,
  serializeProject,
} from "@/lib/bots/service";
import { ApiRequestError } from "@/lib/server/http";

const organizationId = "11111111-2222-4333-8444-555555555555";

const botRow = {
  id: "bot-1",
  name: "Claude",
  provider: "anthropic",
  model: "claude-opus-5",
  credential_ref: "ANTHROPIC_API_KEY",
  base_url: null,
  readiness: "ready",
  readiness_detail: "Resolves server-side.",
  last_checked_at: "2026-08-12T10:00:00.000Z",
  notes: null,
  created_at: "2026-08-12T09:00:00.000Z",
};

const roleRow = {
  id: "role-1",
  name: "Frontend engineer",
  slug: "frontend",
  summary: "Builds interface work.",
  instructions: "Implement interface changes.",
  risk_ceiling: "green",
  capabilities: ["ui", 7, "accessibility"],
  created_at: "2026-08-12T09:00:00.000Z",
  updated_at: "2026-08-12T09:30:00.000Z",
};

type TableRows = Record<string, unknown[]>;

function fakeClient(rows: TableRows, error: { code?: string; message?: string } | null = null) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: rows[table] ?? [], error }),
          }),
        }),
      }),
    }),
  };
}

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  loadStoredCredentialOverlay.mockReset();
  loadStoredCredentialOverlay.mockResolvedValue({});
});

describe("canManageBotFabric", () => {
  it("admits owners and administrators only", () => {
    expect(canManageBotFabric("owner")).toBe(true);
    expect(canManageBotFabric("admin")).toBe(true);
    expect(canManageBotFabric("member")).toBe(false);
    expect(canManageBotFabric("viewer")).toBe(false);
  });
});

describe("serializeBot", () => {
  it("reports credential presence without returning the value", () => {
    process.env.ANTHROPIC_API_KEY = "fixture-value";

    const bot = serializeBot(botRow);

    expect(bot.credentialRef).toBe("ANTHROPIC_API_KEY");
    expect(bot.credentialPresent).toBe(true);
    expect(bot.currentReadiness).toBe("ready");
    expect(JSON.stringify(bot)).not.toContain("fixture-value");
  });

  it("surfaces drift when the referenced secret is no longer set", () => {
    const bot = serializeBot(botRow);

    expect(bot.readiness).toBe("ready");
    expect(bot.currentReadiness).toBe("not_connected");
    expect(bot.currentReadinessDetail).toContain("ANTHROPIC_API_KEY");
  });

  it("falls back safely for an unrecognized stored readiness or provider", () => {
    const bot = serializeBot({ ...botRow, readiness: "connected", provider: "mystery" });

    expect(bot.readiness).toBe("not_connected");
    expect(bot.providerLabel).toBe("mystery");
    expect(bot.providerVendor).toBe("Unknown vendor");
  });

  it("counts a signed-in credential present even when no environment variable is set", () => {
    // The env var is deliberately unset. A supplied presence predicate stands
    // in for a credential that arrived via one-click sign-in or a pasted key,
    // and the bot must read exactly as ready as an env-configured one.
    const bot = serializeBot(botRow, (ref) => ref === "ANTHROPIC_API_KEY");

    expect(bot.credentialPresent).toBe(true);
    expect(bot.currentReadiness).toBe("ready");
  });

  it("defaults to environment-only presence when no predicate is supplied", () => {
    expect(serializeBot(botRow).credentialPresent).toBe(false);
    process.env.ANTHROPIC_API_KEY = "fixture-value";
    expect(serializeBot(botRow).credentialPresent).toBe(true);
  });
});

describe("serializeBotRole", () => {
  it("normalizes the stored risk level and drops non-string capabilities", () => {
    const role = serializeBotRole(roleRow);

    expect(role.riskCeiling).toBe("GREEN");
    expect(role.capabilities).toEqual(["ui", "accessibility"]);
  });

  it("tolerates a non-array capabilities column", () => {
    expect(serializeBotRole({ ...roleRow, capabilities: null }).capabilities).toEqual([]);
  });
});

describe("serializeAssignment", () => {
  it("maps known statuses and treats anything else as released", () => {
    const base = {
      id: "assignment-1",
      bot_id: "bot-1",
      project_id: "project-1",
      role_id: "role-1",
      assigned_at: "2026-08-12T10:00:00.000Z",
      released_at: null,
    };

    expect(serializeAssignment({ ...base, status: "active" }).status).toBe("active");
    expect(serializeAssignment({ ...base, status: "paused" }).status).toBe("paused");
    expect(serializeAssignment({ ...base, status: "unknown" }).status).toBe("released");
  });
});

describe("serializeProject", () => {
  it("carries the repository binding through unchanged", () => {
    const project = serializeProject({
      id: "project-1",
      name: "SoftwareFactory",
      status: "active",
      github_repository: "surgeservicesllc/SoftwareFactory",
      health_status: "unknown",
    });

    expect(project.githubRepository).toBe("surgeservicesllc/SoftwareFactory");
    expect(project.healthStatus).toBe("unknown");
  });
});

describe("loadBotFabric", () => {
  it("omits released assignments and archived projects", async () => {
    const snapshot = await loadBotFabric(
      fakeClient({
        bots: [botRow],
        bot_roles: [roleRow],
        bot_assignments: [
          {
            id: "assignment-1",
            bot_id: "bot-1",
            project_id: "project-1",
            role_id: "role-1",
            status: "active",
            assigned_at: "2026-08-12T10:00:00.000Z",
            released_at: null,
          },
          {
            id: "assignment-2",
            bot_id: "bot-2",
            project_id: "project-1",
            role_id: "role-1",
            status: "released",
            assigned_at: "2026-08-11T10:00:00.000Z",
            released_at: "2026-08-12T08:00:00.000Z",
          },
        ],
        projects: [
          { id: "project-1", name: "Live", status: "active", github_repository: null, health_status: "unknown" },
          { id: "project-2", name: "Old", status: "archived", github_repository: null, health_status: "unknown" },
        ],
      }),
      organizationId,
    );

    expect(snapshot.bots).toHaveLength(1);
    expect(snapshot.roles).toHaveLength(1);
    expect(snapshot.assignments.map((entry) => entry.id)).toEqual(["assignment-1"]);
    expect(snapshot.projects.map((entry) => entry.name)).toEqual(["Live"]);
  });

  it("raises a typed error so the route can map the database status", async () => {
    await expect(
      loadBotFabric(fakeClient({}, { code: "42501", message: "denied" }), organizationId),
    ).rejects.toBeInstanceOf(BotFabricQueryError);
  });

  it("marks a bot ready from a vault credential with no environment variable set", async () => {
    // The one-click sign-in and paste-key flows store credentials in the vault,
    // not the environment. The overlay carries the same variable name, so the
    // fleet must report the bot ready without ANTHROPIC_API_KEY ever being set.
    loadStoredCredentialOverlay.mockResolvedValue({ ANTHROPIC_API_KEY: "opened-secret" });

    const snapshot = await loadBotFabric(
      fakeClient({ bots: [botRow], bot_roles: [], bot_assignments: [], projects: [] }),
      organizationId,
    );

    expect(loadStoredCredentialOverlay).toHaveBeenCalledWith(organizationId);
    expect(snapshot.bots[0]!.credentialPresent).toBe(true);
    expect(snapshot.bots[0]!.currentReadiness).toBe("ready");
    // The opened secret is used for presence only and never serialized.
    expect(JSON.stringify(snapshot)).not.toContain("opened-secret");
  });

  it("still reports not-connected when neither the environment nor the vault holds it", async () => {
    loadStoredCredentialOverlay.mockResolvedValue({ OPENAI_API_KEY: "unrelated" });

    const snapshot = await loadBotFabric(
      fakeClient({ bots: [botRow], bot_roles: [], bot_assignments: [], projects: [] }),
      organizationId,
    );

    expect(snapshot.bots[0]!.credentialPresent).toBe(false);
    expect(snapshot.bots[0]!.currentReadiness).toBe("not_connected");
  });
});

describe("botFabricErrorResponse", () => {
  it("returns 403 for a non-manager", async () => {
    const response = botFabricErrorResponse(new BotFabricForbiddenError(), "x", "y");

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "bot_fabric_forbidden" } });
  });

  it("returns 400 with the specific reason for a refused credential reference", async () => {
    const response = botFabricErrorResponse(
      new BotCredentialError("credential_ref_privileged", "nope"),
      "x",
      "y",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "credential_ref_privileged" },
    });
  });

  it("maps a database permission failure to 403", () => {
    const response = botFabricErrorResponse(
      new BotFabricQueryError({ code: "42501", message: "denied" }),
      "x",
      "y",
    );

    expect(response.status).toBe(403);
  });

  it("passes request errors through with their own status", () => {
    const response = botFabricErrorResponse(
      new ApiRequestError(413, "payload_too_large", "too big"),
      "x",
      "y",
    );

    expect(response.status).toBe(413);
  });

  it("falls back to a generic 500 without leaking internals", async () => {
    const response = botFabricErrorResponse(
      new Error("connection string postgres://user:password@host"),
      "bot_fabric_unavailable",
      "The bot fabric could not be loaded.",
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("postgres://");
    expect(body).toContain("bot_fabric_unavailable");
  });

  it("never caches a fabric response", () => {
    const response = botFabricErrorResponse(new BotFabricForbiddenError(), "x", "y");

    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("botMutationErrorResponse", () => {
  it("explains a duplicate name or slug as a conflict", async () => {
    const response = botMutationErrorResponse({ code: "23505", message: "duplicate key" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "bot_fabric_conflict" } });
  });

  it("maps a missing resource to 404", () => {
    expect(botMutationErrorResponse({ code: "P0002", message: "not found" }).status).toBe(404);
  });

  it("maps a check-constraint failure to 400", () => {
    expect(botMutationErrorResponse({ code: "23514", message: "bad" }).status).toBe(400);
  });
});
