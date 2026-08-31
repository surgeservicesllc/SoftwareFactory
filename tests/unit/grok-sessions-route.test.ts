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
  recordRoster: vi.fn(),
  recordEvent: vi.fn(),
  recordContext: vi.fn(),
  mapDetail: vi.fn(),
  listRows: vi.fn(),
  mapList: vi.fn(),
  plannedGraphLink: vi.fn(),
  buildCanonicalPlan: vi.fn(),
  buildProviderAdmissions: vi.fn(),
  buildReadOnlyAdmissions: vi.fn(),
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
  GROK_PLAN_VERSION: 3,
}));
vi.mock("@/lib/graph/canonical-full-lifecycle", () => ({
  buildCanonicalFullLifecyclePlan: harness.buildCanonicalPlan,
  resolveCanonicalFullLifecycleReleaseIdentity: harness.resolveRelease,
}));
vi.mock("@/lib/grok/provider-admission", () => ({
  buildGrokProviderAdmissions: harness.buildProviderAdmissions,
  buildGrokReadOnlyIntentAdmissions: harness.buildReadOnlyAdmissions,
  GrokProviderAdmissionError: class GrokProviderAdmissionError extends Error {},
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
    grokSpecialistRosterIdempotencyKey: (base: string) => `${base}:specialist-roster`,
    recordGrokSpecialistRoster: harness.recordRoster,
    recordGrokEvent: harness.recordEvent,
    recordGrokContextEnvelope: harness.recordContext,
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

import { GET, POST } from "@/app/api/grok/sessions/route";
import { GrokProviderAdmissionError } from "@/lib/grok/provider-admission";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";
const userMessageId = "40000000-0000-4000-8000-000000000004";
const assistantMessageId = "50000000-0000-4000-8000-000000000005";
const graphId = "70000000-0000-4000-8000-000000000007";
const repositoryId = "80000000-0000-4000-8000-000000000008";
const baseSha = "a".repeat(40);
const requiredChecks = ["Lint, typecheck, test, and build"];
const providerAdmissions = [{
  version: 2,
  lane: "graph_model",
  nodeKey: "goal",
  sourceRosterAssignmentId: "11000000-0000-4000-8000-000000000001",
  assignmentId: "11000000-0000-4000-8000-000000000001",
  agentMaxModelTier: "STRONG",
}];
const planningFailureMessage =
  "Planning is blocked until a Ready configured Codex agent covers the repository-writing task.";

const plan = {
  planner: { version: 3 },
  intent: { kind: "build", prompt: "Build the portal" },
  project: { projectId },
  admissionRoster: [{ assignmentId: "11000000-0000-4000-8000-000000000001" }],
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
  next: { message_sequence: 2, event_sequence: 5 },
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
  harness.buildReadOnlyAdmissions.mockReturnValue(providerAdmissions);
  harness.resolveRelease.mockResolvedValue({
    ok: true,
    target: { repository_id: repositoryId, base_branch: "main" },
    baseSha,
    requiredChecks,
  });
  harness.appendAssistant.mockResolvedValue({ id: assistantMessageId });
  harness.recordRoster.mockResolvedValue({
    message_id: assistantMessageId,
    roster_count: 2,
    roster_sha256: "b".repeat(64),
    replayed: false,
  });
  harness.recordEvent.mockResolvedValue({});
  harness.recordContext.mockResolvedValue({ envelope: { id: "90000000-0000-4000-8000-000000000009" }, replayed: false });
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
    messages: [], contextEnvelopes: [], tasks: [], events: [], artifacts: [],
  });
});

