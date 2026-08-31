// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  origin: vi.fn(), json: vi.fn(), tenant: vi.fn(), sensitive: vi.fn(),
  readBundle: vi.fn(), readProject: vi.fn(), mapDetail: vi.fn(),
  applyControl: vi.fn(),
  dispatchGraphWorker: vi.fn(), rpc: vi.fn(), graphRead: vi.fn(),
}));

vi.mock("@/lib/supabase/request", () => ({ assertSameOriginRequest: harness.origin }));
vi.mock("@/lib/supabase/tenant", () => ({ requireActiveOrganization: harness.tenant }));
vi.mock("@/lib/security/sensitive-data", () => ({ findSensitiveData: harness.sensitive }));
vi.mock("@/lib/orchestration/dispatch", () => ({
  dispatchGraphWorker: harness.dispatchGraphWorker,
}));
vi.mock("@/lib/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/http")>();
  return { ...actual, readBoundedJson: harness.json };
});
vi.mock("@/lib/grok/session-store", () => {
  class GrokStoreDatabaseError extends Error {
    databaseError: { code?: string; message?: string };
    constructor(error: { code?: string; message?: string }) {
      super(error.message);
      this.databaseError = error;
    }
  }
  return {
    applyGrokGraphControl: harness.applyControl,
    GrokStoreDatabaseError,
    readGrokBundle: harness.readBundle,
    readGrokProject: harness.readProject,
    mapGrokSessionDetail: harness.mapDetail,
  };
});

import { POST } from "@/app/api/grok/sessions/[sessionId]/control/route";
import { GrokStoreDatabaseError } from "@/lib/grok/session-store";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";
const graphId = "40000000-0000-4000-8000-000000000004";
const intentId = "50000000-0000-4000-8000-000000000005";
const target = {
  app_id: 4582606,
  base_branch: "main",
  connection_id: "70000000-0000-4000-8000-000000000007",
  external_installation_id: 153479019,
  external_repository_id: 1058420203,
  internal_installation_id: "80000000-0000-4000-8000-000000000008",
  project_id: projectId,
  repository_full_name: "surgeservicesllc/SoftwareFactory",
  repository_id: "90000000-0000-4000-8000-000000000009",
};

const detail = {
  session: {
    id: sessionId, projectId, projectName: "Factory", title: "Research", goal: "Research",
    status: "planned", commandId: null, graphId, graphRunId: null,
    createdAt: "2026-08-30T20:00:00.000Z", updatedAt: "2026-08-30T20:00:00.000Z",
    allowedActions: ["pause", "stop"],
  },
  messages: [], tasks: [], events: [], artifacts: [],
};

function rejectAtomicControl(message: string) {
  harness.applyControl.mockRejectedValue(new GrokStoreDatabaseError({ code: "55000", message }));
}

