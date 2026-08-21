// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  tenantListResponse: vi.fn(),
}));

vi.mock("@/lib/server/tenant-list", () => ({
  tenantRpcListResponse: harness.tenantListResponse,
}));

import { GET } from "@/app/api/agents/route";

const agentRow = {
  id: "agent-1",
  name: "Liaison",
  role: "orchestrator",
  description: "Coordinates the crew",
  status: "working",
  provider: "openai",
  model: "gpt-5",
  last_run_at: "2026-08-21T12:00:00.000Z",
  capabilities: ["planning", "Sensitive internal capability detail", 42],
  current_assignment: "Coordinate the release",
  provider_connection_status: "connected",
  project_id: "project-1",
  project_name: "Launchpad",
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.tenantListResponse.mockImplementation(async (config: {
    rpc: string;
    shape: (rows: Array<typeof agentRow>) => Record<string, unknown>;
  }) => Response.json({
    activeOrganizationId: "organization-1",
    ...config.shape([agentRow]),
  }));
});

describe("agents route", () => {
  it("preserves the full default agent response", async () => {
    const response = await GET(new Request("https://factory.example/api/agents?limit=1"));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: "organization-1",
      agents: [{
        id: "agent-1",
        name: "Liaison",
        role: "orchestrator",
        description: "Coordinates the crew",
        provider: "openai",
        model: "gpt-5",
        status: "working",
        lastRunAt: "2026-08-21T12:00:00.000Z",
        currentAssignment: "Coordinate the release",
        providerConnectionStatus: "connected",
        project: { id: "project-1", name: "Launchpad" },
        capabilities: ["planning", "Sensitive internal capability detail"],
      }],
    });
    expect(harness.tenantListResponse).toHaveBeenCalledWith(expect.objectContaining({
      rpc: "list_agents",
    }));
  });

  it("returns only fields consumed by Factory Briefing", async () => {
    const response = await GET(new Request(
      "https://factory.example/api/agents?limit=100&view=briefing",
    ));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: "organization-1",
      agents: [{
        id: "agent-1",
        name: "Liaison",
        role: "orchestrator",
        status: "working",
      }],
    });
  });
});