describe("Grok sessions GET", () => {
  const firstCreatedAt = "2026-08-30T20:00:00.000Z";
  const secondSessionId = "30000000-0000-4000-8000-000000000013";
  const secondCreatedAt = "2026-08-30T19:00:00.000Z";
  const lookAheadSessionId = "30000000-0000-4000-8000-000000000023";
  const row = (id: string, createdAt: string) => ({
    session_id: id,
    project_id: projectId,
    project_name: "Factory",
    title: `Session ${id}`,
    status: "active",
    last_message_sequence: 1,
    last_event_sequence: 1,
    created_at: createdAt,
    updated_at: createdAt,
  });

  it("lists one project with a bounded look-ahead row and returns an exact cursor", async () => {
    const rows = [
      row(sessionId, firstCreatedAt),
      row(secondSessionId, secondCreatedAt),
      row(lookAheadSessionId, "2026-08-30T18:00:00.000Z"),
    ];
    const projected = rows.slice(0, 2).map((entry) => ({ id: entry.session_id }));
    harness.listRows.mockResolvedValue(rows);
    harness.mapList.mockReturnValue(projected);

    const response = await GET(new Request(
      `https://factory.example/api/grok/sessions?projectId=${projectId}&limit=2`,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessions: projected,
      nextCursor: { createdAt: secondCreatedAt, id: secondSessionId },
    });
    expect(harness.listRows).toHaveBeenCalledWith(
      expect.anything(),
      organizationId,
      projectId,
      3,
      null,
    );
    expect(harness.mapList).toHaveBeenCalledWith(rows.slice(0, 2));
  });

  it("passes the complete cursor to the database boundary and ends pagination honestly", async () => {
    const rows = [row(lookAheadSessionId, "2026-08-30T18:00:00.000Z")];
    const projected = [{ id: lookAheadSessionId }];
    harness.listRows.mockResolvedValue(rows);
    harness.mapList.mockReturnValue(projected);

    const response = await GET(new Request(
      `https://factory.example/api/grok/sessions?projectId=${projectId}&limit=20`
      + `&beforeCreatedAt=${encodeURIComponent(secondCreatedAt)}&beforeId=${secondSessionId}`,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sessions: projected, nextCursor: null });
    expect(harness.listRows).toHaveBeenCalledWith(
      expect.anything(),
      organizationId,
      projectId,
      21,
      { createdAt: secondCreatedAt, id: secondSessionId },
    );
  });

  it("rejects an incomplete cursor before reading tenant state", async () => {
    const response = await GET(new Request(
      `https://factory.example/api/grok/sessions?projectId=${projectId}`
      + `&beforeCreatedAt=${encodeURIComponent(secondCreatedAt)}`,
    ));

    expect(response.status).toBe(400);
    expect(harness.requireActiveOrganization).not.toHaveBeenCalled();
    expect(harness.listRows).not.toHaveBeenCalled();
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
    harness.readBundle
      .mockResolvedValueOnce({ ...bundle, session: { ...bundle.session, version: 2 } })
      .mockResolvedValueOnce({ ...bundle, session: { ...bundle.session, status: "blocked", version: 5 }, next: { message_sequence: 2, event_sequence: 5 } })
      .mockResolvedValueOnce({ ...bundle, session: { ...bundle.session, status: "blocked", version: 6 }, next: { message_sequence: 2, event_sequence: 6 } });

    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      sessionId,
      session: { id: sessionId, status: "blocked", version: 6 },
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
  harness.buildProviderAdmissions.mockReturnValue(providerAdmissions);

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
        next: { message_sequence: 2, event_sequence: 5 },
      })
      .mockResolvedValueOnce({
        ...bundle,
        session: { ...bundle.session, status: "blocked", version: 6 },
        next: { message_sequence: 2, event_sequence: 6 },
      })
      .mockResolvedValueOnce({
        ...bundle,
        session: { ...bundle.session, status: "blocked", version: 6 },
        next: { message_sequence: 2, event_sequence: 6 },
      })
      .mockResolvedValueOnce({
        ...bundle,
        session: { ...bundle.session, status: "blocked", version: 6 },
        next: { message_sequence: 2, event_sequence: 6 },
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
        next: { message_sequence: 2, event_sequence: 5 },
      })
      .mockResolvedValueOnce({
        ...bundle,
        session: { ...bundle.session, status: "blocked", version: 6 },
        next: { message_sequence: 2, event_sequence: 6 },
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
      session: { status: "blocked", version: 6 },
      error: {
        code: "MISSING_CLAUDE_AGENT",
        message: expect.stringMatching(/configured Claude agent/),
      },
      workerWoken: false,
      executionStarted: false,
    });
    expect(harness.readBundle).toHaveBeenCalledTimes(3);
    expect(harness.serviceRpc).not.toHaveBeenCalled();
  });

  it("records roster and routing intent, launches only canonical v3, and returns paused without dispatch", async () => {
    harness.readBoundedJson.mockResolvedValueOnce({
      projectId,
      prompt: "Build the portal",
      idempotencyKey: "request-key-123",
      context: [
        { kind: "file", label: "brief.md", mediaType: "text/markdown", text: "Use an indigo call to action." },
        { kind: "url", label: "Source", url: "https://docs.example.com/brief" },
      ],
    });
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
      execution: { state: "paused", bridge: "full_lifecycle_v3" },
    });
    expect(harness.appendUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prompt: "Build the portal",
      idempotencyKey: "request-key-123",
    }));
    expect(harness.buildPlan).toHaveBeenCalledWith(expect.objectContaining({
      contextSummary: expect.stringMatching(/indigo call to action[\s\S]*docs\.example\.com\/brief[\s\S]*fetched=false/i),
    }));
    expect(harness.appendAssistant).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      plan,
      userMessageId,
    }));
    expect(harness.recordRoster).toHaveBeenCalledWith(expect.anything(), {
      organizationId,
      projectId,
      sessionId,
      messageId: assistantMessageId,
      requestedBy: "60000000-0000-4000-8000-000000000006",
      idempotencyKey: "request-key-123",
      expectedEventSequence: 3,
    });
    expect(harness.recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "session.planned",
      expectedSequence: 4,
      payload: expect.objectContaining({
        specialistRosterCount: 2,
        specialistRosterSha256: "b".repeat(64),
      }),
    }));
    expect(harness.serviceRpc).toHaveBeenCalledTimes(1);
    expect(harness.serviceRpc).toHaveBeenCalledWith(
      "launch_grok_full_lifecycle_v4_as_server",
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
        p_roster_idempotency_key: "request-key-123:specialist-roster",
        p_admissions: providerAdmissions,
      },
    );
    expect(harness.buildProviderAdmissions).toHaveBeenCalledWith(plan, canonicalPlan.nodes);
    expect(harness.serviceRpc).not.toHaveBeenCalledWith(
      "launch_grok_graph_for_session",
      expect.anything(),
    );
    expect(harness.serviceRpc).not.toHaveBeenCalledWith(
      "create_graph_from_plan",
      expect.anything(),
    );
  });

  it("fails closed before release resolution when immutable provider admission is unavailable", async () => {
    harness.buildProviderAdmissions.mockImplementationOnce(() => {
      throw new GrokProviderAdmissionError(
        "No immutable openai posting can execute canonical node implement.",
      );
    });

    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      sessionId,
      error: {
        code: "grok_provider_admission_required",
        message: expect.stringMatching(/immutable openai posting/i),
      },
    });
    expect(harness.resolveRelease).not.toHaveBeenCalled();
    expect(harness.serviceRpc).not.toHaveBeenCalled();
  });

  it("replays roster event 3 and plan event 4 exactly while deploy remains bridge-blocked", async () => {
    const deployPlan = { ...plan, intent: { ...plan.intent, kind: "deploy" } };
    harness.storedPlan.mockReturnValue(deployPlan);
    harness.readBundle.mockResolvedValue({
      ...bundle,
      messages: [{ id: assistantMessageId, sequence_no: 2, role: "assistant" }],
    });
    harness.recordRoster.mockResolvedValue({
      message_id: assistantMessageId,
      roster_count: 2,
      roster_sha256: "b".repeat(64),
      replayed: true,
    });

    const request = () => POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));
    const first = await request();
    const second = await request();

    expect(first.status).toBe(409);
    expect(await first.json()).toEqual(await second.json());
    expect(harness.recordRoster).toHaveBeenCalledTimes(2);
    for (const call of harness.recordRoster.mock.calls) {
      expect(call[1]).toMatchObject({
        idempotencyKey: "request-key-123",
        expectedEventSequence: 3,
      });
    }
    expect(harness.recordEvent).toHaveBeenCalledTimes(2);
    for (const call of harness.recordEvent.mock.calls) {
      expect(call[1]).toMatchObject({
        eventType: "session.planned",
        expectedSequence: 4,
      });
    }
    expect(harness.buildCanonicalPlan).not.toHaveBeenCalled();
    expect(harness.resolveRelease).not.toHaveBeenCalled();
    expect(harness.serviceRpc).not.toHaveBeenCalled();
  });

  it("launches the exact immutable research DAG paused without release resolution or dispatch", async () => {
    harness.readBoundedJson.mockResolvedValueOnce({
      projectId,
      prompt: "Research the portal",
      idempotencyKey: "request-key-123",
    });
    const researchGraph = {
      goal: "Research the portal",
      topology: "DAG",
      topologyReasons: [{ code: "DEPENDENCIES", detail: "Evidence fans in." }],
      riskLevel: "green",
      requiresOwnerApproval: false,
      nodes: [{
        node_key: "research_repository",
        executor: "MODEL",
        capability: "discovery",
        model_tier: "STANDARD",
      }],
      edges: [],
      budget: { max_nodes: 1, max_concurrent_nodes: 1 },
    };
    const researchPlan = {
      ...plan,
      intent: { ...plan.intent, kind: "research", prompt: "Research the portal" },
      graphLaunch: researchGraph,
    };
    harness.storedPlan.mockReturnValue(researchPlan);
    harness.readBundle.mockResolvedValue({
      ...bundle,
      messages: [{ id: assistantMessageId, sequence_no: 2, role: "assistant" }],
    });

    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Research the portal" }),
    }));

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(202);
    expect(responseBody).toMatchObject({
      workerWoken: false,
      executionStarted: false,
      execution: { bridge: "read_only_research_v1", state: "paused" },
    });
    expect(harness.buildReadOnlyAdmissions).toHaveBeenCalledWith(
      researchPlan,
      researchGraph.nodes,
    );
    expect(harness.serviceRpc).toHaveBeenCalledWith(
      "launch_grok_read_only_research_v2_as_server",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_project_id: projectId,
        p_session_id: sessionId,
        p_message_id: assistantMessageId,
        p_goal: researchGraph.goal,
        p_nodes: researchGraph.nodes,
        p_admissions: providerAdmissions,
      }),
    );
    expect(harness.buildCanonicalPlan).not.toHaveBeenCalled();
    expect(harness.resolveRelease).not.toHaveBeenCalled();
  });

  it.each([
    ["red", false],
    ["yellow", false],
    ["green", true],
  ] as const)(
    "keeps %s research with owner-approval=%s recorded but blocked before RPC",
    async (riskLevel, requiresOwnerApproval) => {
      harness.readBoundedJson.mockResolvedValueOnce({
        projectId,
        prompt: "Research the authorization boundary",
        idempotencyKey: "request-key-123",
      });
      const researchPlan = {
        ...plan,
        intent: {
          ...plan.intent,
          kind: "research",
          prompt: "Research the authorization boundary",
        },
        graphLaunch: {
          goal: "Research the authorization boundary",
          topology: "DAG",
          topologyReasons: [{ code: "DEPENDENCIES", detail: "Evidence fans in." }],
          riskLevel,
          requiresOwnerApproval,
          nodes: [{
            node_key: "research_repository",
            executor: "MODEL",
            capability: "discovery",
            model_tier: "STANDARD",
          }],
          edges: [],
          budget: { max_nodes: 1, max_concurrent_nodes: 1 },
        },
      };
      harness.storedPlan.mockReturnValue(researchPlan);
      harness.readBundle.mockResolvedValue({
        ...bundle,
        messages: [{ id: assistantMessageId, sequence_no: 2, role: "assistant" }],
      });

      const response = await POST(new Request("https://factory.example/api/grok/sessions", {
        method: "POST",
        headers: { origin: "https://factory.example", "content-type": "application/json" },
        body: JSON.stringify({ projectId, prompt: "Research the authorization boundary" }),
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        sessionId,
        error: {
          code: "grok_intent_runtime_bridge_required",
          message: expect.stringMatching(/exact GREEN plan.*no graph or worker was started/i),
        },
        workerWoken: false,
        executionStarted: false,
      });
      expect(harness.buildReadOnlyAdmissions).not.toHaveBeenCalled();
      expect(harness.serviceRpc).not.toHaveBeenCalled();
      expect(harness.resolveRelease).not.toHaveBeenCalled();
    },
  );

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
        bridge: "full_lifecycle_v3",
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
