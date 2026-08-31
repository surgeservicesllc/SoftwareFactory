// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  assertSameOriginRequest: vi.fn(),
  requireActiveOrganization: vi.fn(),
  readBoundedJson: vi.fn(),
  findSensitiveData: vi.fn(),
  buildPlan: vi.fn(),
  createServiceClient: vi.fn(),
  readProject: vi.fn(),
  createSession: vi.fn(),
  appendUser: vi.fn(),
  recordPlanningFailure: vi.fn(),
  readBundle: vi.fn(),
  storedFailure: vi.fn(),
  storedPlan: vi.fn(),
  loadAgents: vi.fn(),
  appendAssistant: vi.fn(),
  recordEvent: vi.fn(),
  mapDetail: vi.fn(),
  listRows: vi.fn(),
  mapList: vi.fn(),
  plannedGraphLink: vi.fn(),
  buildCanonicalPlan: vi.fn(),
  resolveRelease: vi.fn(),
  serviceRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/request", () => ({
  assertSameOriginRequest: harness.assertSameOriginRequest,
}));
vi.mock("@/lib/supabase/tenant", () => ({
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/security/sensitive-data", () => ({
  findSensitiveData: harness.findSensitiveData,
}));
vi.mock("@/lib/factory/chief-of-staff", () => ({
  buildGrokChiefOfStaffPlan: harness.buildPlan,
}));
vi.mock("@/lib/graph/canonical-full-lifecycle", () => ({
  buildCanonicalFullLifecyclePlan: harness.buildCanonicalPlan,
  resolveCanonicalFullLifecycleReleaseIdentity: harness.resolveRelease,
}));
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: harness.createServiceClient,
}));
vi.mock("@/lib/grok/session-store", async () => {
  class GrokStoreDatabaseError extends Error {
    databaseError = {};
  }
  return {
    GrokStoreDatabaseError,
    grokSessionTitle: (prompt: string) => prompt,
    readGrokProject: harness.readProject,
    createGrokSession: harness.createSession,
    appendGrokUserMessage: harness.appendUser,
    recordGrokPlanningFailure: harness.recordPlanningFailure,
    readGrokBundle: harness.readBundle,
    storedGrokPlanningFailure: harness.storedFailure,
    storedGrokPlan: harness.storedPlan,
    loadConfiguredGrokAgents: harness.loadAgents,
    appendGrokAssistantPlan: harness.appendAssistant,
    recordGrokEvent: harness.recordEvent,
    mapGrokSessionDetail: harness.mapDetail,
    listGrokSessionRows: harness.listRows,
    mapGrokSessionList: harness.mapList,
    plannedGraphLink: harness.plannedGraphLink,
  };
});
vi.mock("@/lib/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/http")>();
  return { ...actual, readBoundedJson: harness.readBoundedJson };
});

import { POST } from "@/app/api/grok/sessions/route";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";
const userMessageId = "40000000-0000-4000-8000-000000000004";
const assistantMessageId = "50000000-0000-4000-8000-000000000005";
const graphId = "70000000-0000-4000-8000-000000000007";
const repositoryId = "80000000-0000-4000-8000-000000000008";
const baseSha = "a".repeat(40);
const requiredChecks = ["Lint, typecheck, test, and build"];
const planningFailureMessage =
  "Planning is blocked until a Ready configured Codex agent covers the repository-writing task.";

const plan = {
  planner: { version: 1 },
  intent: { kind: "build", prompt: "Build the portal" },
  project: { projectId },
  dag: { tasks: [{ id: "implement", provider: "openai" }], layers: [["implement"]] },
  graphLaunch: { goal: "Build the portal" },
};

const canonicalPlan = {
  goal: "Build the portal",
  topology: "DAG",
  topologyReasons: [{ code: "DEPENDENCIES", detail: "The release stages are ordered." }],
  riskLevel: "yellow",
  requiresOwnerApproval: true,
  nodes: [{ node_key: "goal", executor: "MODEL" }],
  edges: [{ from_node_key: "goal", to_node_key: "requirements" }],
  budget: { max_nodes: 14, max_concurrent_nodes: 3 },
};

