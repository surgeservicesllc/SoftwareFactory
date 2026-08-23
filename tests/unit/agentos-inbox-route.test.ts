// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tenantListResponse: vi.fn(),
}));

vi.mock("@/lib/server/tenant-list", () => ({
  tenantRpcListResponse: harness.tenantListResponse,
}));

import { GET } from "@/app/api/agentos/inbox/route";

const inboxRow = {
  id: "message-1",
  author: "agent",
  kind: "multiple_choice",
  status: "open",
  body: "Choose a rollout strategy.",
  choices: ["Canary", "Immediate"],
  selected_choice: null,
  answer_body: null,
  agent_name: "Release",
  agent_run_id: "run-1",
  created_at: "2026-08-21T12:00:00.000Z",
  answered_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.tenantListResponse.mockImplementation(async (config: {
    rpc: string;
    shape: (rows: typeof inboxRow[]) => Record<string, unknown>;
  }) => Response.json({
    activeOrganizationId: "organization-1",
    ...config.shape([inboxRow]),
  }));
});

describe("AgentOS inbox route", () => {
  it("preserves the full default inbox response", async () => {
    const response = await GET(new Request("https://factory.example/api/agentos/inbox?limit=1"));
    const body = await response.json();

    expect(body.messages).toEqual([{
      id: "message-1",
      author: "agent",
      kind: "multiple_choice",
      status: "open",
      body: "Choose a rollout strategy.",
      choices: ["Canary", "Immediate"],
      selectedChoice: null,
      answerBody: null,
      agentName: "Release",
      agentRunId: "run-1",
      createdAt: "2026-08-21T12:00:00.000Z",
      answeredAt: null,
    }]);
    expect(harness.tenantListResponse).toHaveBeenCalledWith(expect.objectContaining({
      rpc: "agentos_list_inbox",
    }));
  });

  it("returns only the fields needed by the Factory Briefing view", async () => {
    const response = await GET(new Request(
      "https://factory.example/api/agentos/inbox?limit=100&view=briefing",
    ));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: "organization-1",
      messages: [{
        id: "message-1",
        kind: "multiple_choice",
        status: "open",
        agentName: "Release",
        createdAt: "2026-08-21T12:00:00.000Z",
      }],
    });
  });
});
