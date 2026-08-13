import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireActiveOrganization: vi.fn(),
}));

vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("server-only", () => ({}));

import { GET as getAgent } from "@/app/api/agents/[agentId]/route";
import { GET as getReport } from "@/app/api/reports/[reportId]/route";
import { GET as getRun } from "@/app/api/runs/[runId]/route";
import { POST as cancelRun } from "@/app/api/runs/[runId]/cancel/route";
import { POST as retryRun } from "@/app/api/runs/[runId]/retry/route";
import { GET as getTask } from "@/app/api/tasks/[taskId]/route";
import { GET as getWorkerStatus } from "@/app/api/worker/status/route";

const organizationId = "10000000-0000-4000-8000-000000000001";
const entityId = "20000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-13T12:00:00Z";
const project = { id: entityId, name: "SoftwareFactory" };
const agent = { id: entityId, name: "Backend Agent" };

const detailFixtures = {
  run: {
    id: entityId,
    status: "running",
    project,
    task: { id: entityId, title: "Build bounded detail routes" },
    command: { id: entityId, prompt: "Build bounded detail routes." },
    agent: { ...agent, role: "backend" },
    provider: "openai",
    model: "gpt-5.3-codex",
    risk: "yellow",
    providerRunReference: null,
    baseBranch: "main",
    baseSha: "a".repeat(40),
    headBranch: "softwarefactory/bounded-detail",
    headSha: null,
    attempt: 1,
    maxAttempts: 2,
    startedAt: timestamp,
    completedAt: null,
    createdAt: timestamp,
    durationMs: 1_000,
    cancellationRequestedAt: null,
    cancellable: true,
    retryable: false,
    summary: "Bounded evidence",
    blocker: null,
    errorMessage: null,
    timeline: [],
    changedFiles: ["app/api/runs/[runId]/route.ts"],
    files: [],
    commits: [],
    validations: [{
      id: entityId,
      round: 1,
      name: "typecheck",
      command: "npm run typecheck",
      status: "passed",
      summary: "No TypeScript errors.",
      durationMs: 1_200,
      createdAt: timestamp,
    }],
    pullRequest: null,
    checks: [],
    ci: { checks: [] },
  },
  task: {
    id: entityId,
    title: "Build bounded detail routes",
    description: null,
    status: "queued",
    risk: "yellow",
    requiresOwnerApproval: false,
    priority: 50,
    createdAt: timestamp,
    project,
    agent,
    command: { id: entityId, prompt: "Build bounded detail routes." },
    acceptanceCriteria: ["Reject malformed browser projections."],
    blocker: null,
    resultSummary: "Bounded evidence",
    dependencies: [],
    dependents: [],
    runs: [],
    pullRequests: [],
  },
  agent: {
    id: entityId,
    name: "Backend Agent",
    role: "backend",
    description: "Provider-neutral logical Phase 1C role.",
    status: "busy",
    provider: "openai",
    model: "gpt-5.3-codex",
    lastRunAt: timestamp,
    currentAssignment: "Build bounded detail routes",
    providerConnectionStatus: "connected",
    project: null,
    capabilities: ["backend", "api"],
    responsibilities: ["backend", "api"],
    currentRuns: [],
    recentRuns: [],
    runCounts: { queued: 0, running: 1, succeeded: 0, failed: 0 },
  },
  report: {
    id: entityId,
    type: "quality",
    status: "published",
    title: "Phase 1C run report",
    summary: "Bounded evidence",
    periodStart: timestamp,
    periodEnd: timestamp,
    publishedAt: timestamp,
    createdAt: timestamp,
    evidenceGeneratedAt: timestamp,
    project,
    generatedBy: agent,
    sections: [{ title: "Validated result", body: "Focused checks passed." }],
    findings: [],
    decisions: [],
    runs: [],
    pullRequests: [],
    changedFiles: ["src/fix.ts"],
    checks: [{ id: 1, name: "CI", status: "completed", conclusion: "success", url: null }],
    validations: [{ name: "typecheck", status: "passed", durationMs: 20, attempt: 1, round: 1 }],
    security: { risk: "yellow", errorCode: null, blocker: null },
  },
} as const;

beforeEach(() => {
  harness.rpc.mockReset();
  harness.requireActiveOrganization.mockReset();
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc: harness.rpc },
  });
});

