// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  executeProviderTask: vi.fn(),
  getProviderAdapter: vi.fn(),
  listModels: vi.fn(),
  loadProjectRoutingContext: vi.fn(),
  readRepositoryMemoryExcerpts: vi.fn(),
  requireActiveOrganization: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/providers/runtime", () => ({ executeProviderTask: harness.executeProviderTask }));
vi.mock("@/lib/providers/registry", () => ({ getProviderAdapter: harness.getProviderAdapter }));
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
import { POST as assignAgentProvider } from "@/app/api/agents/[agentId]/assignment/route";
import {
  GET as listProviderModels,
  POST as upsertProviderModel,
} from "@/app/api/providers/models/route";
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
  harness.getProviderAdapter.mockReturnValue({ listModels: harness.listModels });
  harness.listModels.mockResolvedValue([{
    id: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    maxInputTokens: null,
    maxOutputTokens: null,
  }]);
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: {
      rpc: harness.rpc,
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: harness.maybeSingle }),
        }),
      }),
    },
  });
  harness.maybeSingle.mockResolvedValue({
    data: { ai_provider_execution_enabled: true },
    error: null,
  });
});

describe("provider API mutation boundaries", () => {
  it("returns only a bounded secret-free live model catalogue", async () => {
    const response = await listProviderModels(
      new Request("https://factory.example/api/providers/models?provider=openai"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: "openai",
      models: [{
        id: "gpt-5.3-codex",
        displayName: "GPT-5.3 Codex",
        maxInputTokens: null,
        maxOutputTokens: null,
      }],
    });
  });

  it("does not contact a provider for discovery while outbound execution is OFF", async () => {
    harness.maybeSingle.mockResolvedValue({
      data: { ai_provider_execution_enabled: false },
      error: null,
    });

    const response = await listProviderModels(
      new Request("https://factory.example/api/providers/models?provider=openai"),
    );

    expect(response.status).toBe(409);
    expect(harness.getProviderAdapter).not.toHaveBeenCalled();
    expect(harness.listModels).not.toHaveBeenCalled();
  });

  it("does not contact a provider for discovery as a plain member", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc: harness.rpc, from: vi.fn() },
    });

    const response = await listProviderModels(
      new Request("https://factory.example/api/providers/models?provider=openai"),
    );

    expect(response.status).toBe(403);
    expect(harness.getProviderAdapter).not.toHaveBeenCalled();
    expect(harness.listModels).not.toHaveBeenCalled();
  });

  it.each([
    ["secret display", [{ id: "safe-model", displayName: `sk-${"s".repeat(30)}`, maxInputTokens: null, maxOutputTokens: null }]],
    ["oversized count", Array.from({ length: 101 }, (_, index) => ({ id: `model-${index}`, displayName: `Model ${index}`, maxInputTokens: null, maxOutputTokens: null }))],
    ["invalid numeric limit", [{ id: "safe-model", displayName: "Safe model", maxInputTokens: Number.POSITIVE_INFINITY, maxOutputTokens: null }]],
  ])("fails closed on a %s from an untrusted provider catalogue", async (_label, models) => {
    harness.listModels.mockResolvedValue(models);

    const response = await listProviderModels(
      new Request("https://factory.example/api/providers/models?provider=openai"),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("invalid_response");
    expect(body).not.toContain("sk-");
  });

  it("rejects credential-shaped model metadata before authentication or RPC access", async () => {
    const secretLike = `sk-${"q".repeat(30)}`;
    const response = await upsertProviderModel(post("/api/providers/models", {
      provider: "openai",
      model: "safe-model",
      displayName: secretLike,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_model_configuration" },
    });
    expect(harness.requireActiveOrganization).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

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

  it("rejects cross-origin agent assignment before authentication or database access", async () => {
    const request = new Request(`https://factory.example/api/agents/${agentId}/assignment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
      },
      body: JSON.stringify({ provider: "openai", model: "gpt-5.3-codex" }),
    });

    const response = await assignAgentProvider(request, {
      params: Promise.resolve({ agentId }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request_origin" } });
    expect(harness.requireActiveOrganization).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("bounds agent assignment JSON before resolving the active tenant", async () => {
    const response = await assignAgentProvider(
      post(`/api/agents/${agentId}/assignment`, {
        provider: "openai",
        model: `gpt-${"x".repeat(33_000)}`,
      }),
      { params: Promise.resolve({ agentId }) },
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
    expect(harness.requireActiveOrganization).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("refuses an agent outside the active organization before the mutation RPC", async () => {
    harness.rpc.mockResolvedValueOnce({ data: [], error: null });

    const response = await assignAgentProvider(
      post(`/api/agents/${agentId}/assignment`, {
        provider: "openai",
        model: "gpt-5.3-codex",
      }),
      { params: Promise.resolve({ agentId }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "agent_not_found" } });
    expect(harness.rpc).toHaveBeenCalledOnce();
    expect(harness.rpc).toHaveBeenCalledWith("get_provider_agent_assignment", {
      p_agent_id: agentId,
      p_organization_id: organizationId,
    });
    expect(harness.rpc).not.toHaveBeenCalledWith(
      "set_agent_provider_assignment",
      expect.anything(),
    );
  });

  it("passes only the exact active-tenant agent and validated assignment to the owner-checked RPC", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: agentId, name: "Orchestrator", provider: "openai", model: "gpt-5.3-codex" },
      error: null,
    });
    harness.rpc
      .mockResolvedValueOnce({
        data: [{ id: agentId, role: "orchestrator", provider: null, model: null }],
        error: null,
      })
      .mockReturnValueOnce({ single });

    const response = await assignAgentProvider(
      post(`/api/agents/${agentId}/assignment`, {
        provider: "openai",
        model: "gpt-5.3-codex",
      }),
      { params: Promise.resolve({ agentId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      agent: {
        id: agentId,
        name: "Orchestrator",
        provider: "openai",
        model: "gpt-5.3-codex",
      },
    });
    expect(harness.rpc).toHaveBeenNthCalledWith(1, "get_provider_agent_assignment", {
      p_agent_id: agentId,
      p_organization_id: organizationId,
    });
    expect(harness.rpc).toHaveBeenNthCalledWith(2, "set_agent_provider_assignment", {
      p_agent_id: agentId,
      p_provider: "openai",
      p_model: "gpt-5.3-codex",
    });
    expect(single).toHaveBeenCalledOnce();
  });

  it("preserves the database owner/admin denial after active-tenant resolution", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "organization owner or administrator access is required" },
    });
    harness.rpc
      .mockResolvedValueOnce({
        data: [{ id: agentId, role: "orchestrator", provider: null, model: null }],
        error: null,
      })
      .mockReturnValueOnce({ single });

    const response = await assignAgentProvider(
      post(`/api/agents/${agentId}/assignment`, {
        provider: null,
        model: null,
      }),
      { params: Promise.resolve({ agentId }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: "42501",
        message: "organization owner or administrator access is required",
      },
    });
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
