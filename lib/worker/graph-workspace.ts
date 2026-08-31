import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { controlledProcessEnvironment } from "@/lib/worker/env";
import { runProcess } from "@/lib/worker/process";
import type { GraphExecutionTarget } from "@/lib/worker/graph-target";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export class GraphWorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GraphWorkspaceError";
    this.code = code;
  }
}

export type PreparedGraphWorkspace = Readonly<{
  directory: string;
  repositoryFullName: string;
  baseBranch: string;
  baseSha: string;
}>;

type RepositoryUrlFactory = (target: GraphExecutionTarget) => string;

function canonicalRepositoryUrl(target: GraphExecutionTarget) {
  return `https://github.com/${target.repository_full_name}.git`;
}

function assertSafeRoot(root: string) {
  const resolved = path.resolve(root);
  if (
    resolved === path.parse(resolved).root
    || resolved === path.resolve(homedir())
    || resolved === path.resolve(process.cwd())
  ) {
    throw new GraphWorkspaceError(
      "unsafe_workspace_root",
      "SOFTWAREFACTORY_GRAPH_WORK_ROOT must be a dedicated child directory.",
    );
  }
  return resolved;
}

function authenticationEnvironment(token: string) {
  if (token.trim().length < 20) {
    throw new GraphWorkspaceError("github_token_invalid", "The repository token is invalid.");
  }
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    environment: {
      ...controlledProcessEnvironment(),
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: "",
      GIT_TERMINAL_PROMPT: "0",
    },
    secrets: [token, basic, `AUTHORIZATION: basic ${basic}`],
  };
}

async function exists(candidate: string) {
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function git(
  directory: string,
  args: readonly string[],
  options: {
    gitDirectory?: string;
    hooksDirectory?: string;
    environment?: Record<string, string>;
    secrets?: readonly string[];
    signal?: AbortSignal;
  } = {},
) {
  const commandArgs = options.gitDirectory && options.hooksDirectory
    ? [
        `--git-dir=${options.gitDirectory}`,
        `--work-tree=${directory}`,
        "-c", `core.hooksPath=${options.hooksDirectory}`,
        "-c", "core.fsmonitor=false",
        "-c", "submodule.recurse=false",
        ...args,
      ]
    : [...args];
  const result = await runProcess({
    command: "git",
    args: commandArgs,
    cwd: directory,
    env: {
      ...(options.environment ?? controlledProcessEnvironment()),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: options.gitDirectory
        ? path.join(path.dirname(options.gitDirectory), "empty-gitconfig")
        : path.join(directory, "empty-gitconfig"),
      GIT_TERMINAL_PROMPT: "0",
    },
    signal: options.signal,
    timeoutMs: 120_000,
    redactedSecrets: options.secrets,
  });
  if (result.exitCode !== 0) {
    throw new GraphWorkspaceError(
      "git_failed",
      result.stderr.trim() || "Git could not prepare the exact repository workspace.",
    );
  }
  return result.stdout.trim();
}

export function assertGraphWorkspaceIdentity(
  target: Pick<GraphExecutionTarget, "repository_full_name" | "base_sha">,
  observedRemoteUrl: string,
  observedHead: string,
  expectedRemoteUrl = `https://github.com/${target.repository_full_name}.git`,
) {
  const normalizeUrl = (value: string) => value.trim().replace(/\.git$/i, "").toLowerCase();
  if (normalizeUrl(observedRemoteUrl) !== normalizeUrl(expectedRemoteUrl)) {
    throw new GraphWorkspaceError(
      "repository_identity_mismatch",
      "The prepared workspace origin does not match the exact target repository.",
    );
  }
  if (!SHA_PATTERN.test(observedHead) || observedHead !== target.base_sha) {
    throw new GraphWorkspaceError(
      "base_sha_mismatch",
      "The prepared workspace HEAD does not match the immutable target base SHA.",
    );
  }
}

async function rejectSymlinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      throw new GraphWorkspaceError(
        "workspace_symlink_refused",
        "The target repository contains a symbolic link and cannot be exposed to read-only tools safely.",
      );
    }
    if (metadata.isDirectory()) await rejectSymlinks(candidate);
  }
}

async function setTreeWritable(directory: string): Promise<void> {
  if (!(await exists(directory))) return;
  const metadata = await lstat(directory);
  if (!metadata.isSymbolicLink()) await chmod(directory, metadata.mode | 0o700).catch(() => undefined);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return;
  for (const entry of await readdir(directory)) {
    await setTreeWritable(path.join(directory, entry));
  }
}

async function setTreeReadOnly(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink()) {
    throw new GraphWorkspaceError("workspace_symlink_refused", "A symbolic link reached the read-only workspace fence.");
  }
  if (metadata.isDirectory()) {
    for (const entry of await readdir(directory)) {
      await setTreeReadOnly(path.join(directory, entry));
    }
    await chmod(directory, metadata.mode & ~0o222);
    return;
  }
  await chmod(directory, metadata.mode & ~0o222);
}

/**
 * Prepares a fresh detached Git tree and exposes only its read-only work tree.
 * The trusted Git directory and hooks directory are siblings, the .git pointer
 * is removed before the callback, and cleanup runs on success or failure.
 */
