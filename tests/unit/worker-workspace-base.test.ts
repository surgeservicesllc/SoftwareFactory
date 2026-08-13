import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const processMocks = vi.hoisted(() => ({ runProcess: vi.fn() }));

vi.mock("@/lib/worker/process", () => ({ runProcess: processMocks.runProcess }));

import type { WorkerJob } from "@/lib/worker/types";
import { GitWorkspaceManager, type PreparedWorkspace } from "@/lib/worker/workspace";

const temporaryPaths: string[] = [];
const repository: WorkerJob["repository"] = {
  appId: 1,
  installationId: 2,
  repositoryId: 3,
  owner: "example",
  name: "application",
  baseBranch: "main",
  baseSha: "a".repeat(40),
};

afterEach(async () => {
  processMocks.runProcess.mockReset();
  await Promise.all(temporaryPaths.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function preparedWorkspace(): Promise<PreparedWorkspace> {
  const directory = await mkdtemp(path.join(tmpdir(), "softwarefactory-base-sha-"));
  temporaryPaths.push(directory);
  const gitDirectory = path.join(directory, "trusted-git");
  const hooksDirectory = path.join(directory, "empty-hooks");
  await mkdir(gitDirectory);
  await mkdir(hooksDirectory);
  await writeFile(path.join(directory, ".git"), `gitdir: ${gitDirectory}\n`);
  return {
    branch: "factory/10000000-0000-4000-8000-000000000001-change",
    directory,
    gitDirectory,
    hooksDirectory,
    runDirectory: directory,
  };
}

function successfulProcess(stdout: string) {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

describe("GitWorkspaceManager remote base boundary", () => {
  it("re-fetches the exact default-branch ref from the trusted planned origin", async () => {
    const workspace = await preparedWorkspace();
    processMocks.runProcess
      .mockResolvedValueOnce(successfulProcess("https://github.com/example/application.git\n"))
      .mockResolvedValueOnce(successfulProcess(`${repository.baseSha}\trefs/heads/main\n`));
    const manager = new GitWorkspaceManager(workspace.runDirectory, { name: "Factory", email: "factory@example.com" });

    await expect(manager.assertRemoteBaseSha(workspace, repository, "installation-token"))
      .resolves.toBeUndefined();

    expect(processMocks.runProcess).toHaveBeenCalledTimes(2);
    expect(processMocks.runProcess.mock.calls[1]?.[0]).toMatchObject({
      command: "git",
      args: expect.arrayContaining(["ls-remote", "--refs", "origin", "refs/heads/main"]),
      redactedSecrets: expect.arrayContaining(["installation-token"]),
    });
  });

  it("fails closed when the default-branch ref no longer resolves to the planned SHA", async () => {
    const workspace = await preparedWorkspace();
    processMocks.runProcess
      .mockResolvedValueOnce(successfulProcess("https://github.com/example/application.git\n"))
      .mockResolvedValueOnce(successfulProcess(`${"b".repeat(40)}\trefs/heads/main\n`));
    const manager = new GitWorkspaceManager(workspace.runDirectory, { name: "Factory", email: "factory@example.com" });

    await expect(manager.assertRemoteBaseSha(workspace, repository, "installation-token"))
      .rejects.toMatchObject({ code: "stale_base_sha" });
  });
});
