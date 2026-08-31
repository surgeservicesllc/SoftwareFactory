// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  origin: vi.fn(), json: vi.fn(), tenant: vi.fn(), sensitive: vi.fn(),
  readBundle: vi.fn(), readProject: vi.fn(), mapDetail: vi.fn(),
  requestIntent: vi.fn(), resolveIntent: vi.fn(), service: vi.fn(),
}));

vi.mock("@/lib/supabase/request", () => ({ assertSameOriginRequest: harness.origin }));
vi.mock("@/lib/supabase/tenant", () => ({ requireActiveOrganization: harness.tenant }));
vi.mock("@/lib/security/sensitive-data", () => ({ findSensitiveData: harness.sensitive }));
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: harness.service,
}));
vi.mock("@/lib/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/http")>();
  return { ...actual, readBoundedJson: harness.json };
});
vi.mock("@/lib/grok/session-store", () => {
  class GrokStoreDatabaseError extends Error {
    databaseError = {};
  }
  return {
    GrokStoreDatabaseError,
    readGrokBundle: harness.readBundle,
    readGrokProject: harness.readProject,
    mapGrokSessionDetail: harness.mapDetail,
    requestGrokControlIntent: harness.requestIntent,
    resolveGrokControlIntent: harness.resolveIntent,
  };
});

import { POST } from "@/app/api/grok/sessions/[sessionId]/control/route";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";
const graphId = "40000000-0000-4000-8000-000000000004";
const intentId = "50000000-0000-4000-8000-000000000005";

const detail = {
  session: {
    id: sessionId, projectId, projectName: "Factory", title: "Research", goal: "Research",
    status: "planned", commandId: null, graphId, graphRunId: null,
    createdAt: "2026-08-30T20:00:00.000Z", updatedAt: "2026-08-30T20:00:00.000Z",
    allowedActions: ["pause", "stop"],
  },
  messages: [], tasks: [], events: [], artifacts: [],
};

describe("Grok session control route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const rpc = vi.fn().mockResolvedValue({ data: { id: graphId }, error: null });
    harness.tenant.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "owner" },
      client: { rpc },
    });
    harness.json.mockResolvedValue({
      action: "pause", reason: "Pause while reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.sensitive.mockReturnValue(null);
    harness.readBundle.mockResolvedValue({ session: { id: sessionId, project_id: projectId } });
    harness.readProject.mockResolvedValue({ projectId, name: "Factory" });
    harness.mapDetail.mockResolvedValue(detail);
    harness.requestIntent.mockResolvedValue({ id: intentId, state: "requested" });
    harness.service.mockReturnValue({ rpc: vi.fn() });
    harness.resolveIntent.mockResolvedValue({ id: intentId, state: "applied" });
  });

  it("returns the full reloadable session contract after applying a control", async () => {
    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      session: { id: sessionId, graphId },
      messages: [], tasks: [], events: [], artifacts: [],
      control: { intentId, action: "pause", state: "applied" },
      replayed: false,
      workerWoken: false,
    });
    expect(harness.readBundle).toHaveBeenCalledTimes(2);
    expect(harness.resolveIntent).toHaveBeenCalledWith(expect.anything(), {
      organizationId, intentId, state: "applied",
    });
  });
});

