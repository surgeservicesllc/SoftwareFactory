// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tenantListResponse: vi.fn(),
}));

vi.mock("@/lib/server/tenant-list", () => ({
  tenantRpcListResponse: harness.tenantListResponse,
}));

import { GET } from "@/app/api/tasks/route";

const taskRow = {
  id: "task-1",
  project_id: "project-1",
  assigned_agent_id: "agent-1",
  title: "PRIVATE COMMAND PROMPT DERIVED AS TASK TITLE",
  status: "in_progress",
  risk_level: "yellow",
  requires_owner_approval: false,
  priority: 80,
  created_at: "2026-08-21T12:00:00.000Z",
  project_name: "Launchpad",
  agent_name: "Release",
  command_id: "command-1",
  command_prompt: "Sensitive implementation prompt",
  dependency_count: 2,
  latest_run_id: "run-1",
  latest_run_status: "running",
  pull_request_number: 42,
  pull_request_url: "https://github.example/pull/42",
  pull_request_status: "open",
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.tenantListResponse.mockImplementation(async (config: {
    rpc: string;
    shape: (rows: Array<typeof taskRow>) => Record<string, unknown>;
  }) => Response.json({
    activeOrganizationId: "organization-1",
    ...config.shape([taskRow]),
  }));
});

describe("tasks route", () => {
  it("preserves the full default task response", async () => {
    const response = await GET(new Request("https://factory.example/api/tasks?limit=1"));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: "organization-1",
      tasks: [{
        id: "task-1",
        title: "PRIVATE COMMAND PROMPT DERIVED AS TASK TITLE",
        status: "in_progress",
        risk: "yellow",
        requiresOwnerApproval: false,
        priority: 80,
        createdAt: "2026-08-21T12:00:00.000Z",
        dependencyCount: 2,
        project: { id: "project-1", name: "Launchpad" },
        agent: { id: "agent-1", name: "Release" },
        latestRun: { id: "run-1", status: "running" },
        pullRequest: {
          number: 42,
          url: "https://github.example/pull/42",
          status: "open",
        },
        command: { id: "command-1", prompt: "Sensitive implementation prompt" },
      }],
    });
    expect(harness.tenantListResponse).toHaveBeenCalledWith(expect.objectContaining({
      rpc: "list_tasks",
    }));
  });

  it("omits command content and its derived task title from the Factory Briefing response", async () => {
    const response = await GET(new Request(
      "https://factory.example/api/tasks?limit=100&view=briefing",
    ));

    const body = await response.json();
    expect(body).toEqual({
      activeOrganizationId: "organization-1",
      tasks: [{
        id: "task-1",
        status: "in_progress",
        risk: "yellow",
        requiresOwnerApproval: false,
        priority: 80,
        createdAt: "2026-08-21T12:00:00.000Z",
        dependencyCount: 2,
        project: { id: "project-1", name: "Launchpad" },
        agent: { id: "agent-1", name: "Release" },
        latestRun: { id: "run-1", status: "running" },
        pullRequest: {
          number: 42,
          url: "https://github.example/pull/42",
        },
      }],
    });
    expect(JSON.stringify(body)).not.toContain("PRIVATE COMMAND PROMPT");
    expect(JSON.stringify(body)).not.toContain("Sensitive implementation prompt");
  });
});
