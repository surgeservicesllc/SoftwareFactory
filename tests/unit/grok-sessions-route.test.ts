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
  readBundle: vi.fn(),
  storedPlan: vi.fn(),
  loadAgents: vi.fn(),
  appendAssistant: vi.fn(),
  recordEvent: vi.fn(),
  mapDetail: vi.fn(),
  listRows: vi.fn(),
  mapList: vi.fn(),
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
    readGrokBundle: harness.readBundle,
    storedGrokPlan: harness.storedPlan,
    loadConfiguredGrokAgents: harness.loadAgents,
    appendGrokAssistantPlan: harness.appendAssistant,
    recordGrokEvent: harness.recordEvent,
    mapGrokSessionDetail: harness.mapDetail,
    listGrokSessionRows: harness.listRows,
    mapGrokSessionList: harness.mapList,
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

const plan = {
  planner: { version: 1 },
  intent: { kind: "build", prompt: "Build the portal" },
  project: { projectId },
  dag: { tasks: [{ id: "implement", provider: "openai" }], layers: [["implement"]] },
  graphLaunch: { goal: "Build the portal" },
};

const bundle = {
  session: { id: sessionId, project_id: projectId },
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
  harness.readBundle.mockResolvedValue(bundle);
  harness.storedPlan.mockReturnValue(null);
  harness.loadAgents.mockResolvedValue([]);
  harness.buildPlan.mockReturnValue({ ok: true, plan });
  harness.createServiceClient.mockReturnValue({ rpc: vi.fn() });
  harness.appendAssistant.mockResolvedValue({ id: assistantMessageId });
  harness.recordEvent.mockResolvedValue({});
  harness.mapDetail.mockResolvedValue({
    session: {
      id: sessionId,
      projectId,
      projectName: "Factory",
      title: "Build the portal",
      goal: "Build the portal",
      status: "planning",
      commandId: null,
      graphId: null,
      graphRunId: null,
      createdAt: "2026-08-30T20:00:00.000Z",
      updatedAt: "2026-08-30T20:00:00.000Z",
      allowedActions: [],
    },
    messages: [], tasks: [], events: [], artifacts: [],
  });
});

describe("Grok sessions POST", () => {
  it("durably records the exact plan but blocks every custom graph until routing identity is bound", async () => {
    const response = await POST(new Request("https://factory.example/api/grok/sessions", {
      method: "POST",
      headers: { origin: "https://factory.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId, prompt: "Build the portal" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      session: { id: sessionId, status: "blocked", graphId: null },
      workerWoken: false,
      executionStarted: false,
      blocked: { code: "execution_bridge_not_connected" },
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
      expectedSequence: 2,
    }));
    const tenant = await harness.requireActiveOrganization.mock.results[0]?.value;
    expect(tenant.client.rpc).not.toHaveBeenCalledWith(
      "launch_grok_graph_for_session",
      expect.anything(),
    );
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