const bundle = {
  session: { id: sessionId, project_id: projectId, status: "active", version: 2 },
  messages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc: vi.fn() },
    user: { id: "60000000-0000-4000-8000-000000000006" },
  });
  harness.readBoundedJson.mockResolvedValue({
    projectId,
    prompt: "Build the portal",
    idempotencyKey: "request-key-123",
  });
  harness.findSensitiveData.mockReturnValue(null);
  harness.readProject.mockResolvedValue({
    projectId,
    name: "Factory",
    repositoryFullName: "surgeservicesllc/SoftwareFactory",
    defaultBranch: "main",
    productionUrl: null,
    status: "active",
  });
  harness.createSession.mockResolvedValue({ id: sessionId });
  harness.appendUser.mockResolvedValue({ id: userMessageId });
  harness.recordPlanningFailure.mockResolvedValue({
    session: { id: sessionId, status: "blocked", version: 5 },
    message: { id: assistantMessageId, content: planningFailureMessage },
    event: { event_type: "session.planning_failed" },
  });
  harness.readBundle.mockResolvedValue(bundle);
  harness.storedFailure.mockReturnValue(null);
  harness.storedPlan.mockReturnValue(null);
  harness.plannedGraphLink.mockReturnValue(null);
  harness.loadAgents.mockResolvedValue([]);
  harness.buildPlan.mockReturnValue({ ok: true, plan });
  harness.serviceRpc.mockResolvedValue({ data: { graph_id: graphId }, error: null });
  harness.createServiceClient.mockReturnValue({ rpc: harness.serviceRpc });
  harness.buildCanonicalPlan.mockReturnValue({
    ok: true,
    template: { key: "full_lifecycle", version: 2 },
    plan: canonicalPlan,
  });
  harness.resolveRelease.mockResolvedValue({
    ok: true,
    target: { repository_id: repositoryId, base_branch: "main" },
    baseSha,
    requiredChecks,
  });
  harness.appendAssistant.mockResolvedValue({ id: assistantMessageId });
  harness.recordEvent.mockResolvedValue({});
  harness.mapDetail.mockResolvedValue({
    session: {
      id: sessionId,
      projectId,
      projectName: "Factory",
      title: "Build the portal",
      goal: "Build the portal",
      status: "paused",
      commandId: null,
      graphId,
      graphRunId: null,
      createdAt: "2026-08-30T20:00:00.000Z",
      updatedAt: "2026-08-30T20:00:00.000Z",
      allowedActions: [],
    },
    messages: [], tasks: [], events: [], artifacts: [],
  });
});

