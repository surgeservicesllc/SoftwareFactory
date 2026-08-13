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
  dispatchPhase1CWorker,
  PHASE_1C_DISPATCH_EVENT,
} from "@/lib/orchestration/dispatch";

describe("Phase 1C worker dispatch", () => {
  beforeEach(() => {
    createGitHubInstallationToken.mockReset().mockResolvedValue({ token: "scoped-token" });
    getGitHubAppConfigurationForAppId.mockReset().mockReturnValue({ appId: 4582606 });
    githubApiRequest.mockReset().mockResolvedValue(null);
  });

  it("uses an exact repository-scoped App token and sends only an opaque command id", async () => {
    await dispatchPhase1CWorker({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
    }, "22222222-2222-4222-8222-222222222222");

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

  it.each(["owner", "owner/repo/extra", "owner/%2Frepo", "/repo"])(
    "rejects invalid repository coordinate %s before provider access",
    async (repositoryFullName) => {
      await expect(dispatchPhase1CWorker({
        appId: 4582606,
        externalInstallationId: 153479019,
        externalRepositoryId: 1332327462,
        repositoryFullName,
      }, "22222222-2222-4222-8222-222222222222")).rejects.toThrow();
      expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    },
  );
});
