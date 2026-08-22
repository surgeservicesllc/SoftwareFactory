// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireBotFabricManager = vi.fn();
vi.mock("@/lib/bots/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/route")>("@/lib/bots/route");
  return { ...actual, requireBotFabricManager };
});

const loadBotFabric = vi.fn();
vi.mock("@/lib/bots/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/service")>("@/lib/bots/service");
  return { ...actual, loadBotFabric };
});

const { PATCH } = await import("@/app/api/bot-assignments/[assignmentId]/route");
const { POST } = await import("@/app/api/bot-assignments/route");

const organizationId = "11111111-2222-4333-8444-555555555555";
const projectId = "22222222-2222-4333-8444-555555555555";
const otherProjectId = "22222222-2222-4333-8444-555555555556";
const assignmentId = "33333333-2222-4333-8444-555555555555";
const rpc = vi.fn();
const single = vi.fn();

const preservedConfig = {
  preset: "developer",
  responsibilities: ["Implement features"],
  instructions: "Keep this authored scope.",
  repositoryAccess: "write" as const,
  branchStrategy: "shared_project_branch" as const,
  canOpenPullRequest: true,
  canMergePullRequest: false,
  pipelineAccess: "assigned" as const,
  environmentAccess: "preview" as const,
  tools: ["github"],
  requiresHumanApproval: true,
  maxConcurrentTasks: 3,
  priority: 1,
};

const readyBot = {
  id: "44444444-2222-4333-8444-555555555555",
  name: "Claude",
  currentReadiness: "ready",
  currentReadinessDetail: "Configuration resolves.",
};

const preservedDatabaseConfig = {
  preset: "developer",
  responsibilities: ["Implement features"],
  instructions: "Keep this authored scope.",
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
};

