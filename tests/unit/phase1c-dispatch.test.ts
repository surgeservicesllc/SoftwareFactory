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
    createGitHubInstallationToken.mockReset().mockResolvedValue({ token: "scoped-token" });
    getGitHubAppConfigurationForAppId.mockReset().mockReturnValue({ appId: 4582606 });
    githubApiRequest.mockReset().mockResolvedValue(null);
  });

  it("uses an exact repository-scoped App token and sends only an opaque command id", async () => {
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
      { appId: 4582606 },
      153479019,
      {
        permissions: { contents: "write", metadata: "read" },
        repositoryIds: [1332327462],
      },
    );
    expect(githubApiRequest).toHaveBeenCalledWith(
      "/repos/surgeservicesllc/SoftwareFactory/dispatches",
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

  it("dispatches a target-bound graph only when the global gate is exactly true", async () => {
    vi.stubEnv("SOFTWAREFACTORY_GRAPH_WORKER_ENABLED", "true");

    await expect(dispatchGraphWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
    }, "33333333-3333-4333-8333-333333333333")).resolves.toEqual({
      dispatched: true,
      reason: "dispatched",
    });
    expect(githubApiRequest).toHaveBeenCalledWith(
      "/repos/surgeservicesllc/SoftwareFactory/dispatches",
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
});
