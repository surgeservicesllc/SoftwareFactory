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

const loadBotFabric = vi.fn();
vi.mock("@/lib/bots/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/service")>("@/lib/bots/service");
  return { ...actual, loadBotFabric };
});

const { GET, POST } = await import("@/app/api/projects/[projectId]/bots/route");
const { PATCH, DELETE } = await import(
  "@/app/api/projects/[projectId]/bots/[assignmentId]/route"
);
const { LEAST_PRIVILEGE_CONFIG } = await import("@/lib/bots/assignment-config");

const organizationId = "11111111-2222-4333-8444-555555555555";
const projectId = "22222222-2222-4333-8444-555555555555";
const otherProjectId = "22222222-2222-4333-8444-555555555556";
const assignmentId = "33333333-2222-4333-8444-555555555555";
const readyBotId = "44444444-2222-4333-8444-555555555551";
const offlineBotId = "44444444-2222-4333-8444-555555555552";
const secondBotId = "44444444-2222-4333-8444-555555555553";
const roleId = "55555555-2222-4333-8444-555555555555";

const rpc = vi.fn();

function bot(id: string, name: string, ready: boolean) {
  return {
    id,
    name,
    provider: "anthropic",
    providerLabel: "Claude",
    providerVendor: "Anthropic",
    model: "claude-opus-5",
    credentialRef: "ANTHROPIC_API_KEY",
    credentialPresent: ready,
    baseUrl: null,
    notes: null,
    readiness: ready ? "ready" : "not_connected",
    readinessLabel: ready ? "Ready to assign" : "Needs credential",
    readinessTone: ready ? "safe" : "warning",
    readinessDetail: null,
    lastCheckedAt: null,
    currentReadiness: ready ? "ready" : "not_connected",
    currentReadinessDetail: ready ? "Configuration resolves." : "ANTHROPIC_API_KEY is not set.",
    aiAccountId: null,
    createdAt: "2026-08-17T00:00:00.000Z",
  };
}