function request(body: unknown) {
  return new Request(`https://factory.test/api/bot-assignments/${assignmentId}`, {
    method: "PATCH",
    headers: { origin: "https://factory.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assignRequest(body: unknown) {
  return new Request("https://factory.test/api/bot-assignments", {
    method: "POST",
    headers: { origin: "https://factory.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const assignmentRow = {
  id: assignmentId,
  revision: 8,
  bot_id: "44444444-2222-4333-8444-555555555555",
  project_id: projectId,
  role_id: "55555555-2222-4333-8444-555555555555",
  status: "active",
  assigned_at: "2026-08-22T00:00:00.000Z",
  released_at: null,
  model: "claude-opus-5",
  work_effort: "high",
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReturnValue({ single });
  single.mockResolvedValue({ data: assignmentRow, error: null });
  requireBotFabricManager.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc },
  });
  loadBotFabric.mockResolvedValue({
    bots: [readyBot],
    roles: [],
    projects: [],
    assignments: [{
      id: assignmentId,
      revision: 7,
      botId: assignmentRow.bot_id,
      projectId,
      roleId: assignmentRow.role_id,
      status: "active",
      assignedAt: assignmentRow.assigned_at,
      releasedAt: null,
      model: assignmentRow.model,
      workEffort: assignmentRow.work_effort,
      config: preservedConfig,
    }],
  });
});

describe("PATCH /api/bot-assignments/[assignmentId]", () => {
  it("binds execution changes to the selected project and revision", async () => {
    const response = await PATCH(request({
      model: "claude-opus-5",
      workEffort: "high",
      expectedProjectId: projectId,
      expectedRevision: 7,
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_bot_assignment_execution_checked", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_expected_project_id: projectId,
      p_expected_revision: 7,
      p_model: "claude-opus-5",
      p_work_effort: "high",
    });
    expect((await response.json()).assignment).toMatchObject({ id: assignmentId, revision: 8 });
  });

  it("derives execution identity for a cached client and calls checked first", async () => {
    const response = await PATCH(request({
      model: "claude-opus-5",
      workEffort: "high",
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_bot_assignment_execution_checked", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_expected_project_id: projectId,
      p_expected_revision: 7,
      p_model: "claude-opus-5",
      p_work_effort: "high",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps execution preferences writable through the legacy RPC", async () => {
    const before = await loadBotFabric();
    loadBotFabric
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({
        ...before,
        assignments: before.assignments.map((assignment: Record<string, unknown>) => ({
          ...assignment,
          revision: 8,
        })),
      });
    single
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message: "set_bot_assignment_execution_checked is missing",
        },
      })
      .mockResolvedValueOnce({
        data: {
          assignment_id: assignmentId,
          model: "claude-opus-5",
          work_effort: "high",
        },
        error: null,
      });

    const response = await PATCH(request({
      model: "claude-opus-5",
      workEffort: "high",
      expectedProjectId: projectId,
      expectedRevision: 7,
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(2, "set_bot_assignment_execution", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_model: "claude-opus-5",
      p_work_effort: "high",
    });
    expect((await response.json()).assignment).toMatchObject({ revision: 8, workEffort: "high" });
  });

  it("rejects a concurrent role change before the legacy execution RPC", async () => {
    const before = await loadBotFabric();
    loadBotFabric
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({
        ...before,
        assignments: before.assignments.map((assignment: Record<string, unknown>) => ({
          ...assignment,
          roleId: "66666666-2222-4333-8444-555555555555",
        })),
      });
    single.mockResolvedValueOnce({
      data: null,
      error: {
        code: "PGRST202",
        message: "set_bot_assignment_execution_checked is missing",
      },
    });

    const response = await PATCH(request({
      model: "claude-opus-5",
      expectedProjectId: projectId,
      expectedRevision: 7,
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("binds lifecycle changes to the selected project and revision", async () => {
    const response = await PATCH(request({
      status: "paused",
      expectedProjectId: projectId,
      expectedRevision: 7,
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_bot_assignment_checked", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_expected_project_id: projectId,
      p_expected_revision: 7,
      p_status: "paused",
    });
  });

  it("derives lifecycle identity for a cached client and calls checked first", async () => {
    const response = await PATCH(request({ status: "paused" }), {
      params: Promise.resolve({ assignmentId }),
    });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_bot_assignment_checked", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_expected_project_id: projectId,
      p_expected_revision: 7,
      p_status: "paused",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps pause/release lifecycle writes on the legacy audited RPC", async () => {
    single
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "update_bot_assignment_checked is missing" },
      })
      .mockResolvedValueOnce({
        data: { ...assignmentRow, revision: undefined, status: "released" },
        error: null,
      });

    const response = await PATCH(request({
      status: "released",
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(2, "update_bot_assignment", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_status: "released",
    });
    expect((await response.json()).assignment.revision).toBe(1);
  });

  it("rejects a concurrent role change before the legacy lifecycle RPC", async () => {
    const before = await loadBotFabric();
    loadBotFabric
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({
        ...before,
        assignments: before.assignments.map((assignment: Record<string, unknown>) => ({
          ...assignment,
          roleId: "66666666-2222-4333-8444-555555555555",
        })),
      });
    single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "update_bot_assignment_checked is missing" },
    });

    const response = await PATCH(request({
      status: "paused",
      expectedProjectId: projectId,
      expectedRevision: 7,
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("maps a row-locked stale revision to conflict", async () => {
    single.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "the posting changed" },
    });

    const response = await PATCH(request({
      status: "paused",
      expectedProjectId: projectId,
      expectedRevision: 7,
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("40001");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("never retries an execution permission refusal through legacy", async () => {
    single.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });

    const response = await PATCH(request({
      model: "claude-opus-5",
      expectedProjectId: projectId,
      expectedRevision: 7,
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "set_bot_assignment_execution_checked",
      expect.any(Object),
    );
  });

  it("rejects an explicit stale execution project when the revision peer is omitted", async () => {
    const response = await PATCH(request({
      model: "claude-opus-5",
      expectedProjectId: "66666666-2222-4333-8444-555555555555",
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an explicit stale lifecycle revision when the project peer is omitted", async () => {
    const response = await PATCH(request({
      status: "paused",
      expectedRevision: 6,
    }), { params: Promise.resolve({ assignmentId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/bot-assignments", () => {
  it("routes a first posting through the checked batch transaction", async () => {
    loadBotFabric.mockResolvedValue({
      bots: [readyBot], roles: [], projects: [], assignments: [],
    });
    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId,
      roleId: assignmentRow.role_id,
      expectedAssignmentId: null,
      expectedProjectId: null,
      expectedRevision: null,
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", {
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_assignments: [{
        bot_id: assignmentRow.bot_id,
        role_id: assignmentRow.role_id,
        expected_assignment_id: null,
        expected_project_id: null,
        expected_revision: null,
      }],
    });
  });

  it("keeps a first posting writable through the legacy atomic batch RPC", async () => {
    loadBotFabric.mockResolvedValue({
      bots: [readyBot], roles: [], projects: [], assignments: [],
    });
    single
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
      })
      .mockResolvedValueOnce({
        data: { ...assignmentRow, revision: undefined },
        error: null,
      });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId: otherProjectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenNthCalledWith(2, "assign_bots_to_project", {
      p_organization_id: organizationId,
      p_project_id: otherProjectId,
      p_assignments: [{
        bot_id: assignmentRow.bot_id,
        role_id: assignmentRow.role_id,
      }],
    });
    expect((await response.json()).assignment.revision).toBe(1);
  });

  it("never retries a checked assignment refusal through legacy", async () => {
    single.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId: otherProjectId,
      roleId: assignmentRow.role_id,
      expectedAssignmentId: assignmentId,
      expectedProjectId: projectId,
      expectedRevision: 7,
    }));

    expect(response.status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", expect.any(Object));
  });

  it("derives an existing posting identity for a cached caller", async () => {
    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId: otherProjectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", {
      p_organization_id: organizationId,
      p_project_id: otherProjectId,
      p_assignments: [{
        bot_id: assignmentRow.bot_id,
        role_id: assignmentRow.role_id,
        expected_assignment_id: assignmentId,
        expected_project_id: projectId,
        expected_revision: 7,
        ...preservedDatabaseConfig,
      }],
    });
  });

  it("preserves every existing configuration field through the legacy reassign fallback", async () => {
    single
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
      })
      .mockResolvedValueOnce({ data: { ...assignmentRow, revision: undefined }, error: null });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId: otherProjectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenNthCalledWith(2, "assign_bots_to_project", {
      p_organization_id: organizationId,
      p_project_id: otherProjectId,
      p_assignments: [{
        bot_id: assignmentRow.bot_id,
        role_id: assignmentRow.role_id,
        ...preservedDatabaseConfig,
      }],
    });
  });

  it("rechecks readiness before the legacy assignment fallback", async () => {
    const currentAssignment = {
      id: assignmentId,
      revision: 7,
      botId: assignmentRow.bot_id,
      projectId,
      roleId: assignmentRow.role_id,
      status: "active",
      assignedAt: assignmentRow.assigned_at,
      releasedAt: null,
      model: assignmentRow.model,
      workEffort: assignmentRow.work_effort,
      config: preservedConfig,
    };
    loadBotFabric
      .mockResolvedValueOnce({
        bots: [readyBot], roles: [], projects: [], assignments: [currentAssignment],
      })
      .mockResolvedValueOnce({
        bots: [{
          ...readyBot,
          currentReadiness: "not_connected",
          currentReadinessDetail: "Credential disappeared.",
        }],
        roles: [],
        projects: [],
        assignments: [currentAssignment],
      });
    single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
    });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId: otherProjectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_not_connected");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("catches a concurrent role change before the legacy move fallback", async () => {
    const currentAssignment = {
      id: assignmentId,
      revision: 7,
      botId: assignmentRow.bot_id,
      projectId,
      roleId: assignmentRow.role_id,
      status: "active",
      assignedAt: assignmentRow.assigned_at,
      releasedAt: null,
      model: assignmentRow.model,
      workEffort: assignmentRow.work_effort,
      config: preservedConfig,
    };
    loadBotFabric
      .mockResolvedValueOnce({
        bots: [readyBot], roles: [], projects: [], assignments: [currentAssignment],
      })
      .mockResolvedValueOnce({
        bots: [readyBot],
        roles: [],
        projects: [],
        assignments: [{
          ...currentAssignment,
          roleId: "88888888-2222-4333-8444-555555555555",
        }],
      });
    single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
    });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId: otherProjectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("catches a concurrent pause before the legacy move fallback", async () => {
    const before = await loadBotFabric();
    loadBotFabric
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({
        ...before,
        assignments: before.assignments.map((assignment: Record<string, unknown>) => ({
          ...assignment,
          status: "paused",
        })),
      });
    single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "assign_bots_to_project_checked is missing" },
    });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId: otherProjectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_paused");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses to silently resume a paused posting through assignment", async () => {
    const pausedFabric = await loadBotFabric();
    loadBotFabric.mockResolvedValue({
      ...pausedFabric,
      assignments: pausedFabric.assignments.map((assignment: Record<string, unknown>) => ({
        ...assignment,
        status: "paused",
      })),
    });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId: otherProjectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_paused");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("changes an active same-project role without resetting status or assigned time", async () => {
    const newRoleId = "77777777-2222-4333-8444-555555555555";
    single.mockResolvedValue({
      data: { ...assignmentRow, role_id: newRoleId, assigned_at: assignmentRow.assigned_at },
      error: null,
    });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId,
      roleId: newRoleId,
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("update_bot_assignment_configuration_checked", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_expected_project_id: projectId,
      p_expected_revision: 7,
      p_configuration: preservedDatabaseConfig,
      p_role_id: newRoleId,
      p_status: null,
    });
    expect(rpc).not.toHaveBeenCalledWith("assign_bots_to_project_checked", expect.any(Object));
    expect((await response.json()).assignment).toMatchObject({
      status: "active",
      assignedAt: assignmentRow.assigned_at,
      roleId: newRoleId,
    });
  });

  it("preserves a same-project posting through the legacy role-update fallback", async () => {
    const newRoleId = "77777777-2222-4333-8444-555555555555";
    single
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message: "update_bot_assignment_configuration_checked is missing",
        },
      })
      .mockResolvedValueOnce({
        data: { ...assignmentRow, role_id: newRoleId, revision: undefined },
        error: null,
      });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId,
      roleId: newRoleId,
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenNthCalledWith(2, "update_bot_assignment_configuration", {
      p_organization_id: organizationId,
      p_assignment_id: assignmentId,
      p_configuration: preservedDatabaseConfig,
      p_role_id: newRoleId,
      p_status: null,
    });
    expect(rpc).not.toHaveBeenCalledWith("assign_bots_to_project", expect.any(Object));
  });

  it("requires resume when a same-project posting pauses during checked-RPC detection", async () => {
    const before = await loadBotFabric();
    loadBotFabric
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({
        ...before,
        assignments: before.assignments.map((assignment: Record<string, unknown>) => ({
          ...assignment,
          status: "paused",
        })),
      });
    single.mockResolvedValueOnce({
      data: null,
      error: {
        code: "PGRST202",
        message: "update_bot_assignment_configuration_checked is missing",
      },
    });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId,
      roleId: "77777777-2222-4333-8444-555555555555",
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_paused");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects an explicit stale tuple component even when cached peers are omitted", async () => {
    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId,
      roleId: assignmentRow.role_id,
      expectedProjectId: "66666666-2222-4333-8444-555555555555",
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_assignment_changed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing-credential bot before any assignment RPC", async () => {
    loadBotFabric.mockResolvedValue({
      bots: [{
        ...readyBot,
        currentReadiness: "not_connected",
        currentReadinessDetail: "Credential is missing.",
      }],
      roles: [],
      projects: [],
      assignments: [],
    });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("bot_not_connected");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("derives a null tuple for a cached caller's first posting", async () => {
    loadBotFabric.mockResolvedValue({
      bots: [readyBot], roles: [], projects: [], assignments: [],
    });

    const response = await POST(assignRequest({
      botId: assignmentRow.bot_id,
      projectId,
      roleId: assignmentRow.role_id,
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project_checked", expect.objectContaining({
      p_assignments: [expect.objectContaining({
        expected_assignment_id: null,
        expected_project_id: null,
        expected_revision: null,
      })],
    }));
  });
});
