// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  executeProviderTask: vi.fn(),
  loadProjectRoutingContext: vi.fn(),
  readRepositoryMemoryExcerpts: vi.fn(),
  requireActiveOrganization: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/providers/runtime", () => ({ executeProviderTask: harness.executeProviderTask }));
vi.mock("@/lib/providers/memory", () => ({
  readRepositoryMemoryExcerpts: harness.readRepositoryMemoryExcerpts,
}));
vi.mock("@/lib/providers/service", () => ({
  loadProjectRoutingContext: harness.loadProjectRoutingContext,
}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { POST as initializeAgents } from "@/app/api/agents/route";
import { POST as previewProviderTask } from "@/app/api/runs/preview/route";
import { POST as runProviderTask } from "@/app/api/runs/route";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const taskId = "30000000-0000-4000-8000-000000000001";
const agentId = "40000000-0000-4000-8000-000000000001";

function post(path: string, body: unknown) {
  return new Request(`https://factory.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

function runBody(overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    taskId,
    agentId,
    taskKind: "plan",
    instructions: "Produce a bounded advisory implementation plan.",
    requestedProvider: "AUTO",
    riskLevel: "GREEN",
    ...overrides,
  };
}

function projectContext() {
  return {
    projectId,
    projectName: "SoftwareFactory",
    repositoryFullName: "surgeservicesllc/SoftwareFactory",
    defaultBranch: "main",
    executionEnabled: true,
    policy: {
      defaultProvider: "AUTO",
      allowedProviders: ["anthropic", "openai"],
      allowFallback: false,
      maximumRisk: "GREEN",
    },
    availability: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.readRepositoryMemoryExcerpts.mockResolvedValue([]);
  harness.loadProjectRoutingContext.mockResolvedValue(projectContext());
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc: harness.rpc, from: vi.fn() },
  });
});

describe("provider API mutation boundaries", () => {
  it("re-reads the initialized roster through the bounded list_agents RPC", async () => {
    harness.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{
          id: agentId,
          name: "Orchestrator",
          role: "orchestrator",
          description: null,
          status: "idle",
          provider: null,
          model: null,
          last_run_at: null,
          capabilities: [],
        }],
        error: null,
      });

    const response = await initializeAgents(post("/api/agents", {}));
    const body = await response.json() as { agents: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(harness.rpc).toHaveBeenNthCalledWith(1, "ensure_default_agents", {
      p_organization_id: organizationId,
    });
    expect(harness.rpc).toHaveBeenNthCalledWith(2, "list_agents", {
      p_limit: 100,
      p_organization_id: organizationId,
    });
    expect(body.agents).toEqual([expect.objectContaining({ id: agentId })]);
  });

  it("blocks a non-manager before loading routing context or contacting a provider", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc: harness.rpc, from: vi.fn() },
    });

    const response = await runProviderTask(post("/api/runs", runBody()));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "provider_run_forbidden" } });
    expect(harness.loadProjectRoutingContext).not.toHaveBeenCalled();
    expect(harness.executeProviderTask).not.toHaveBeenCalled();
  });

  it("rejects a task from another project before loading the agent or provider", async () => {
    harness.rpc.mockResolvedValueOnce({
      data: [{ detail: { id: taskId, risk: "green", project: { id: crypto.randomUUID() } } }],
      error: null,
    });

    const response = await runProviderTask(post("/api/runs", runBody()));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "task_not_found" } });
    expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.executeProviderTask).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied risk that differs from the persisted task", async () => {
    harness.rpc.mockResolvedValueOnce({
      data: [{ detail: { id: taskId, risk: "yellow", project: { id: projectId } } }],
      error: null,
    });

    const response = await runProviderTask(post("/api/runs", runBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "risk_mismatch" } });
    expect(harness.executeProviderTask).not.toHaveBeenCalled();
  });

  it("blocks RED before loading routing context or contacting a provider", async () => {
    const response = await runProviderTask(post("/api/runs", runBody({ riskLevel: "RED" })));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "red_provider_run_blocked" } });
    expect(harness.requireActiveOrganization).toHaveBeenCalledOnce();
    expect(harness.loadProjectRoutingContext).not.toHaveBeenCalled();
    expect(harness.executeProviderTask).not.toHaveBeenCalled();
  });

  it("fails closed on an unknown persisted agent role before provider execution", async () => {
    harness.rpc
      .mockResolvedValueOnce({
        data: [{ detail: { id: taskId, risk: "green", project: { id: projectId } } }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ id: agentId, role: "future_unreviewed_role", provider: "openai", model: "gpt" }],
        error: null,
      });

    const response = await runProviderTask(post("/api/runs", runBody()));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "agent_not_found" } });
    expect(harness.executeProviderTask).not.toHaveBeenCalled();
  });

  it("loads preview assignments only through the bounded assignment RPC", async () => {
    harness.rpc.mockResolvedValueOnce({
      data: [{ id: agentId, role: "orchestrator", provider: null, model: null }],
      error: null,
    });

    const response = await previewProviderTask(post("/api/runs/preview", {
      projectId,
      agentId,
      taskKind: "plan",
      requestedProvider: "AUTO",
      riskLevel: "GREEN",
    }));

    expect(response.status).toBe(200);
    expect(harness.rpc).toHaveBeenCalledWith("get_provider_agent_assignment", {
      p_agent_id: agentId,
      p_organization_id: organizationId,
    });
  });
});
