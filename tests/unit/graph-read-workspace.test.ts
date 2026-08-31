// @vitest-environment node

import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphExecutionTarget } from "@/lib/worker/graph-target";
import {
  assertGraphWorkspaceIdentity,
  GraphReadWorkspaceManager,
} from "@/lib/worker/graph-workspace";

const execFile = promisify(execFileCallback);
const temporaryRoots: string[] = [];

function target(baseSha: string): GraphExecutionTarget {
  return {
    protocol_version: 1,
    graph_id: "10000000-0000-4000-8000-000000000001",
    organization_id: "10000000-0000-4000-8000-000000000002",
    project_id: "10000000-0000-4000-8000-000000000003",
    connection_id: "10000000-0000-4000-8000-000000000004",
    github_repository_id: "10000000-0000-4000-8000-000000000005",
    internal_installation_id: "10000000-0000-4000-8000-000000000006",
    external_installation_id: 123,
    app_id: 456,
    external_repository_id: 789,
    repository_full_name: "factory/target-repository",
    base_branch: "main",
    base_sha: baseSha,
    required_check_names: ["CI"],
    required_checks_sha256: "b".repeat(64),
    target_sha256: "c".repeat(64),
  };
}

async function git(cwd: string, ...args: string[]) {
  const result = await execFile("git", args, { cwd, windowsHide: true });
  return result.stdout.trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "sf-graph-workspace-test-"));
  temporaryRoots.push(root);
  const origin = path.join(root, "origin.git");
  const source = path.join(root, "source");
  await execFile("git", ["init", "--bare", "--initial-branch=main", origin], { windowsHide: true });
  await execFile("git", ["init", "--initial-branch=main", source], { windowsHide: true });
  await git(source, "config", "user.name", "Workspace Test");
  await git(source, "config", "user.email", "workspace@example.test");
  await writeFile(path.join(source, "answer.txt"), "pinned\n", "utf8");
  await writeFile(path.join(source, "package.json"), JSON.stringify({
    scripts: { preinstall: "node -e \"require('fs').writeFileSync('../target-code-ran','bad')\"" },
  }), "utf8");
  await git(source, "add", ".");
  await git(source, "commit", "-m", "pinned base");
  const pinned = await git(source, "rev-parse", "HEAD");
  await git(source, "remote", "add", "origin", origin);
  await git(source, "push", "-u", "origin", "main");

  await writeFile(path.join(source, "answer.txt"), "moved\n", "utf8");
  await git(source, "add", "answer.txt");
  await git(source, "commit", "-m", "branch moved");
  const moved = await git(source, "rev-parse", "HEAD");
  await git(source, "push", "origin", "main");
  return { root, origin, pinned, moved };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true, maxRetries: 3 })
  )));
});

describe("GraphReadWorkspaceManager", () => {
  it("checks out a still-reachable pinned SHA after the target branch moves and cleans it", async () => {
    const { root, origin, pinned, moved } = await fixture();
    expect(moved).not.toBe(pinned);
    const workRoot = path.join(root, "workspaces");
    let preparedDirectory = "";

    const result = await new GraphReadWorkspaceManager(workRoot, () => origin).withWorkspace(
      target(pinned),
      "installation-token-for-workspace-test",
      async (workspace) => {
        preparedDirectory = workspace.directory;
        expect(await readFile(path.join(workspace.directory, "answer.txt"), "utf8")).toBe("pinned\n");
        await expect(access(path.join(workspace.directory, ".git"))).rejects.toThrow();
        await expect(access(path.join(root, "target-code-ran"))).rejects.toThrow();
        return workspace.baseSha;
      },
    );

    expect(result).toBe(pinned);
    await expect(access(preparedDirectory)).rejects.toThrow();
    expect(await readdir(workRoot)).toEqual([]);
    await expect(access(path.join(root, "target-code-ran"))).rejects.toThrow();
  }, 30_000);

  it("refuses wrong repository and SHA identity", () => {
    const exact = target("a".repeat(40));
    expect(() => assertGraphWorkspaceIdentity(
      exact,
      "https://github.com/factory/wrong.git",
      exact.base_sha,
    )).toThrowError(expect.objectContaining({ code: "repository_identity_mismatch" }));
    expect(() => assertGraphWorkspaceIdentity(
      exact,
      `https://github.com/${exact.repository_full_name}.git`,
      "b".repeat(40),
    )).toThrowError(expect.objectContaining({ code: "base_sha_mismatch" }));
  });

  it("never invokes the provider callback when workspace preparation fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sf-graph-workspace-fail-"));
    temporaryRoots.push(root);
    const callback = vi.fn();
    const workRoot = path.join(root, "workspaces");
    const missingOrigin = path.join(root, "missing.git");

    await expect(new GraphReadWorkspaceManager(workRoot, () => missingOrigin).withWorkspace(
      target("a".repeat(40)),
      "installation-token-for-workspace-test",
      callback,
    )).rejects.toMatchObject({ code: "git_failed" });
    expect(callback).not.toHaveBeenCalled();
    expect(await readdir(workRoot)).toEqual([]);
  }, 30_000);
});