function fabric(overrides: Record<string, unknown> = {}) {
  return {
    bots: [
      bot(readyBotId, "Code Master", true),
      bot(offlineBotId, "Offline Bot", false),
      bot(secondBotId, "Test Engineer", true),
    ],
    roles: [
      {
        id: roleId,
        name: "Developer",
        slug: "developer",
        summary: "Builds",
        instructions: "Build",
        riskCeiling: "GREEN",
        capabilities: [],
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
    ],
    assignments: [],
    projects: [
      { id: projectId, name: "E-Commerce Platform", status: "active", githubRepository: null, healthStatus: "unknown" },
      { id: otherProjectId, name: "Mobile App", status: "active", githubRepository: null, healthStatus: "unknown" },
    ],
    ...overrides,
  };
}

function posting(botId: string, onProjectId: string) {
  return {
    id: assignmentId,
    revision: 7,
    botId,
    projectId: onProjectId,
    roleId,
    status: "active" as const,
    assignedAt: "2026-08-17T00:00:00.000Z",
    releasedAt: null,
    config: { ...LEAST_PRIVILEGE_CONFIG, maxConcurrentTasks: 3 },
  };
}

function post(body: unknown, target: string = projectId) {
  return POST(
    new Request(`https://factory.test/api/projects/${target}/bots`, {
      method: "POST",
      headers: { origin: "https://factory.test", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId: target }) },
  );
}

function patch(body: unknown) {
  return PATCH(
    new Request(`https://factory.test/api/projects/${projectId}/bots/${assignmentId}`, {
      method: "PATCH",
      headers: { origin: "https://factory.test", "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 7, ...(body as Record<string, unknown>) }),
    }),
    { params: Promise.resolve({ projectId, assignmentId }) },
  );
}

function get(target: string = projectId) {
  return GET(new Request(`https://factory.test/api/projects/${target}/bots`), {
    params: Promise.resolve({ projectId: target }),
  });
}

beforeEach(() => {
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== "assign_bots_to_project_checked") {
      return { data: [{ id: assignmentId }], error: null };
    }
    const entries = args.p_assignments as Array<Record<string, unknown>>;
    return {
      data: entries.map((entry, index) => ({
        id: index === 0 ? assignmentId : `${assignmentId}-${index}`,
        organization_id: organizationId,
        project_id: args.p_project_id,
        status: "active",
        assigned_at: "2026-08-17T00:00:00.000Z",
        released_at: null,
        revision: 1,
        model: null,
        work_effort: "medium",
        ...entry,
      })),
      error: null,
    };
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc },
  });
  loadBotFabric.mockResolvedValue(fabric());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET the bots for one project", () => {
  it("lists the roster and everything that could join it", async () => {
    loadBotFabric.mockResolvedValue(fabric({ assignments: [posting(readyBotId, projectId)] }));

    const body = await (await get()).json();

    expect(body.assigned).toHaveLength(1);
    expect(body.assigned[0].bot.name).toBe("Code Master");
    expect(body.available).toHaveLength(3);
  });

  it("returns the exact existing posting role and configuration for safe reselection", async () => {
    const existing = posting(readyBotId, projectId);
    existing.config = {
      ...existing.config,
      preset: "reviewer",
      responsibilities: ["Preserve this authored review scope"],
      instructions: "Never rewrite this posting from defaults.",
      repositoryAccess: "read",
      pipelineAccess: "assigned",
      maxConcurrentTasks: 3,
      priority: 2,
    };
    loadBotFabric.mockResolvedValue(fabric({ assignments: [existing] }));

    const body = await (await get()).json();
    const available = body.available.find((entry: { id: string }) => entry.id === readyBotId);

    expect(available).toMatchObject({
      assignable: false,
      blockedReason: expect.stringMatching(/already on this project/i),
      currentAssignmentId: assignmentId,
      currentAssignmentProjectId: projectId,
      currentAssignmentRevision: 7,
      currentRoleId: roleId,
      currentRole: { id: roleId, name: "Developer", slug: "developer" },
      currentAssignmentConfig: {
        preset: "reviewer",
        responsibilities: ["Preserve this authored review scope"],
        instructions: "Never rewrite this posting from defaults.",
        repositoryAccess: "read",
        pipelineAccess: "assigned",
        maxConcurrentTasks: 3,
        priority: 2,
      },
    });
  });

  it("shows an unconnected bot rather than hiding it, and says why", async () => {
    // Hiding it leaves someone staring at a roster with a bot missing and no
    // explanation. The picker has to name what to fix.
    const body = await (await get()).json();
    const offline = body.available.find((entry: { id: string }) => entry.id === offlineBotId);

    expect(offline.assignable).toBe(false);
    expect(offline.blockedReason).toMatch(/not set/i);
  });

  it("names the project a bot would leave, because assigning it here moves it", async () => {
    loadBotFabric.mockResolvedValue(fabric({ assignments: [posting(readyBotId, otherProjectId)] }));

    const body = await (await get()).json();
    const moving = body.available.find((entry: { id: string }) => entry.id === readyBotId);

    expect(moving.currentProjectName).toBe("Mobile App");
    expect(moving.alreadyOnThisProject).toBe(false);
  });

  it("reports the workload a bot is already carrying", async () => {
    loadBotFabric.mockResolvedValue(fabric({ assignments: [posting(readyBotId, otherProjectId)] }));

    const body = await (await get()).json();
    const busy = body.available.find((entry: { id: string }) => entry.id === readyBotId);
    const idle = body.available.find((entry: { id: string }) => entry.id === secondBotId);

    expect(busy.workload).toBe(3);
    expect(idle.workload).toBe(0);
  });

  it("refuses a project outside the organization", async () => {
    const response = await get("99999999-2222-4333-8444-555555555555");
    expect(response.status).toBe(404);
  });

  it("lets a member read the roster but not manage it", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc },
    });

    const body = await (await get()).json();
    expect(body.canManage).toBe(false);
  });
});

