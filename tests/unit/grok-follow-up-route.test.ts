// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  assertSameOriginRequest: vi.fn(),
  readBoundedJson: vi.fn(),
  requireActiveOrganization: vi.fn(),
  normalizeContext: vi.fn(),
  readBundle: vi.fn(),
  readProject: vi.fn(),
  appendFollowUp: vi.fn(),
  mapDetail: vi.fn(),
}));

vi.mock("@/lib/supabase/request", () => ({ assertSameOriginRequest: harness.assertSameOriginRequest }));
vi.mock("@/lib/supabase/tenant", () => ({ requireActiveOrganization: harness.requireActiveOrganization }));
vi.mock("@/lib/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/http")>();
  return { ...actual, readBoundedJson: harness.readBoundedJson };
});
vi.mock("@/lib/grok/context", () => ({
  GrokContextInputError: class GrokContextInputError extends Error {},
  normalizeGrokContext: harness.normalizeContext,
}));
vi.mock("@/lib/grok/session-store", () => ({
  GrokStoreDatabaseError: class GrokStoreDatabaseError extends Error { databaseError = {}; },
  readGrokBundle: harness.readBundle,
  readGrokProject: harness.readProject,
  appendGrokFollowUpContext: harness.appendFollowUp,
  mapGrokSessionDetail: harness.mapDetail,
}));

import { POST } from "@/app/api/grok/sessions/[sessionId]/messages/route";
import { GrokContextInputError } from "@/lib/grok/context";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";
const userId = "40000000-0000-4000-8000-000000000004";
const messageId = "50000000-0000-4000-8000-000000000005";
const envelopeId = "60000000-0000-4000-8000-000000000006";

const bundle = {
  session: { id: sessionId, project_id: projectId },
  messages: [{ id: "70000000-0000-4000-8000-000000000007" }],
  next: { message_sequence: 2, event_sequence: 5 },
};

const detail = {
  session: {
    id: sessionId, projectId, projectName: "Factory", title: "Build", goal: "Build",
    status: "paused", commandId: null, graphId: null, graphRunId: null,
    createdAt: "2026-08-31T10:00:00.000Z", updatedAt: "2026-08-31T10:00:00.000Z", allowedActions: [],
  },
  messages: [], contextEnvelopes: [], tasks: [], events: [], artifacts: [], runEvidence: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.readBoundedJson.mockResolvedValue({
    prompt: "Use the revised requirements.",
    context: [{ kind: "url", label: "Spec", url: "https://docs.example.com/spec" }],
    idempotencyKey: "follow-up-0001",
  });
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc: vi.fn() },
    user: { id: userId },
  });
  harness.readBundle.mockResolvedValue(bundle);
  harness.readProject.mockResolvedValue({
    projectId, name: "Factory", repositoryFullName: "factory/app", defaultBranch: "main",
    productionUrl: null, status: "active",
  });
  harness.normalizeContext.mockReturnValue([
    { kind: "project", label: "Factory" }, { kind: "repository", label: "factory/app" },
  ]);
  harness.appendFollowUp.mockResolvedValue({
    message: { id: messageId },
    envelope: { id: envelopeId },
    replayed: false,
    plan_changed: false,
    replan_required: true,
  });
  harness.mapDetail.mockResolvedValue(detail);
});

function request() {
  return POST(new Request(`https://factory.example/api/grok/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { origin: "https://factory.example", "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Use the revised requirements." }),
  }), { params: Promise.resolve({ sessionId }) });
}

describe("Grok follow-up route", () => {
  it("records an exact tenant/project turn without dispatching or silently replanning", async () => {
    const response = await request();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      session: { id: sessionId },
      turn: { messageId, envelopeId, planChanged: false, replanRequired: true },
      workerWoken: false,
      automaticActionStarted: false,
    });
    expect(harness.assertSameOriginRequest).toHaveBeenCalledTimes(1);
    expect(harness.appendFollowUp).toHaveBeenCalledWith(expect.anything(), {
      organizationId,
      projectId,
      sessionId,
      content: "Use the revised requirements.",
      items: expect.any(Array),
      idempotencyKey: "follow-up-0001",
      expectedMessageSequence: 2,
      expectedEventSequence: 5,
      replyToMessageId: "70000000-0000-4000-8000-000000000007",
    });
  });

  it("requires an owner before normalization or mutation", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" }, client: {}, user: { id: userId },
    });
    const response = await request();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "owner_required" } });
    expect(harness.normalizeContext).not.toHaveBeenCalled();
    expect(harness.appendFollowUp).not.toHaveBeenCalled();
  });

  it("fails closed when the exact session project is unavailable", async () => {
    harness.readProject.mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "grok_project_not_ready" } });
    expect(harness.appendFollowUp).not.toHaveBeenCalled();
  });

  it("returns a bounded context error without persistence", async () => {
    harness.normalizeContext.mockImplementation(() => {
      throw new GrokContextInputError("Remove credentials or secret values and submit references only.");
    });
    const response = await request();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_grok_context" } });
    expect(harness.appendFollowUp).not.toHaveBeenCalled();
  });
});
