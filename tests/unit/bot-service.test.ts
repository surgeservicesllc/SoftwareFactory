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

type QueryObservations = {
  assignmentStatusPredicates: Array<[string, string]>;
  assignmentOrganizationPredicates?: Array<[string, string]>;
  assignmentCursors?: string[];
  assignmentLimits?: number[];
  /** Simulates a PostgREST max-rows value below the requested page size. */
  assignmentServerCap?: number;
  missingAssignmentRevision?: boolean;
  missingBotAiAccountId?: boolean;
  selectedColumns?: Array<[string, string]>;
  tableCursors?: Array<[string, string]>;
  tableLimits?: Array<[string, number]>;
  tableServerCaps?: Record<string, number>;
};

function fakeClient(
  rows: TableRows,
  error: { code?: string; message?: string } | null = null,
  observations?: QueryObservations,
) {
  return {
    from: (table: string) => {
      return {
        select: (columns: string) => {
          observations?.selectedColumns?.push([table, columns]);
          const equalities: Array<[string, string]> = [];
          const inequalities: Array<[string, string]> = [];
          const greaterThan: Array<[string, string]> = [];
          let orderColumn = "id";
          let ascending = true;

          const builder = {
            eq: (column: string, value: string) => {
              equalities.push([column, value]);
              if (table === "bot_assignments" && column === "organization_id") {
                observations?.assignmentOrganizationPredicates?.push([column, value]);
              }
              return builder;
            },
            neq: (column: string, value: string) => {
              inequalities.push([column, value]);
              if (table === "bot_assignments") {
                observations?.assignmentStatusPredicates.push([column, value]);
              }
              return builder;
            },
            gt: (column: string, value: string) => {
              greaterThan.push([column, value]);
              observations?.tableCursors?.push([table, value]);
              if (table === "bot_assignments" && column === "id") {
                observations?.assignmentCursors?.push(value);
              }
              return builder;
            },
            order: (column: string, options: { ascending: boolean }) => {
              orderColumn = column;
              ascending = options.ascending;
              return builder;
            },
            limit: async (requestedLimit: number) => {
              observations?.tableLimits?.push([table, requestedLimit]);
              if (table === "bot_assignments") {
                observations?.assignmentLimits?.push(requestedLimit);
              }
              const effectiveLimit = Math.min(
                requestedLimit,
                table === "bot_assignments"
                  ? observations?.assignmentServerCap ?? requestedLimit
                  : observations?.tableServerCaps?.[table] ?? requestedLimit,
              );
              const data = [...(rows[table] ?? [])]
                .filter((row) => {
                  const record = row as Record<string, unknown>;
                  return equalities.every(([column, value]) => (
                    record[column] === undefined || record[column] === value
                  )) && inequalities.every(([column, value]) => record[column] !== value)
                    && greaterThan.every(([column, value]) => String(record[column]) > value);
                })
                .sort((left, right) => {
                  const leftValue = String((left as Record<string, unknown>)[orderColumn] ?? "");
                  const rightValue = String((right as Record<string, unknown>)[orderColumn] ?? "");
                  const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
                  return ascending ? comparison : -comparison;
                })
                .slice(0, effectiveLimit);
              const compatibilityError = table === "bot_assignments"
                && observations?.missingAssignmentRevision
                && columns.split(",").includes("revision")
                ? { code: "PGRST204", message: "Could not find the 'revision' column" }
                : table === "bots"
                  && observations?.missingBotAiAccountId
                  && columns.split(",").includes("ai_account_id")
                  ? { code: "42703", message: "column bots.ai_account_id does not exist" }
                  : null;
              return { data: compatibilityError ? null : data, error: compatibilityError ?? error };
            },
          };
          return builder;
        },
      };
    },
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
      revision: 1,
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
    const observations = { assignmentStatusPredicates: [] as Array<[string, string]> };
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
      }, null, observations),
      organizationId,
    );

    expect(snapshot.bots).toHaveLength(1);
    expect(snapshot.roles).toHaveLength(1);
    expect(snapshot.assignments.map((entry) => entry.id)).toEqual(["assignment-1"]);
    expect(snapshot.assignmentsComplete).toBe(true);
    expect(observations.assignmentStatusPredicates.length).toBeGreaterThan(0);
    expect(observations.assignmentStatusPredicates.every(
      (predicate) => predicate[0] === "status" && predicate[1] === "released",
    )).toBe(true);
    expect(snapshot.projects.map((entry) => entry.name)).toEqual(["Live"]);
  });

  it("keeps the fleet readable before identity and revision columns exist", async () => {
    const observations: QueryObservations = {
      assignmentStatusPredicates: [],
      missingAssignmentRevision: true,
      missingBotAiAccountId: true,
      selectedColumns: [],
    };
    const snapshot = await loadBotFabric(
      fakeClient({
        bots: [botRow],
        bot_roles: [],
        bot_assignments: [{
          id: "assignment-legacy",
          bot_id: botRow.id,
          project_id: "project-legacy",
          role_id: "role-legacy",
          status: "active",
          assigned_at: "2026-08-12T10:00:00.000Z",
          released_at: null,
        }],
        projects: [{
          id: "project-legacy",
          name: "Legacy",
          status: "active",
          github_repository: null,
          health_status: "unknown",
        }],
      }, null, observations),
      organizationId,
    );

    expect(snapshot.bots[0]).toMatchObject({ id: botRow.id, aiAccountId: null });
    expect(snapshot.assignments[0]).toMatchObject({ id: "assignment-legacy", revision: 1 });
    expect(observations.selectedColumns).toEqual(expect.arrayContaining([
      ["bots", expect.stringContaining("ai_account_id")],
      ["bots", expect.not.stringContaining("ai_account_id")],
      ["bot_assignments", expect.stringContaining("revision")],
      ["bot_assignments", expect.not.stringContaining("revision")],
    ]));
  });

  it("reads every open assignment beyond 500 despite a shorter server row cap", async () => {
    const observations: QueryObservations = {
      assignmentStatusPredicates: [],
      assignmentOrganizationPredicates: [],
      assignmentCursors: [],
      assignmentLimits: [],
      assignmentServerCap: 100,
    };
    const openAssignments = Array.from({ length: 521 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      revision: 1,
      bot_id: `bot-${index}`,
      project_id: `project-${index}`,
      role_id: "role-1",
      status: "active",
      assigned_at: "2026-08-22T00:00:00.000Z",
      released_at: null,
    }));

    const snapshot = await loadBotFabric(
      fakeClient({
        bots: [],
        bot_roles: [],
        bot_assignments: [
          ...openAssignments,
          ...Array.from({ length: 600 }, (_, index) => ({
            ...openAssignments[index % openAssignments.length],
            id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            status: "released",
          })),
        ],
        projects: [],
      }, null, observations),
      organizationId,
    );

    expect(snapshot.assignments).toHaveLength(521);
    expect(snapshot.assignments.map((assignment) => assignment.id)).toEqual(
      openAssignments.map((assignment) => assignment.id),
    );
    expect(snapshot.assignmentsComplete).toBe(true);
    // Six non-empty pages (the server caps them at 100) plus the terminal
    // empty page. A short first page must not be interpreted as completion.
    expect(observations.assignmentLimits).toHaveLength(7);
    expect(observations.assignmentLimits?.every((limit) => limit === 250)).toBe(true);
    expect(observations.assignmentCursors).toHaveLength(6);
    expect(observations.assignmentOrganizationPredicates).toHaveLength(7);
    expect(observations.assignmentOrganizationPredicates?.every(
      (predicate) => predicate[0] === "organization_id" && predicate[1] === organizationId,
    )).toBe(true);
    expect(observations.assignmentStatusPredicates).toHaveLength(7);
  });

  it("reads roles and bots through terminal pages instead of truncating referenced rows", async () => {
    const observations: QueryObservations = {
      assignmentStatusPredicates: [],
      tableCursors: [],
      tableLimits: [],
      tableServerCaps: { bots: 75, bot_roles: 75 },
    };
    const bots = Array.from({ length: 203 }, (_, index) => ({
      ...botRow,
      id: `00000000-0000-4000-8001-${String(index).padStart(12, "0")}`,
      name: `Bot ${String(index).padStart(3, "0")}`,
    }));
    const roles = Array.from({ length: 205 }, (_, index) => ({
      ...roleRow,
      id: `00000000-0000-4000-8002-${String(index).padStart(12, "0")}`,
      name: `Role ${String(index).padStart(3, "0")}`,
      slug: `role-${index}`,
    }));

    const snapshot = await loadBotFabric(
      fakeClient({
        bots,
        bot_roles: roles,
        bot_assignments: [{
          id: "assignment-last",
          revision: 1,
          bot_id: bots.at(-1)!.id,
          project_id: "project-1",
          role_id: roles.at(-1)!.id,
          status: "active",
          assigned_at: "2026-08-22T00:00:00.000Z",
          released_at: null,
        }],
        projects: [],
      }, null, observations),
      organizationId,
    );

    expect(snapshot.bots).toHaveLength(203);
    expect(snapshot.roles).toHaveLength(205);
    expect(snapshot.bots.some((bot) => bot.id === bots.at(-1)!.id)).toBe(true);
    expect(snapshot.roles.some((role) => role.id === roles.at(-1)!.id)).toBe(true);
    expect(observations.tableLimits?.filter(([table]) => table === "bots")).toHaveLength(4);
    expect(observations.tableLimits?.filter(([table]) => table === "bot_roles")).toHaveLength(4);
    expect(observations.tableCursors?.filter(([table]) => table === "bots")).toHaveLength(3);
    expect(observations.tableCursors?.filter(([table]) => table === "bot_roles")).toHaveLength(3);
  });

  it("fails closed instead of returning a partial roster at the page guard", async () => {
    const observations: QueryObservations = {
      assignmentStatusPredicates: [],
      assignmentLimits: [],
    };
    const tooManyOpenAssignments = Array.from({ length: 25_001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      revision: 1,
      bot_id: `bot-${index}`,
      project_id: `project-${index}`,
      role_id: "role-1",
      status: "active",
      assigned_at: "2026-08-22T00:00:00.000Z",
      released_at: null,
    }));

    await expect(loadBotFabric(
      fakeClient({
        bots: [],
        bot_roles: [],
        bot_assignments: tooManyOpenAssignments,
        projects: [],
      }, null, observations),
      organizationId,
    )).rejects.toMatchObject({
      databaseError: { code: "bot_assignments_pagination_limit" },
    });

    // 100 allowed data pages plus one non-empty terminal probe establishes
    // that a 25,001st row exists and forces the whole read to fail.
    expect(observations.assignmentLimits).toHaveLength(101);
    expect(observations.assignmentStatusPredicates).toHaveLength(101);
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
