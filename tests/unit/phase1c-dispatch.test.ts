import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createGitHubInstallationToken,
  getGitHubAppConfigurationForAppId,
  githubApiRequest,
} = vi.hoisted(() => ({
  createGitHubInstallationToken: vi.fn(),
  getGitHubAppConfigurationForAppId: vi.fn(),
  githubApiRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/github/client", () => ({
  createGitHubInstallationToken,
  githubApiRequest,
}));
vi.mock("@/lib/github/config", () => ({ getGitHubAppConfigurationForAppId }));

import {
  dispatchGraphWorker,
  dispatchPhase1CWorker,
  GRAPH_DISPATCH_EVENT,
  PHASE_1C_DISPATCH_EVENT,
} from "@/lib/orchestration/dispatch";

describe("Phase 1C worker dispatch", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("SOFTWAREFACTORY_WORKER_HOST_APP_ID", "7654321");
    vi.stubEnv("SOFTWAREFACTORY_WORKER_HOST_INSTALLATION_ID", "987654321");
    vi.stubEnv("SOFTWAREFACTORY_WORKER_HOST_REPOSITORY_ID", "1234567890");
    vi.stubEnv("SOFTWAREFACTORY_WORKER_HOST_REPOSITORY", "factory-runtime/SoftwareFactory");
    createGitHubInstallationToken.mockReset().mockResolvedValue({ token: "scoped-token" });
    getGitHubAppConfigurationForAppId.mockReset().mockReturnValue({ appId: 7654321 });
    githubApiRequest.mockReset().mockResolvedValue(null);
  });

  it("dispatches to the reviewed worker host while sending only the opaque target command id", async () => {
    vi.stubEnv("SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED", "true");

    await expect(dispatchPhase1CWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
    }, "22222222-2222-4222-8222-222222222222")).resolves.toEqual({
      dispatched: true,
      reason: "dispatched",
    });

    expect(createGitHubInstallationToken).toHaveBeenCalledWith(
      { appId: 7654321 },
      987654321,
      {
        permissions: { contents: "write", metadata: "read" },
        repositoryIds: [1234567890],
      },
    );
    expect(githubApiRequest).toHaveBeenCalledWith(
      "/repos/factory-runtime/SoftwareFactory/dispatches",
      {
        body: {
          event_type: PHASE_1C_DISPATCH_EVENT,
          client_payload: { command_id: "22222222-2222-4222-8222-222222222222" },
        },
        method: "POST",
        token: "scoped-token",
      },
    );
  });

  it("keeps Phase 1C dispatch inert while the application worker gate is off", async () => {
    vi.stubEnv("SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED", "false");

    await expect(dispatchPhase1CWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
    }, "22222222-2222-4222-8222-222222222222")).resolves.toEqual({
      dispatched: false,
      reason: "worker_disabled",
    });
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it.each(["owner", "owner/repo/extra", "owner/%2Frepo", "/repo"])(
    "rejects invalid repository coordinate %s before provider access",
    async (repositoryFullName) => {
      vi.stubEnv("SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED", "true");
      await expect(dispatchPhase1CWorker({
        appId: 4582606,
        externalInstallationId: 153479019,
        externalRepositoryId: 1332327462,
        repositoryFullName,
      }, "22222222-2222-4222-8222-222222222222")).rejects.toThrow();
      expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    },
  );

  it("fails closed before provider access when the reviewed worker host is not configured", async () => {
    vi.stubEnv("SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED", "true");
    vi.stubEnv("SOFTWAREFACTORY_WORKER_HOST_REPOSITORY", "");

    await expect(dispatchPhase1CWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "another-owner/target-project",
    }, "22222222-2222-4222-8222-222222222222")).rejects.toThrow();
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("keeps graph dispatch inert while the global worker gate is off", async () => {
    vi.stubEnv("SOFTWAREFACTORY_GRAPH_WORKER_ENABLED", "false");

    await expect(dispatchGraphWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
    }, "33333333-3333-4333-8333-333333333333")).resolves.toEqual({
      dispatched: false,
      reason: "worker_disabled",
    });
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("dispatches a target-bound graph to the central runtime even for another project repository", async () => {
    vi.stubEnv("SOFTWAREFACTORY_GRAPH_WORKER_ENABLED", "true");

    await expect(dispatchGraphWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "another-owner/target-project",
    }, "33333333-3333-4333-8333-333333333333")).resolves.toEqual({
      dispatched: true,
      reason: "dispatched",
    });
    expect(githubApiRequest).toHaveBeenCalledWith(
      "/repos/factory-runtime/SoftwareFactory/dispatches",
      {
        body: {
          event_type: GRAPH_DISPATCH_EVENT,
          client_payload: { graph_id: "33333333-3333-4333-8333-333333333333" },
        },
        method: "POST",
        token: "scoped-token",
      },
    );
  });

  it("carries an exact opaque wake receipt identity without target repository metadata", async () => {
    vi.stubEnv("SOFTWAREFACTORY_GRAPH_WORKER_ENABLED", "true");

    await dispatchGraphWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "another-owner/target-project",
    }, "33333333-3333-4333-8333-333333333333", {
      wakeIntentId: "44444444-4444-4444-8444-444444444444",
      controlRevision: 7,
    });

    expect(githubApiRequest).toHaveBeenCalledWith(
      "/repos/factory-runtime/SoftwareFactory/dispatches",
      expect.objectContaining({
        body: {
          event_type: GRAPH_DISPATCH_EVENT,
          client_payload: {
            graph_id: "33333333-3333-4333-8333-333333333333",
            wake_intent_id: "44444444-4444-4444-8444-444444444444",
            control_revision: "7",
          },
        },
      }),
    );
  });

  it("rejects a malformed wake receipt before provider access", async () => {
    vi.stubEnv("SOFTWAREFACTORY_GRAPH_WORKER_ENABLED", "true");

    await expect(dispatchGraphWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "another-owner/target-project",
    }, "33333333-3333-4333-8333-333333333333", {
      wakeIntentId: "not-a-uuid",
      controlRevision: 0,
    })).rejects.toThrow("wake receipt identity");
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(githubApiRequest).not.toHaveBeenCalled();
  });
});
