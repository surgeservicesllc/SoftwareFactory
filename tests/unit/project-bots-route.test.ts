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
      body: JSON.stringify(body),
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
  rpc.mockResolvedValue({ data: [{ id: assignmentId }], error: null });
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
    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project", expect.objectContaining({
      p_project_id: projectId,
      p_assignments: expect.arrayContaining([
        expect.objectContaining({ bot_id: readyBotId, repository_access: "write" }),
      ]),
    }));
  });

  it("sends least privilege when no configuration was chosen", async () => {
    await post({ bots: [{ botId: readyBotId, roleId }] });

    expect(rpc).toHaveBeenCalledWith("assign_bots_to_project", expect.objectContaining({
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
      "assign_bots_to_project",
      expect.objectContaining({ p_organization_id: organizationId }),
    );
  });
});

describe("PATCH one posting", () => {
  it("changes permissions and status in one call", async () => {
    // Two calls would leave a window where the wider grant is live and the
    // pause is not.
    const response = await patch({ status: "paused", config: { repositoryAccess: "read" } });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_bot_assignment_configuration", expect.objectContaining({
      p_assignment_id: assignmentId,
      p_status: "paused",
      p_configuration: expect.objectContaining({ repository_access: "read" }),
    }));
  });

  it("resumes a paused bot", async () => {
    await patch({ status: "active" });
    expect(rpc).toHaveBeenCalledWith(
      "update_bot_assignment_configuration",
      expect.objectContaining({ p_status: "active" }),
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
});

describe("DELETE one posting", () => {
  function remove() {
    return DELETE(
      new Request(`https://factory.test/api/projects/${projectId}/bots/${assignmentId}`, {
        method: "DELETE",
        headers: { origin: "https://factory.test" },
      }),
      { params: Promise.resolve({ projectId, assignmentId }) },
    );
  }

  it("releases the posting rather than deleting the record", async () => {
    const response = await remove();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_bot_assignment", expect.objectContaining({
      p_assignment_id: assignmentId,
      p_status: "released",
    }));
  });

  it("refuses an ordinary member", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc },
    });

    expect((await remove()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
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