describe("Phase 1C safe detail routes", () => {
  it.each([
    ["run", "get_agent_run_detail", "p_run_id", getRun],
    ["task", "get_task_detail", "p_task_id", getTask],
    ["agent", "get_agent_detail", "p_agent_id", getAgent],
    ["report", "get_report_detail", "p_report_id", getReport],
  ] as const)("reads one %s through its caller-bound RPC", async (key, rpc, idParameter, handler) => {
    harness.rpc.mockResolvedValue({
      data: [{ detail: detailFixtures[key] }],
      error: null,
    });

    const response = await handler(
      new Request(`https://factory.example/api/${key}s/${entityId}`),
      { params: Promise.resolve({ [`${key}Id`]: entityId }) } as never,
    );
    const body = await response.json() as Record<string, Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(harness.rpc).toHaveBeenCalledWith(rpc, {
      p_organization_id: organizationId,
      [idParameter]: entityId,
    });
    expect(body[key]).toEqual(detailFixtures[key]);
  });

  it.each([
    ["run", getRun, "run_unavailable"],
    ["task", getTask, "task_unavailable"],
    ["agent", getAgent, "agent_unavailable"],
    ["report", getReport, "report_unavailable"],
  ] as const)("rejects a non-contract field in the %s projection", async (key, handler, unavailableCode) => {
    harness.rpc.mockResolvedValue({
      data: [{ detail: { ...detailFixtures[key], unexpectedEvidence: "not allowlisted" } }],
      error: null,
    });

    const response = await handler(
      new Request(`https://factory.example/api/${key}s/${entityId}`),
      { params: Promise.resolve({ [`${key}Id`]: entityId }) } as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: unavailableCode },
    });
  });

  it("rejects a non-GitHub URL in nested run evidence", async () => {
    harness.rpc.mockResolvedValue({
      data: [{
        detail: {
          ...detailFixtures.run,
          checks: [{ id: 1, name: "CI", status: "completed", conclusion: "success", url: "https://example.com/run/1" }],
          ci: { checks: [] },
        },
      }],
      error: null,
    });

    const response = await getRun(
      new Request(`https://factory.example/api/runs/${entityId}`),
      { params: Promise.resolve({ runId: entityId }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "run_unavailable" } });
  });

  it("accepts a legacy report without Phase 1C security evidence", async () => {
    harness.rpc.mockResolvedValue({
      data: [{ detail: { ...detailFixtures.report, security: null } }],
      error: null,
    });

    const response = await getReport(
      new Request(`https://factory.example/api/reports/${entityId}`),
      { params: Promise.resolve({ reportId: entityId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ report: { security: null } });
  });

  it("rejects an invalid id before tenant or database access", async () => {
    const response = await getRun(
      new Request("https://factory.example/api/runs/not-a-uuid"),
      { params: Promise.resolve({ runId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(harness.requireActiveOrganization).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when a detail RPC exceeds the bounded projection", async () => {
    harness.rpc.mockResolvedValue({
      data: [{ detail: { events: Array.from({ length: 201 }, (_, index) => ({ index })) } }],
      error: null,
    });

    const response = await getRun(
      new Request(`https://factory.example/api/runs/${entityId}`),
      { params: Promise.resolve({ runId: entityId }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "run_unavailable" },
    });
  });

  it("records an owner cancellation request through the exact workflow", async () => {
    harness.rpc.mockResolvedValue({
      data: [{ run_id: entityId, status: "running", cancel_requested_at: "2026-08-13T12:00:00Z" }],
      error: null,
    });
    const response = await cancelRun(
      new Request(`https://factory.example/api/runs/${entityId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://factory.example" },
        body: JSON.stringify({ reason: "Owner requested a safe stop." }),
      }),
      { params: Promise.resolve({ runId: entityId }) },
    );

    expect(response.status).toBe(202);
    expect(harness.rpc).toHaveBeenCalledWith("request_phase1c_run_cancellation", {
      p_organization_id: organizationId,
      p_run_id: entityId,
      p_reason: "Owner requested a safe stop.",
    });
  });

  it("reads worker connectivity only through tenant-scoped heartbeat evidence", async () => {
    harness.rpc.mockResolvedValue({
      data: [{ detail: {
        connectionStatus: "connected",
        statusLabel: "Connected",
        lastHeartbeatAt: new Date().toISOString(),
        activeWorkers: 1,
        availableWorkers: 1,
        staleAfterSeconds: 90,
      } }],
      error: null,
    });

    const response = await getWorkerStatus();
    const body = await response.json() as { worker: { statusLabel: string } };

    expect(response.status).toBe(200);
    expect(harness.rpc).toHaveBeenCalledWith("get_phase1c_worker_status", {
      p_organization_id: organizationId,
    });
    expect(body.worker.statusLabel).toBe("Worker Connected");
  });

  it("does not call a future-dated heartbeat Connected", async () => {
    harness.rpc.mockResolvedValue({
      data: [{ detail: {
        connectionStatus: "connected",
        statusLabel: "Connected",
        lastHeartbeatAt: "2099-08-13T12:00:00Z",
        activeWorkers: 1,
        availableWorkers: 1,
        staleAfterSeconds: 300,
      } }],
      error: null,
    });

    const response = await getWorkerStatus();
    const body = await response.json() as { worker: { statusLabel: string } };

    expect(response.status).toBe(200);
    expect(body.worker.statusLabel).toBe("Worker Stale");
  });

  it("queues only a database-authorized bounded retry", async () => {
    harness.rpc.mockResolvedValue({
      data: [{ run_id: entityId, status: "queued", attempt_number: 2 }],
      error: null,
    });
    const response = await retryRun(
      new Request(`https://factory.example/api/runs/${entityId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://factory.example" },
        body: JSON.stringify({ reason: "Owner requested a bounded retry." }),
      }),
      { params: Promise.resolve({ runId: entityId }) },
    );

    expect(response.status).toBe(202);
    expect(harness.rpc).toHaveBeenCalledWith("retry_phase1c_run", {
      p_organization_id: organizationId,
      p_run_id: entityId,
      p_reason: "Owner requested a bounded retry.",
    });
  });

  it("denies cancellation to a non-manager before calling the workflow", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc: harness.rpc },
    });
    const response = await cancelRun(
      new Request(`https://factory.example/api/runs/${entityId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://factory.example" },
        body: JSON.stringify({ reason: "Member requested a safe stop." }),
      }),
      { params: Promise.resolve({ runId: entityId }) },
    );

    expect(response.status).toBe(403);
    expect(harness.rpc).not.toHaveBeenCalled();
  });
});