describe("Grok sessions POST", () => {
  it("durably blocks a planning failure without persisting prompt or planner details", async () => {
    harness.buildPlan.mockReturnValue({
      ok: false,
      error: {
        code: "MISSING_CODEX_AGENT",
        message: "No ready configured Codex agent can cover the repository-writing task.",
        details: ["implementation/STRONG"],
      },
    });
    harness.readBundle.mockResolvedValue({
      ...bundle,
      session: { ...bundle.session, version: 2 },
    });

    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      sessionId,
      session: { id: sessionId, status: "blocked", version: 5 },
      workerWoken: false,
      executionStarted: false,
      error: {
        code: "MISSING_CODEX_AGENT",
        message: planningFailureMessage,
      },
    });
    expect(body.error.details).toBeUndefined();
    expect(harness.recordPlanningFailure).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId,
        sessionId,
        userMessageId,
        idempotencyKey: "request-key-123",
        code: "MISSING_CODEX_AGENT",
        expectedVersion: 2,
      },
    );
    expect(harness.recordEvent).not.toHaveBeenCalled();
    expect(harness.appendAssistant).not.toHaveBeenCalled();
    expect(harness.buildCanonicalPlan).not.toHaveBeenCalled();
    expect(harness.resolveRelease).not.toHaveBeenCalled();
    expect(harness.serviceRpc).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.recordPlanningFailure.mock.calls)).not.toContain("Build the portal");
    expect(JSON.stringify(harness.recordPlanningFailure.mock.calls)).not.toContain("implementation/STRONG");
  });

  it("replays a durable refusal without re-planning after the bot roster changes", async () => {
    harness.buildPlan.mockReturnValueOnce({
      ok: false,
      error: {
        code: "MISSING_CODEX_AGENT",
        message: "No ready configured Codex agent can cover the repository-writing task.",
        details: ["implementation/STRONG"],
      },
    }).mockReturnValue({ ok: true, plan });
    harness.readBundle
      .mockResolvedValueOnce(bundle)
      .mockResolvedValueOnce({
        ...bundle,
        session: { ...bundle.session, status: "blocked", version: 5 },
      });
    harness.storedFailure
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        code: "MISSING_CODEX_AGENT",
        message: planningFailureMessage,
        messageId: assistantMessageId,
      });

    const request = () => POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));
    const first = await request();
    const second = await request();

    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect(await first.json()).toEqual(await second.json());
    expect(harness.recordPlanningFailure).toHaveBeenCalledTimes(1);
    expect(harness.buildPlan).toHaveBeenCalledTimes(1);
    expect(harness.loadAgents).toHaveBeenCalledTimes(1);
    expect(harness.recordEvent).not.toHaveBeenCalled();
    expect(harness.serviceRpc).not.toHaveBeenCalled();
  });

  it("returns a concurrent durable refusal when another planner result wins the same request", async () => {
    harness.buildPlan.mockReturnValue({
      ok: false,
      error: {
        code: "MISSING_CODEX_AGENT",
        message: "No ready configured Codex agent can cover the repository-writing task.",
        details: ["implementation/STRONG"],
      },
    });
    harness.recordPlanningFailure.mockRejectedValueOnce(new Error("grok planning failure idempotency key was reused with different input"));
    harness.readBundle
      .mockResolvedValueOnce(bundle)
      .mockResolvedValueOnce({
        ...bundle,
        session: { ...bundle.session, status: "blocked", version: 5 },
      });
    harness.storedFailure
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        code: "MISSING_CLAUDE_AGENT",
        message: "Planning is blocked until a Ready configured Claude agent covers every required planning and verification task.",
        messageId: assistantMessageId,
      });

    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      sessionId,
      session: { status: "blocked", version: 5 },
      error: {
        code: "MISSING_CLAUDE_AGENT",
        message: expect.stringMatching(/configured Claude agent/),
      },
      workerWoken: false,
      executionStarted: false,
    });
    expect(harness.readBundle).toHaveBeenCalledTimes(2);
    expect(harness.serviceRpc).not.toHaveBeenCalled();
  });

  it("records routing intent, launches only canonical v2, and returns paused without dispatch", async () => {
    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      session: { id: sessionId, status: "paused", graphId },
      workerWoken: false,
      executionStarted: false,
      execution: { state: "paused", bridge: "full_lifecycle_v2" },
    });
    expect(harness.appendUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prompt: "Build the portal",
      idempotencyKey: "request-key-123",
    }));
    expect(harness.appendAssistant).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      plan,
      userMessageId,
    }));
    expect(harness.recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "session.planned",
      expectedSequence: 3,
    }));
    expect(harness.serviceRpc).toHaveBeenCalledTimes(1);
    expect(harness.serviceRpc).toHaveBeenCalledWith(
      "launch_grok_full_lifecycle_as_server",
      {
        p_organization_id: organizationId,
        p_requested_by: "60000000-0000-4000-8000-000000000006",
        p_project_id: projectId,
        p_session_id: sessionId,
        p_message_id: assistantMessageId,
        p_idempotency_key: "request-key-123",
        p_goal: canonicalPlan.goal,
        p_topology: canonicalPlan.topology,
        p_topology_reasons: canonicalPlan.topologyReasons,
        p_risk_level: canonicalPlan.riskLevel,
        p_requires_owner_approval: canonicalPlan.requiresOwnerApproval,
        p_nodes: canonicalPlan.nodes,
        p_edges: canonicalPlan.edges,
        p_budget: canonicalPlan.budget,
        p_github_repository_id: repositoryId,
        p_base_branch: "main",
        p_base_sha: baseSha,
        p_required_check_names: requiredChecks,
      },
    );
    expect(harness.serviceRpc).not.toHaveBeenCalledWith(
      "launch_grok_graph_for_session",
      expect.anything(),
    );
    expect(harness.serviceRpc).not.toHaveBeenCalledWith(
      "create_graph_from_plan",
      expect.anything(),
    );
  });

  it("replays the existing paused graph without resolving a changed branch or creating another graph", async () => {
    harness.storedPlan.mockReturnValue(plan);
    harness.readBundle.mockResolvedValue({
      ...bundle,
      messages: [{ id: assistantMessageId, sequence_no: 2, role: "assistant" }],
    });
    harness.plannedGraphLink.mockReturnValue({ graph_id: graphId, relation: "planned" });

    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));

    expect(response.status).toBe(202);
    expect(harness.buildCanonicalPlan).not.toHaveBeenCalled();
    expect(harness.resolveRelease).not.toHaveBeenCalled();
    expect(harness.serviceRpc).not.toHaveBeenCalled();
  });

  it("reports durable run evidence truthfully when a replay finds the graph already running", async () => {
    const graphRunId = "90000000-0000-4000-8000-000000000009";
    harness.storedPlan.mockReturnValue(plan);
    harness.readBundle.mockResolvedValue({
      ...bundle,
      messages: [{ id: assistantMessageId, sequence_no: 2, role: "assistant" }],
    });
    harness.plannedGraphLink.mockReturnValue({ graph_id: graphId, relation: "planned" });
    harness.mapDetail.mockResolvedValue({
      session: {
        id: sessionId,
        projectId,
        projectName: "Factory",
        title: "Build the portal",
        goal: "Build the portal",
        status: "running",
        commandId: null,
        graphId,
        graphRunId,
        createdAt: "2026-08-30T20:00:00.000Z",
        updatedAt: "2026-08-30T20:01:00.000Z",
        allowedActions: ["pause", "cancel"],
      },
      messages: [], tasks: [], events: [], artifacts: [],
    });

    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      session: { status: "running", graphId, graphRunId },
      workerWoken: false,
      executionStarted: true,
      execution: {
        state: "running",
        bridge: "full_lifecycle_v2",
        message: expect.stringMatching(/durable graph run is linked.*request did not dispatch/i),
      },
    });
    expect(body.execution.message).not.toMatch(/is durable and paused/i);
    expect(harness.resolveRelease).not.toHaveBeenCalled();
    expect(harness.serviceRpc).not.toHaveBeenCalled();
  });

  it("rejects secret-shaped prompts before authentication or persistence", async () => {
    harness.findSensitiveData.mockReturnValue({ reason: "secret-shaped token" });
    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(400);
    expect(harness.requireActiveOrganization).not.toHaveBeenCalled();
    expect(harness.createSession).not.toHaveBeenCalled();
  });

  it("requires owner authority before reading the tenant project", async () => {
    harness.requireActiveOrganization.mockResolvedValueOnce({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc: vi.fn() },
    });
    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(403);
    expect(harness.readProject).not.toHaveBeenCalled();
  });
});

