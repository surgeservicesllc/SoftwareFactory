// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  tenantListResponse: vi.fn(),
}));

vi.mock("@/lib/server/tenant-list", () => ({
  tenantRpcListResponse: harness.tenantListResponse,
}));

import { GET } from "@/app/api/runs/route";

const runRow = {
  id: "run-1",
  project_id: "project-1",
  task_id: "task-1",
  agent_id: "agent-1",
  status: "succeeded",
  started_at: "2026-08-21T12:00:00.000Z",
  completed_at: "2026-08-21T12:01:00.000Z",
  created_at: "2026-08-21T11:59:00.000Z",
  task_title: "PRIVATE COMMAND PROMPT DERIVED AS TASK TITLE",
  agent_name: "Release",
  project_name: "Launchpad",
  risk_level: "yellow",
  provider: "openai",
  model: "gpt-5",
  branch_name: "feature/release",
  review_status: "approved",
  archived_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.tenantListResponse.mockImplementation(async (config: {
    rpc: string;
    shape: (rows: Array<typeof runRow>) => Record<string, unknown>;
  }) => Response.json({
    activeOrganizationId: "organization-1",
    ...config.shape([runRow]),
  }));
});

describe("runs route", () => {
  it("preserves the full default run response", async () => {
    const response = await GET(new Request("https://factory.example/api/runs?limit=1"));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: "organization-1",
      runs: [{
        id: "run-1",
        status: "succeeded",
        startedAt: "2026-08-21T12:00:00.000Z",
        completedAt: "2026-08-21T12:01:00.000Z",
        createdAt: "2026-08-21T11:59:00.000Z",
        durationMs: 60_000,
        risk: "yellow",
        provider: "openai",
        model: "gpt-5",
        branch: "feature/release",
        reviewStatus: "approved",
        archivedAt: null,
        project: { id: "project-1", name: "Launchpad" },
        task: { id: "task-1", title: "PRIVATE COMMAND PROMPT DERIVED AS TASK TITLE" },
        agent: { id: "agent-1", name: "Release" },
      }],
    });
    expect(harness.tenantListResponse).toHaveBeenCalledWith(expect.objectContaining({
      rpc: "list_agent_runs",
    }));
  });

  it("returns only fields consumed by Factory Briefing", async () => {
    const response = await GET(new Request(
      "https://factory.example/api/runs?limit=100&view=briefing",
    ));

    const body = await response.json();
    expect(body).toEqual({
      activeOrganizationId: "organization-1",
      runs: [{
        id: "run-1",
        status: "succeeded",
        startedAt: "2026-08-21T12:00:00.000Z",
        completedAt: "2026-08-21T12:01:00.000Z",
        createdAt: "2026-08-21T11:59:00.000Z",
        project: { id: "project-1", name: "Launchpad" },
        task: { id: "task-1" },
        agent: { id: "agent-1", name: "Release" },
      }],
    });
    expect(JSON.stringify(body)).not.toContain("PRIVATE COMMAND PROMPT");
  });
});
