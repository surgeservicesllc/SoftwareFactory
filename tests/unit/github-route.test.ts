// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  configuration: { appId: 1 },
  configurationForAppId: vi.fn(),
  createToken: vi.fn(),
  lostRpc: vi.fn(),
  requireConnection: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/github/access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/access")>();
  return {
    ...original,
    requireGitHubConnection: harness.requireConnection,
    requireGitHubUser: harness.requireUser,
  };
});
vi.mock("@/lib/github/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/client")>();
  return { ...original, createGitHubInstallationToken: harness.createToken };
});
vi.mock("@/lib/github/config", () => ({
  getGitHubAppConfigurationForAppId: harness.configurationForAppId,
}));
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc: harness.lostRpc }),
}));

import { GitHubApiError } from "@/lib/github/client";
import { prepareGitHubRepositoryRequest } from "@/lib/github/route";

const connectionId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  harness.configurationForAppId.mockReturnValue(harness.configuration);
  harness.requireUser.mockResolvedValue({
    activeOrganization: { id: "11111111-1111-4111-8111-111111111111" },
    supabase: {},
    user: { id: userId },
  });
  harness.requireConnection.mockResolvedValue({
    appId: 1,
    connectionId,
    installationId: 12345,
    organizationId: "11111111-1111-4111-8111-111111111111",
    repository: {
      archived: false,
      defaultBranch: "main",
      disabled: false,
      externalId: 67890,
      fullName: "example/repository",
      id: "55555555-5555-4555-8555-555555555555",
      selected: true,
    },
    role: "owner",
    status: "connected",
    userId,
  });
  harness.lostRpc.mockResolvedValue({ data: true, error: null });
});

describe("GitHub repository request loss detection", () => {
  it("persists a revoked installation discovered by an ordinary repository read", async () => {
    const error = new GitHubApiError(503, "github_installation_revoked", "GitHub Connection Lost.");
    harness.createToken.mockRejectedValue(error);

    await expect(prepareGitHubRepositoryRequest(
      new Request(`https://softwarefactory.example/api/github/repositories/example/repository/tree?connectionId=${connectionId}`),
      { owner: "example", repo: "repository" },
      { contents: "read" },
    )).rejects.toBe(error);

    expect(harness.lostRpc).toHaveBeenCalledWith("mark_github_connection_lost", {
      p_actor_user_id: null,
      p_connection_id: connectionId,
      p_reason: "installation_revoked",
    });
  });

  it("persists insufficient permission discovered by an ordinary repository request", async () => {
    const error = new GitHubApiError(403, "github_permission_denied", "Permission denied.");
    harness.createToken.mockRejectedValue(error);

    await expect(prepareGitHubRepositoryRequest(
      new Request(`https://softwarefactory.example/api/github/repositories/example/repository/pulls?connectionId=${connectionId}`),
      { owner: "example", repo: "repository" },
      { pull_requests: "read" },
    )).rejects.toBe(error);

    expect(harness.lostRpc).toHaveBeenCalledWith("mark_github_connection_lost", expect.objectContaining({
      p_reason: "insufficient_permission",
    }));
  });

  it("does not mark a healthy connection lost for rate limiting", async () => {
    const error = new GitHubApiError(429, "github_rate_limited", "Rate limited.");
    harness.createToken.mockRejectedValue(error);

    await expect(prepareGitHubRepositoryRequest(
      new Request(`https://softwarefactory.example/api/github/repositories/example/repository/tree?connectionId=${connectionId}`),
      { owner: "example", repo: "repository" },
      { contents: "read" },
    )).rejects.toBe(error);

    expect(harness.lostRpc).not.toHaveBeenCalled();
  });

  it("returns the repository-scoped token without loss mutation when acquisition succeeds", async () => {
    harness.createToken.mockResolvedValue({ expiresAt: "2026-08-12T23:00:00.000Z", token: "installation-token" });

    await expect(prepareGitHubRepositoryRequest(
      new Request(`https://softwarefactory.example/api/github/repositories/example/repository/tree?connectionId=${connectionId}`),
      { owner: "example", repo: "repository" },
      { contents: "read" },
    )).resolves.toMatchObject({ token: "installation-token" });

    expect(harness.createToken).toHaveBeenCalledWith(harness.configuration, 12345, {
      permissions: { contents: "read" },
      repositoryIds: [67890],
    });
    expect(harness.configurationForAppId).toHaveBeenCalledWith(1);
    expect(harness.lostRpc).not.toHaveBeenCalled();
  });
});