describe("Grok session control route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.rpc.mockImplementation((name: string) => {
      if (name === "resolve_phase1c_command_target") {
        return { single: vi.fn().mockResolvedValue({ data: target, error: null }) };
      }
      return Promise.resolve({ data: { id: graphId }, error: null });
    });
    harness.graphRead.mockResolvedValue({
      data: {
        id: graphId,
        organization_id: organizationId,
        project_id: projectId,
        github_repository_id: target.repository_id,
        pause_requested_at: null,
        withdrawn_at: null,
      },
      error: null,
    });
    const graphQuery = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: harness.graphRead,
    };
    graphQuery.select.mockReturnValue(graphQuery);
    graphQuery.eq.mockReturnValue(graphQuery);
    harness.tenant.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "owner" },
      client: {
        rpc: harness.rpc,
        from: vi.fn().mockReturnValue(graphQuery),
      },
    });
    harness.json.mockResolvedValue({
      action: "pause", reason: "Pause while reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.sensitive.mockReturnValue(null);
    harness.readBundle.mockResolvedValue({
      session: { id: sessionId, project_id: projectId },
      control_intents: [],
    });
    harness.readProject.mockResolvedValue({ projectId, name: "Factory" });
    harness.mapDetail.mockResolvedValue(detail);
    harness.applyControl.mockImplementation((_: unknown, input: {
      action: "pause" | "resume" | "withdraw"; idempotencyKey: string;
    }) => Promise.resolve({
      intent_id: intentId,
      organization_id: organizationId,
      project_id: projectId,
      session_id: sessionId,
      graph_id: graphId,
      action: input.action,
      state: "applied",
      idempotency_key: input.idempotencyKey,
      replayed: false,
    }));
    harness.dispatchGraphWorker.mockResolvedValue({ dispatched: true, reason: "dispatched" });
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
    expect(harness.applyControl).toHaveBeenCalledWith(expect.anything(), {
      organizationId,
      sessionId,
      graphId,
      action: "pause",
      reason: "Pause while reviewing evidence.",
      idempotencyKey: "control-key-123",
    });
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("wakes the exact target only after a fresh resume is durably applied", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "paused", allowedActions: ["resume", "stop"] },
    });

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      control: { intentId, action: "resume", state: "applied" },
      replayed: false,
      workerWoken: true,
      note: expect.stringMatching(/exact graph worker wake was accepted/i),
    });
    expect(harness.applyControl).toHaveBeenCalledBefore(harness.dispatchGraphWorker);
    expect(harness.dispatchGraphWorker).toHaveBeenCalledWith({
      appId: target.app_id,
      externalInstallationId: target.external_installation_id,
      externalRepositoryId: target.external_repository_id,
      repositoryFullName: target.repository_full_name,
    }, graphId);
  });

  it("retries an exact applied wake even when the bounded bundle omits that key", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "planned", allowedActions: ["pause", "stop"] },
    });
    harness.readBundle.mockResolvedValue({
      session: { id: sessionId, project_id: projectId },
      control_intents: Array.from({ length: 500 }, (_, index) => ({ id: `omitted-${index}` })),
    });
    harness.applyControl.mockImplementation(async (_: unknown, input: {
      action: string; idempotencyKey: string;
    }) => ({
      intent_id: intentId, organization_id: organizationId, project_id: projectId,
      session_id: sessionId, graph_id: graphId, action: input.action,
      state: "applied", idempotency_key: input.idempotencyKey, replayed: true,
    }));

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(body).toMatchObject({
      replayed: true,
      workerWoken: true,
      note: expect.stringMatching(/accepted again for recovery/i),
    });
    expect(harness.dispatchGraphWorker).toHaveBeenCalledWith(expect.any(Object), graphId);
    expect(harness.readBundle).toHaveBeenCalledTimes(2);
    expect(harness.applyControl).toHaveBeenCalledWith(expect.anything(), {
      organizationId,
      sessionId,
      graphId,
      action: "resume",
      reason: "Resume after reviewing evidence.",
      idempotencyKey: "control-key-123",
    });
  });

  it("rejects an unpaused graph with a new Resume key before intent or dispatch", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "new-resume-key-456",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "planned", allowedActions: ["pause", "stop"] },
    });
    rejectAtomicControl("grok_control_not_available");

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: "55000", message: "grok_control_not_available" });
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("rejects a prior applied Resume key after the graph enters a new paused cycle", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "paused", allowedActions: ["resume", "stop"] },
    });
    rejectAtomicControl("grok_control_superseded");

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: "55000", message: "grok_control_superseded" });
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("recovers an exact requested Resume after unpause committed before intent resolution", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "planned", allowedActions: ["pause", "stop"] },
    });
    harness.applyControl.mockImplementation(async (_: unknown, input: {
      action: string; idempotencyKey: string;
    }) => ({
      intent_id: intentId, organization_id: organizationId, project_id: projectId,
      session_id: sessionId, graph_id: graphId, action: input.action,
      state: "applied", idempotency_key: input.idempotencyKey, replayed: true,
    }));

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ replayed: true, workerWoken: true });
    expect(harness.applyControl).toHaveBeenCalledBefore(harness.dispatchGraphWorker);
    expect(harness.rpc).not.toHaveBeenCalledWith("set_graph_pause_as_member", expect.anything());
  });

  it("fails an ambiguous requested Resume recovery without dispatch", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "paused", allowedActions: ["resume", "stop"] },
    });
    rejectAtomicControl("grok_control_recovery_ambiguous");

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: "55000", message: "grok_control_recovery_ambiguous" });
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses an old requested Resume when a newer graph control exists", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "paused", allowedActions: ["resume", "stop"] },
    });
    rejectAtomicControl("grok_control_superseded");

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: "55000", message: "grok_control_superseded" });
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("rejects an applied Pause key when Pause is available in a later cycle", async () => {
    harness.json.mockResolvedValue({
      action: "pause", reason: "Pause while reviewing evidence.", idempotencyKey: "pause-control-key-123",
    });
    harness.mapDetail.mockResolvedValue(detail);
    rejectAtomicControl("grok_control_superseded");

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: "55000", message: "grok_control_superseded" });
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it.each([
    ["worker disabled", { dispatched: false, reason: "worker_disabled" }],
    ["dispatch unavailable", new Error("GitHub unavailable")],
  ])("keeps the committed resume truthfully Not Connected when %s", async (_label, outcome) => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "paused", allowedActions: ["resume", "stop"] },
    });
    if (outcome instanceof Error) harness.dispatchGraphWorker.mockRejectedValue(outcome);
    else harness.dispatchGraphWorker.mockResolvedValue(outcome);

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ replayed: false, workerWoken: false });
    expect(body.note).toMatch(/Not Connected/);
    expect(harness.applyControl).toHaveBeenCalledTimes(1);
  });

  it("refuses to dispatch when the exact project target projection conflicts", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "paused", allowedActions: ["resume", "stop"] },
    });
    harness.tenant.mockResolvedValueOnce({
      activeOrganization: { id: organizationId, role: "owner" },
      client: {
        rpc: vi.fn().mockImplementation((name: string) => name === "resolve_phase1c_command_target"
          ? { single: vi.fn().mockResolvedValue({
              data: { ...target, project_id: "a0000000-0000-4000-8000-00000000000a" }, error: null,
            }) }
          : Promise.resolve({ data: { id: graphId }, error: null })),
      },
    });

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(body).toMatchObject({ workerWoken: false });
    expect(body.note).toMatch(/Not Connected/);
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses the wake when the graph repository binding differs from the resolved target", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "paused", allowedActions: ["resume", "stop"] },
    });
    harness.graphRead.mockResolvedValue({
      data: {
        id: graphId,
        organization_id: organizationId,
        project_id: projectId,
        github_repository_id: "d0000000-0000-4000-8000-00000000000d",
        pause_requested_at: null,
        withdrawn_at: null,
      },
      error: null,
    });

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ workerWoken: false });
    expect(body.note).toMatch(/Not Connected/);
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("never wakes an old applied Resume after the graph was withdrawn", async () => {
    harness.json.mockResolvedValue({
      action: "resume", reason: "Resume after reviewing evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: { ...detail.session, status: "stopped", allowedActions: [] },
    });
    harness.applyControl.mockImplementation(async (_: unknown, input: {
      action: string; idempotencyKey: string;
    }) => ({
      intent_id: intentId, organization_id: organizationId, project_id: projectId,
      session_id: sessionId, graph_id: graphId, action: input.action,
      state: "applied", idempotency_key: input.idempotencyKey, replayed: true,
    }));
    harness.graphRead.mockResolvedValue({
      data: {
        id: graphId,
        organization_id: organizationId,
        project_id: projectId,
        github_repository_id: target.repository_id,
        pause_requested_at: null,
        withdrawn_at: "2026-08-30T20:05:00.000Z",
      },
      error: null,
    });

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ replayed: true, workerWoken: false });
    expect(body.note).toMatch(/Not Connected/);
    expect(body.note).not.toMatch(/claimable/i);
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("keeps stop non-dispatching", async () => {
    harness.json.mockResolvedValue({
      action: "stop", reason: "Stop after reviewing durable evidence.", idempotencyKey: "control-key-123",
    });
    harness.mapDetail.mockResolvedValue({
      ...detail,
      session: {
        ...detail.session,
        allowedActions: ["stop"],
      },
    });

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });

    expect(response.status).toBe(200);
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
    expect(harness.applyControl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "withdraw",
      graphId,
    }));
  });

  it.each(["cancel", "retry"])("rejects removed %s controls during request validation", async (action) => {
    harness.json.mockResolvedValue({ action, reason: `${action} after reviewing evidence.` });

    const response = await POST(new Request(
      `https://factory.example/api/grok/sessions/${sessionId}/control`,
      { method: "POST", headers: { origin: "https://factory.example" }, body: "{}" },
    ), { params: Promise.resolve({ sessionId }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_grok_control");
    expect(harness.tenant).not.toHaveBeenCalled();
    expect(harness.applyControl).not.toHaveBeenCalled();
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });
});