export class GraphReadWorkspaceManager {
  private readonly workRoot: string;

  constructor(
    workRoot: string,
    private readonly repositoryUrlForTarget: RepositoryUrlFactory = canonicalRepositoryUrl,
  ) {
    this.workRoot = assertSafeRoot(workRoot);
  }

  private async cleanup(runDirectory: string, verifiedRoot: string) {
    const absolute = path.resolve(runDirectory);
    const prefix = `${path.resolve(verifiedRoot)}${path.sep}`;
    if (!absolute.startsWith(prefix)) {
      throw new GraphWorkspaceError(
        "workspace_cleanup_refused",
        "The graph workspace cleanup target escaped its dedicated root.",
      );
    }
    await setTreeWritable(absolute);
    await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
  }

  async withWorkspace<T>(
    target: GraphExecutionTarget,
    token: string,
    callback: (workspace: PreparedGraphWorkspace) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await mkdir(this.workRoot, { recursive: true, mode: 0o700 });
    const verifiedRoot = await realpath(this.workRoot);
    const runDirectory = await mkdtemp(path.join(verifiedRoot, "graph-"));
    const directory = path.join(runDirectory, "repository");
    const gitDirectory = path.join(runDirectory, "trusted-git");
    const hooksDirectory = path.join(runDirectory, "empty-hooks");
    const emptyGitConfig = path.join(runDirectory, "empty-gitconfig");
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await mkdir(hooksDirectory, { recursive: true, mode: 0o700 });
      await writeFile(emptyGitConfig, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
      const repositoryUrl = this.repositoryUrlForTarget(target);
      if (!repositoryUrl || /[\r\n\0]/.test(repositoryUrl)) {
        throw new GraphWorkspaceError("repository_identity_invalid", "The exact repository URL is invalid.");
      }

      await git(directory, [
        "init",
        `--separate-git-dir=${gitDirectory}`,
        "--initial-branch=workspace-bootstrap",
        directory,
      ], { signal });
      const workspaceOptions = { gitDirectory, hooksDirectory, signal } as const;
      await git(directory, ["config", "--local", "core.hooksPath", hooksDirectory], workspaceOptions);
      await git(directory, ["config", "--local", "core.fsmonitor", "false"], workspaceOptions);
      await git(directory, ["remote", "add", "origin", repositoryUrl], workspaceOptions);

      const authentication = authenticationEnvironment(token);
      const authenticated = {
        ...workspaceOptions,
        environment: authentication.environment,
        secrets: authentication.secrets,
      };
      const branchReference = await git(
        directory,
        ["ls-remote", "--exit-code", "origin", `refs/heads/${target.base_branch}`],
        authenticated,
      );
      const branchLines = branchReference.split(/\r?\n/).filter(Boolean);
      if (
        branchLines.length !== 1
        || !SHA_PATTERN.test(branchLines[0]?.split(/\s+/, 1)[0] ?? "")
      ) {
        throw new GraphWorkspaceError(
          "base_branch_unavailable",
          "The target base branch did not resolve to one exact Git commit.",
        );
      }

      // Fetch the immutable SHA itself, not the branch tip. A branch moving
      // after planning is valid when the pinned commit remains reachable in
      // this exact repository.
      await git(
        directory,
        ["fetch", "--no-tags", "--depth=1", "origin", target.base_sha],
        authenticated,
      );
      await git(directory, ["cat-file", "-e", `${target.base_sha}^{commit}`], workspaceOptions);
      await git(directory, ["checkout", "--detach", "--force", target.base_sha], workspaceOptions);

      const observedRemote = await git(directory, ["remote", "get-url", "origin"], workspaceOptions);
      const observedHead = await git(directory, ["rev-parse", "--verify", "HEAD"], workspaceOptions);
      const observedHooks = await git(directory, ["config", "--local", "--get", "core.hooksPath"], workspaceOptions);
      if (path.resolve(observedHooks) !== path.resolve(hooksDirectory)) {
        throw new GraphWorkspaceError(
          "hooks_not_disabled",
          "The isolated workspace did not retain its empty hooks directory.",
        );
      }
      assertGraphWorkspaceIdentity(target, observedRemote, observedHead, repositoryUrl);
      await rejectSymlinks(directory);

      // Nothing handed to Claude points back to trusted Git metadata. The
      // target tree becomes read-only only after every identity check passes.
      const gitPointer = path.join(directory, ".git");
      if (await exists(gitPointer)) await unlink(gitPointer);
      await setTreeReadOnly(directory);

      const workspace = Object.freeze({
        directory,
        repositoryFullName: target.repository_full_name,
        baseBranch: target.base_branch,
        baseSha: target.base_sha,
      });
      return await callback(workspace);
    } finally {
      try {
        await this.cleanup(runDirectory, verifiedRoot);
      } catch (cleanupError) {
        throw cleanupError instanceof GraphWorkspaceError
          ? cleanupError
          : new GraphWorkspaceError("workspace_cleanup_failed", "The isolated graph workspace could not be cleaned.");
      }
    }
  }
}
