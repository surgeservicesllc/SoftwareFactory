// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const syncHarness = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc: syncHarness.rpc }),
}));

import { persistGitHubInstallationSnapshot } from "@/lib/github/sync";
import type { GitHubInstallationSnapshot } from "@/lib/github/types";

const snapshot: GitHubInstallationSnapshot = {
  account: {
    avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
    id: 42,
    login: "acme-renamed",
    type: "Organization",
  },
  appId: 1234,
  appSlug: "softwarefactory",
  events: ["installation", "installation_repositories", "push", "pull_request"],
  id: 5678,
  installedAt: "2026-08-12T12:00:00Z",
  permissions: { checks: "read", contents: "write", pull_requests: "write" },
  repositories: [{
    archived: false,
    defaultBranch: "main",
    disabled: false,
    fullName: "acme-renamed/factory-renamed",
    githubUpdatedAt: "2026-08-12T12:05:00Z",
    htmlUrl: "https://github.com/acme-renamed/factory-renamed",
    id: 9999,
    name: "factory-renamed",
    nodeId: "R_kgDOExample",
    ownerLogin: "acme-renamed",
    permissions: { admin: true, pull: true, push: true },
    private: true,
    pushedAt: "2026-08-12T12:04:00Z",
    visibility: "private",
  }],
  repositorySelection: "selected",
  suspendedAt: null,
  targetType: "Organization",
};

beforeEach(() => {
  syncHarness.rpc.mockReset().mockReturnValue({
    single: async () => ({
      data: {
        connection_id: "11111111-1111-4111-8111-111111111111",
        installation_id: "22222222-2222-4222-8222-222222222222",
        repository_count: 1,
        was_created: true,
      },
      error: null,
    }),
  });
});

describe("GitHub installation synchronization", () => {
  it("passes normalized metadata to the privileged transactional RPC without credentials", async () => {
    const result = await persistGitHubInstallationSnapshot(
      {} as never,
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      snapshot,
    );

    expect(result).toMatchObject({ repository_count: 1, was_created: true });
    expect(syncHarness.rpc).toHaveBeenCalledTimes(1);
    const [functionName, parameters] = syncHarness.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(functionName).toBe("sync_github_installation");
    expect(parameters).toMatchObject({
      p_account_login: "acme-renamed",
      p_actor_user_id: "33333333-3333-4333-8333-333333333333",
      p_external_installation_id: 5678,
      p_organization_id: "44444444-4444-4444-8444-444444444444",
      p_repository_selection: "selected",
      p_suspended_at: null,
    });
    expect(parameters.p_repositories).toEqual([expect.objectContaining({
      default_branch: "main",
      full_name: "acme-renamed/factory-renamed",
      id: 9999,
      name: "factory-renamed",
      owner_login: "acme-renamed",
    })]);
    const serialized = JSON.stringify(parameters).toLowerCase();
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("private_key");
    expect(serialized).not.toContain("webhook_secret");
  });

  it("fails closed when the transactional sync is rejected", async () => {
    syncHarness.rpc.mockReturnValue({
      single: async () => ({
        data: null,
        error: { code: "42501", message: "organization owner or administrator access is required" },
      }),
    });

    await expect(persistGitHubInstallationSnapshot(
      {} as never,
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      snapshot,
    )).rejects.toMatchObject({ code: "42501" });
  });
});