describe("POST a selection of bots", () => {
  it("assigns several in one call", async () => {
    const response = await post({
      bots: [
        { botId: readyBotId, roleId, config: { preset: "developer", repositoryAccess: "write", canOpenPullRequest: true } },
        { botId: secondBotId, roleId, config: { preset: "tester" } },
      ],
    });

    expect(response.status).toBe(201);
    // One transaction for the whole batch: a half-staffed project is worse
    // than a refused request, because nobody can tell which half landed.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", expect.objectContaining({
      p_project_id: projectId,
      p_assignments: expect.arrayContaining([
        expect.objectContaining({
          bot_id: readyBotId,
          repository_access: "write",
          expected_assignment_id: null,
          expected_project_id: null,
          expected_revision: null,
        }),
      ]),
    }));
    const body = await response.json();
    expect(body.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        botId: readyBotId,
        projectId,
        roleId,
        status: "active",
        config: expect.objectContaining({ repositoryAccess: "write" }),
      }),
    ]));
  });

  it("keeps atomic batch assignment working before the checked RPC exists", async () => {
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "assign_bots_to_project_checked") {
        return {
          data: null,
          error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
        };
      }
      const entries = args.p_assignments as Array<Record<string, unknown>>;
      return {
        data: entries.map((entry) => ({
          id: assignmentId,
          project_id: args.p_project_id,
          status: "active",
          assigned_at: "2026-08-17T00:00:00.000Z",
          released_at: null,
          model: null,
          work_effort: "medium",
          ...entry,
        })),
        error: null,
      };
    });

    const response = await post({
      bots: [{ botId: readyBotId, roleId, config: { preset: "developer" } }],
    });

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenNthCalledWith(2, "assign_bots_to_project", expect.objectContaining({
      p_assignments: [expect.not.objectContaining({ expected_revision: expect.anything() })],
    }));
    expect((await response.json()).assignments[0].revision).toBe(1);
  });

  it("preserves an existing posting's full config through the legacy batch fallback", async () => {
    const existing = posting(readyBotId, projectId);
    existing.config = {
      preset: "developer",
      responsibilities: ["Implement features"],
      instructions: "Preserve the authored batch scope.",
      repositoryAccess: "write",
      branchStrategy: "shared_project_branch",
      canOpenPullRequest: true,
      canMergePullRequest: false,
      pipelineAccess: "assigned",
      environmentAccess: "preview",
      tools: ["github"],
      requiresHumanApproval: true,
      maxConcurrentTasks: 3,
      priority: 1,
    };
    loadBotFabric.mockResolvedValue(fabric({ assignments: [existing] }));
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "assign_bots_to_project_checked") {
        return {
          data: null,
          error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
        };
      }
      const entries = args.p_assignments as Array<Record<string, unknown>>;
      return {
        data: entries.map((entry) => ({
          id: assignmentId,
          project_id: args.p_project_id,
          status: "active",
          assigned_at: "2026-08-17T00:00:00.000Z",
          released_at: null,
          model: null,
          work_effort: "medium",
          ...entry,
        })),
        error: null,
      };
    });

    const response = await post({ bots: [{ botId: readyBotId, roleId }] }, otherProjectId);

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenNthCalledWith(2, "assign_bots_to_project", expect.objectContaining({
      p_assignments: [expect.objectContaining({
        preset: "developer",
        responsibilities: ["Implement features"],
        instructions: "Preserve the authored batch scope.",
        repository_access: "write",
        branch_strategy: "shared_project_branch",
        can_open_pull_request: true,
        can_merge_pull_request: false,
        pipeline_access: "assigned",
        environment_access: "preview",
        tools: ["github"],
        requires_human_approval: true,
        max_concurrent_tasks: 3,
        priority: 1,
      })],
    }));
  });

  it("derives the missing part of a cached partial tuple before calling checked", async () => {
    const response = await post({
      bots: [{
        botId: readyBotId,
        roleId,
        expectedAssignmentId: null,
        expectedProjectId: null,
      }],
    });

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", expect.objectContaining({
      p_assignments: [expect.objectContaining({
        expected_assignment_id: null,
        expected_project_id: null,
        expected_revision: null,
      })],
    }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects an explicit stale batch identity component when its peers are omitted", async () => {
    loadBotFabric.mockResolvedValue(fabric({
      assignments: [posting(readyBotId, projectId)],
    }));

    const response = await post({
      bots: [{
        botId: readyBotId,
        roleId,
        expectedAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }],
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never resumes or rewrites a paused posting already on this project", async () => {
    const paused = { ...posting(readyBotId, projectId), status: "paused" as const };
    paused.config = {
      ...paused.config,
      instructions: "Keep this paused authored posting unchanged.",
      priority: 0,
    };
    loadBotFabric.mockResolvedValue(fabric({ assignments: [paused] }));

    const response = await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_paused");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never rewrites an active posting already on this project through batch assign", async () => {
    loadBotFabric.mockResolvedValue(fabric({
      assignments: [posting(readyBotId, projectId)],
    }));

    const response = await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_already_assigned_to_project");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never moves a paused posting from another project until it is resumed", async () => {
    const pausedElsewhere = {
      ...posting(readyBotId, otherProjectId),
      status: "paused" as const,
    };
    loadBotFabric.mockResolvedValue(fabric({ assignments: [pausedElsewhere] }));

    const response = await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_paused");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("catches a posting created during missing-RPC detection before legacy fallback", async () => {
    loadBotFabric
      .mockResolvedValueOnce(fabric())
      .mockResolvedValueOnce(fabric({ assignments: [posting(readyBotId, otherProjectId)] }));
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
    });

    const response = await post({ bots: [{ botId: readyBotId, roleId }] }, otherProjectId);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("catches a legacy-era config change before fallback can overwrite it", async () => {
    const initial = posting(readyBotId, projectId);
    const changed = posting(readyBotId, projectId);
    changed.config = { ...changed.config, priority: 0 };
    loadBotFabric
      .mockResolvedValueOnce(fabric({ assignments: [initial] }))
      .mockResolvedValueOnce(fabric({ assignments: [changed] }));
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
    });

    const response = await post({ bots: [{ botId: readyBotId, roleId }] }, otherProjectId);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rechecks readiness before the legacy batch fallback", async () => {
    loadBotFabric
      .mockResolvedValueOnce(fabric())
      .mockResolvedValueOnce(fabric({
        bots: [bot(readyBotId, "Code Master", false)],
      }));
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
    });

    const response = await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_not_connected");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("catches a concurrent pause before the legacy batch fallback", async () => {
    const before = posting(readyBotId, otherProjectId);
    const paused = { ...before, status: "paused" as const };
    loadBotFabric
      .mockResolvedValueOnce(fabric({ assignments: [before] }))
      .mockResolvedValueOnce(fabric({ assignments: [paused] }));
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
    });

    const response = await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_paused");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the database result does not confirm the exact role and config", async () => {
    rpc.mockResolvedValue({
      data: [{
        id: assignmentId,
        bot_id: readyBotId,
        project_id: projectId,
        role_id: roleId,
        status: "active",
        assigned_at: "2026-08-17T00:00:00.000Z",
        released_at: null,
        repository_access: "read",
        branch_strategy: "per_task_branch",
        can_open_pull_request: false,
        can_merge_pull_request: false,
        pipeline_access: "none",
        environment_access: "none",
        responsibilities: [],
        tools: [],
        requires_human_approval: true,
        max_concurrent_tasks: 1,
        priority: 2,
      }],
      error: null,
    });

    const response = await post({
      bots: [{
        botId: readyBotId,
        roleId,
        config: { repositoryAccess: "write", canOpenPullRequest: true },
      }],
    }, otherProjectId);

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("bot_assignment_write_mismatch");
  });

  it("sends least privilege when no configuration was chosen", async () => {
    await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", expect.objectContaining({
      p_assignments: [
        expect.objectContaining({
          repository_access: "read",
          can_open_pull_request: false,
          requires_human_approval: true,
          max_concurrent_tasks: 1,
        }),
      ],
    }));
  });

  it("treats omitted config as preserve for an existing posting, not reset", async () => {
    const existing = posting(readyBotId, projectId);
    existing.config = {
      ...existing.config,
      preset: "reviewer",
      responsibilities: ["Keep the authored scope"],
      instructions: "Preserve this exact posting.",
      repositoryAccess: "read",
      pipelineAccess: "assigned",
      maxConcurrentTasks: 3,
      priority: 2,
    };
    loadBotFabric.mockResolvedValue(fabric({ assignments: [existing] }));

    const response = await post({
      bots: [{
        botId: readyBotId,
        roleId,
        expectedAssignmentId: assignmentId,
        expectedProjectId: projectId,
        expectedAssignmentRevision: 7,
      }],
    }, otherProjectId);

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", expect.objectContaining({
      p_assignments: [expect.objectContaining({
        bot_id: readyBotId,
        role_id: roleId,
        expected_assignment_id: assignmentId,
        expected_project_id: projectId,
        expected_revision: 7,
        preset: "reviewer",
        responsibilities: ["Keep the authored scope"],
        instructions: "Preserve this exact posting.",
        repository_access: "read",
        pipeline_access: "assigned",
        max_concurrent_tasks: 3,
        priority: 2,
      })],
    }));
  });

  it("derives the checked identity for a cached client while still rejecting an explicit stale tuple", async () => {
    loadBotFabric.mockResolvedValue(fabric({ assignments: [posting(readyBotId, projectId)] }));

    const legacy = await post({ bots: [{ botId: readyBotId, roleId }] }, otherProjectId);
    expect(legacy.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", expect.objectContaining({
      p_assignments: [expect.objectContaining({
        expected_assignment_id: assignmentId,
        expected_project_id: projectId,
        expected_revision: 7,
      })],
    }));
    rpc.mockClear();

    const stale = await post({
      bots: [{
        botId: readyBotId,
        roleId,
        expectedAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedProjectId: projectId,
        expectedAssignmentRevision: 7,
      }],
    }, otherProjectId);
    expect(stale.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an atomic database race after roster validation to a reload conflict", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "a selected bot's current assignment changed" },
    });

    const response = await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("40001");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a bot that is not connected, without touching the database", async () => {
    const response = await post({ bots: [{ botId: offlineBotId, roleId }] });

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/Offline Bot is not connected/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses the whole selection when one bot is unconnected", async () => {
    // Assigning the healthy ones and dropping the rest would silently deliver
    // something other than what was confirmed.
    const response = await post({
      bots: [{ botId: readyBotId, roleId }, { botId: offlineBotId, roleId }],
    });

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("resolves readiness from the server, not from anything the client sent", async () => {
    // The badge the person saw may be a minute old; the credential may have
    // gone since. Only bot ids cross the wire, so this cannot be talked past.
    const response = await post({
      bots: [{ botId: offlineBotId, roleId, config: { repositoryAccess: "read" } }],
    });

    expect(response.status).toBe(409);
    expect(loadBotFabric).toHaveBeenCalled();
  });

  it("refuses the same bot twice", async () => {
    const response = await post({
      bots: [{ botId: readyBotId, roleId }, { botId: readyBotId, roleId }],
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("duplicate_bot_selected");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an incoherent permission set with the reason", async () => {
    const response = await post({
      bots: [{ botId: readyBotId, roleId, config: { repositoryAccess: "read", canOpenPullRequest: true } }],
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/write access before it can open/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses merge authority that waives approval", async () => {
    const response = await post({
      bots: [{
        botId: readyBotId,
        roleId,
        config: {
          repositoryAccess: "write",
          canOpenPullRequest: true,
          canMergePullRequest: true,
          requiresHumanApproval: false,
        },
      }],
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty selection and an oversized one", async () => {
    expect((await post({ bots: [] })).status).toBe(400);
    expect(
      (await post({
        bots: Array.from({ length: 26 }, () => ({ botId: readyBotId, roleId })),
      })).status,
    ).toBe(400);
  });

  it("refuses an unknown configuration key rather than dropping it", async () => {
    const response = await post({
      bots: [{ botId: readyBotId, roleId, config: { escalate: true } }],
    });
    expect(response.status).toBe(400);
  });

  it("refuses an ordinary member", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc },
    });

    const response = await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    const response = await POST(
      new Request(`https://factory.test/api/projects/${projectId}/bots`, {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: JSON.stringify({ bots: [{ botId: readyBotId, roleId }] }),
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("binds the write to the caller's own organization", async () => {
    await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(rpc).toHaveBeenCalledWith(
      "assign_bots_to_project_checked",
      expect.objectContaining({ p_organization_id: organizationId }),
    );
  });
});

describe("PATCH one posting", () => {
  beforeEach(() => {
    loadBotFabric.mockResolvedValue(fabric({
      assignments: [posting(readyBotId, projectId)],
    }));
  });

  it("changes permissions and status in one call", async () => {
    // Two calls would leave a window where the wider grant is live and the
    // pause is not.
    const response = await patch({ status: "paused", config: { repositoryAccess: "read" } });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_bot_assignment_configuration_checked", expect.objectContaining({
      p_assignment_id: assignmentId,
      p_expected_project_id: projectId,
      p_expected_revision: 7,
      p_status: "paused",
      p_configuration: expect.objectContaining({ repository_access: "read" }),
    }));
  });

  it("resumes a paused bot", async () => {
    await patch({ status: "active" });
    expect(rpc).toHaveBeenCalledWith(
      "update_bot_assignment_configuration_checked",
      expect.objectContaining({ p_status: "active" }),
    );
  });

  it("derives a cached client's missing revision and still uses the checked RPC", async () => {
    loadBotFabric.mockResolvedValue(fabric({ assignments: [posting(readyBotId, projectId)] }));
    const response = await PATCH(
      new Request(`https://factory.test/api/projects/${projectId}/bots/${assignmentId}`, {
        method: "PATCH",
        headers: { origin: "https://factory.test", "content-type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }),
      { params: Promise.resolve({ projectId, assignmentId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "update_bot_assignment_configuration_checked",
      expect.objectContaining({ p_expected_project_id: projectId, p_expected_revision: 7 }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps combined configuration and status writes on the legacy audited RPC", async () => {
    loadBotFabric.mockResolvedValue(fabric({ assignments: [posting(readyBotId, projectId)] }));
    rpc.mockImplementation(async (name: string) => name.endsWith("_checked")
      ? {
          data: null,
          error: {
            code: "PGRST202",
            message: "update_bot_assignment_configuration_checked is missing",
          },
        }
      : { data: [{ id: assignmentId }], error: null });

    const response = await patch({
      status: "paused",
      config: { repositoryAccess: "read" },
    });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "update_bot_assignment_configuration",
      expect.objectContaining({ p_status: "paused" }),
    );
  });

  it("rejects a config race before using the legacy configuration RPC", async () => {
    const initial = posting(readyBotId, projectId);
    const changed = posting(readyBotId, projectId);
    changed.config = { ...changed.config, priority: 0 };
    loadBotFabric
      .mockResolvedValueOnce(fabric({ assignments: [initial] }))
      .mockResolvedValueOnce(fabric({ assignments: [changed] }));
    rpc.mockImplementation(async (name: string) => name.endsWith("_checked")
      ? {
          data: null,
          error: {
            code: "PGRST202",
            message: "update_bot_assignment_configuration_checked is missing",
          },
        }
      : { data: [{ id: assignmentId }], error: null });

    const response = await patch({ config: { priority: 3 } });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects a concurrent role change before the legacy configuration RPC", async () => {
    const initial = posting(readyBotId, projectId);
    const changed = {
      ...initial,
      roleId: "66666666-2222-4333-8444-555555555555",
    };
    loadBotFabric
      .mockResolvedValueOnce(fabric({ assignments: [initial] }))
      .mockResolvedValueOnce(fabric({ assignments: [changed] }));
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "update_bot_assignment_configuration_checked is missing",
      },
    });

    const response = await patch({
      roleId: "77777777-2222-4333-8444-555555555555",
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("treats priority-only configuration as a patch and preserves every other field", async () => {
    const existing = posting(readyBotId, projectId);
    existing.config = {
      preset: "developer",
      responsibilities: ["Implement features", "Open pull requests"],
      instructions: "Keep the rest of this posting unchanged.",
      repositoryAccess: "write",
      branchStrategy: "shared_project_branch",
      canOpenPullRequest: true,
      canMergePullRequest: false,
      pipelineAccess: "assigned",
      environmentAccess: "preview",
      tools: ["github", "tests"],
      requiresHumanApproval: true,
      maxConcurrentTasks: 3,
      priority: 1,
    };
    loadBotFabric.mockResolvedValue(fabric({ assignments: [existing] }));

    const response = await patch({ config: { priority: 0 } });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "update_bot_assignment_configuration_checked",
      expect.objectContaining({
        p_configuration: {
          preset: "developer",
          responsibilities: ["Implement features", "Open pull requests"],
          instructions: "Keep the rest of this posting unchanged.",
          repository_access: "write",
          branch_strategy: "shared_project_branch",
          can_open_pull_request: true,
          can_merge_pull_request: false,
          pipeline_access: "assigned",
          environment_access: "preview",
          tools: ["github", "tests"],
          requires_human_approval: true,
          max_concurrent_tasks: 3,
          priority: 0,
        },
      }),
    );
  });

  it("will not release through the status field, so removal has one path", async () => {
    const response = await patch({ status: "released" });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an incoherent permission set", async () => {
    const response = await patch({ config: { repositoryAccess: "none", canOpenPullRequest: true } });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an ordinary member", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc },
    });

    expect((await patch({ status: "paused" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a posting that does not exist rather than claiming success", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await patch({ status: "paused" })).status).toBe(404);
  });

  it("maps a stale revision detected under the row lock to conflict", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "the posting changed" },
    });

    const response = await patch({ status: "paused" });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("40001");
  });
});

describe("DELETE one posting", () => {
  beforeEach(() => {
    loadBotFabric.mockResolvedValue(fabric({
      assignments: [posting(readyBotId, projectId)],
    }));
  });

  function remove() {
    return DELETE(
      new Request(`https://factory.test/api/projects/${projectId}/bots/${assignmentId}`, {
        method: "DELETE",
        headers: { origin: "https://factory.test", "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 7 }),
      }),
      { params: Promise.resolve({ projectId, assignmentId }) },
    );
  }

  it("releases the posting rather than deleting the record", async () => {
    const response = await remove();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_bot_assignment_checked", expect.objectContaining({
      p_assignment_id: assignmentId,
      p_expected_project_id: projectId,
      p_expected_revision: 7,
      p_status: "released",
    }));
  });

  it("accepts a cached client's bodyless release and derives the checked revision", async () => {
    loadBotFabric.mockResolvedValue(fabric({ assignments: [posting(readyBotId, projectId)] }));
    const response = await DELETE(
      new Request(`https://factory.test/api/projects/${projectId}/bots/${assignmentId}`, {
        method: "DELETE",
        headers: { origin: "https://factory.test" },
      }),
      { params: Promise.resolve({ projectId, assignmentId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_bot_assignment_checked", expect.objectContaining({
      p_expected_project_id: projectId,
      p_expected_revision: 7,
    }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps release working on the legacy audited status RPC", async () => {
    loadBotFabric.mockResolvedValue(fabric({ assignments: [posting(readyBotId, projectId)] }));
    rpc.mockImplementation(async (name: string) => name === "update_bot_assignment_checked"
      ? {
          data: null,
          error: { code: "PGRST202", message: "update_bot_assignment_checked is missing" },
        }
      : { data: [{ id: assignmentId }], error: null });

    const response = await remove();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(2, "update_bot_assignment", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_status: "released",
    });
  });

  it("rejects a concurrent role change before the legacy release RPC", async () => {
    const initial = posting(readyBotId, projectId);
    const changed = {
      ...initial,
      roleId: "66666666-2222-4333-8444-555555555555",
    };
    loadBotFabric
      .mockResolvedValueOnce(fabric({ assignments: [initial] }))
      .mockResolvedValueOnce(fabric({ assignments: [changed] }));
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "update_bot_assignment_checked is missing" },
    });

    const response = await remove();

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses an ordinary member", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc },
    });

    expect((await remove()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a moved or revised posting to conflict instead of releasing it", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "the posting changed" },
    });

    const response = await remove();

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("40001");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a cross-origin request", async () => {
    const response = await DELETE(
      new Request(`https://factory.test/api/projects/${projectId}/bots/${assignmentId}`, {
        method: "DELETE",
        headers: { origin: "https://evil.test" },
      }),
      { params: Promise.resolve({ projectId, assignmentId }) },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
