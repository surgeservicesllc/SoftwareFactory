// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  requireConnection: vi.fn(),
  requireUser: vi.fn(),
  rpc: vi.fn(),
  approvalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  single: vi.fn(),
  webhookMaybeSingle: vi.fn(),
}));

vi.mock("@/lib/github/access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/access")>();
  return {
    ...original,
    requireGitHubConnection: harness.requireConnection,
    requireGitHubUser: harness.requireUser,
  };
});

vi.mock("@/lib/github/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/config")>();
  return {
    ...original,
    getGitHubCandidateAppConfiguration: () => ({ appId: 5000001 }),
  };
});

vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => {
    const query = {
      contains: vi.fn(() => query),
      eq: vi.fn(() => query),
      gte: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: harness.webhookMaybeSingle,
      select: vi.fn(() => query),
    };
    return { from: vi.fn(() => query) };
  },
}));

import { POST } from "@/app/api/github/connections/[connectionId]/handoff/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const fromConnectionId = "44444444-4444-4444-8444-444444444444";
const toConnectionId = "55555555-5555-4555-8555-555555555555";
const fromInstallationId = 153445938;
const toInstallationId = 153500001;
const repositoryId = 123456789;

function request(overrides: Record<string, unknown> = {}) {
  return new Request(
    `https://factory.example/api/github/connections/${toConnectionId}/handoff`,
    {
      body: JSON.stringify({
        confirmation: "HANDOFF GITHUB PROJECT",
        fromConnectionId,
        fromInstallationId,
        projectId,
        rationale: "Replace the GitHub App with its verified candidate.",
        repositoryId,
        rollbackPlan: "Reverse to the prior live installation and verify repository reads.",
        toInstallationId,
        ...overrides,
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://factory.example",
      },
      method: "POST",
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.requireUser.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    supabase: { rpc: harness.rpc },
    user: { id: userId },
  });
  harness.requireConnection
    .mockResolvedValueOnce({
      appId: 4573846,
      installationId: fromInstallationId,
      internalInstallationId: "88888888-8888-4888-8888-888888888888",
    })
    .mockResolvedValueOnce({
      appId: 5000001,
      installationId: toInstallationId,
      internalInstallationId: "99999999-9999-4999-8999-999999999999",
    });
  harness.rpc.mockImplementation((name: string) => name === "approve_github_project_connection_handoff"
    ? Promise.resolve({ data: harness.approvalId, error: null })
    : { single: harness.single });
  harness.single.mockResolvedValue({
    data: {
      connection_id: toConnectionId,
      default_branch: "main",
      github_repository: "surgeservicesllc/SoftwareFactory",
      github_repository_id: "66666666-6666-4666-8666-666666666666",
      previous_connection_id: fromConnectionId,
      previous_github_repository_id: "77777777-7777-4777-8777-777777777777",
      project_id: projectId,
    },
    error: null,
  });
  harness.webhookMaybeSingle.mockResolvedValue({
    data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    error: null,
  });
});

describe("GitHub project App handoff route", () => {
  it("executes one exact owner-approved handoff through the caller session", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ connectionId: toConnectionId }),
    });

    expect(response.status).toBe(200);
    expect(harness.requireConnection).toHaveBeenNthCalledWith(
      1,
      { rpc: harness.rpc },
      userId,
      organizationId,
      fromConnectionId,
    );
    expect(harness.requireConnection).toHaveBeenNthCalledWith(
      2,
      { rpc: harness.rpc },
      userId,
      organizationId,
      toConnectionId,
    );
    expect(harness.rpc).toHaveBeenCalledWith("approve_github_project_connection_handoff", {
      p_confirmation_text: "HANDOFF GITHUB PROJECT",
      p_external_repository_id: repositoryId,
      p_from_connection_id: fromConnectionId,
      p_from_external_installation_id: fromInstallationId,
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_rationale: "Replace the GitHub App with its verified candidate.",
      p_rollback_plan: "Reverse to the prior live installation and verify repository reads.",
      p_to_connection_id: toConnectionId,
      p_to_external_installation_id: toInstallationId,
    });
    expect(harness.rpc).toHaveBeenCalledWith("handoff_github_project_connection", {
      p_approval_id: harness.approvalId,
      p_external_repository_id: repositoryId,
      p_from_connection_id: fromConnectionId,
      p_from_external_installation_id: fromInstallationId,
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_to_connection_id: toConnectionId,
      p_to_external_installation_id: toInstallationId,
    });
    await expect(response.json()).resolves.toMatchObject({
      handoff: {
        connectionId: toConnectionId,
        previousConnectionId: fromConnectionId,
        projectId,
      },
      historyPreserved: true,
    });
  });

  it("rejects an admin before reading either connection", async () => {
    harness.requireUser.mockResolvedValueOnce({
      activeOrganization: { id: organizationId, role: "admin" },
      supabase: { rpc: harness.rpc },
      user: { id: userId },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ connectionId: toConnectionId }),
    });

    expect(response.status).toBe(403);
    expect(harness.requireConnection).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when either installation id is stale", async () => {
    harness.requireConnection
      .mockReset()
      .mockResolvedValueOnce({ installationId: fromInstallationId })
      .mockResolvedValueOnce({ installationId: toInstallationId + 1 });

    const response = await POST(request(), {
      params: Promise.resolve({ connectionId: toConnectionId }),
    });

    expect(response.status).toBe(409);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("requires a processed signed webhook before activating the candidate App", async () => {
    harness.webhookMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(request(), {
      params: Promise.resolve({ connectionId: toConnectionId }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "candidate_webhook_not_verified",
        message: "The replacement GitHub App must complete a signed webhook delivery before handoff.",
      },
    });
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("requires exact confirmation and distinct connections", async () => {
    const badConfirmation = await POST(request({ confirmation: "HANDOFF" }), {
      params: Promise.resolve({ connectionId: toConnectionId }),
    });
    expect(badConfirmation.status).toBe(400);

    const sameConnection = await POST(request({ fromConnectionId: toConnectionId }), {
      params: Promise.resolve({ connectionId: toConnectionId }),
    });
    expect(sameConnection.status).toBe(400);
    expect(harness.rpc).not.toHaveBeenCalled();
  });
});
