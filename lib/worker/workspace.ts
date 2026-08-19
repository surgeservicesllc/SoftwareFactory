import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { controlledProcessEnvironment } from "@/lib/worker/env";
import { runProcess } from "@/lib/worker/process";
import type { WorkerJob } from "@/lib/worker/types";

const SAFE_BRANCH_PATTERN = /^factory\/[a-f0-9-]{36}-[a-z0-9][a-z0-9-]{0,39}$/;

export class WorkspaceError extends Error {
  readonly code: string;
  /**
   * The live base SHA the workspace actually observed when it refused a
   * stale plan. Carrying the observation lets the worker re-plan a
   * never-started run to the real head instead of dying on a base that
   * moved before execution began.
   */
  readonly observedBaseSha?: string;

  constructor(code: string, message: string, observedBaseSha?: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.observedBaseSha = observedBaseSha;
  }
}

export type PreparedWorkspace = Readonly<{
  branch: string;
  directory: string;
  gitDirectory: string;
  hooksDirectory: string;
  runDirectory: string;
}>;

function promptSlug(prompt: string) {
  const slug = prompt.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "change";
}

export function branchForJob(job: Pick<WorkerJob, "runId" | "prompt">) {
  const branch = `factory/${job.runId.toLowerCase()}-${promptSlug(job.prompt)}`;
  if (!SAFE_BRANCH_PATTERN.test(branch)) {
    throw new WorkspaceError("invalid_branch", "The generated worker branch is invalid.");
  }
  return branch;
}

function gitAuthenticationEnvironment(token: string) {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    environment: {
      ...controlledProcessEnvironment(),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    },
    secrets: [token, basic, `AUTHORIZATION: basic ${basic}`],
  };
}

async function exists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function successfulGit(
  directory: string,
  args: readonly string[],
  options: {
    env?: Record<string, string>;
    gitDirectory?: string;
    hooksDirectory?: string;
    signal?: AbortSignal;
    secrets?: readonly string[];
    preserveOutput?: boolean;
  } = {},
) {
  const trustedArgs = options.gitDirectory && options.hooksDirectory
    ? [
        `--git-dir=${options.gitDirectory}`,
        `--work-tree=${directory}`,
        "-c",
        `core.hooksPath=${options.hooksDirectory}`,
        "-c",
        "core.fsmonitor=false",
        ...args,
      ]
    : [...args];
  const environment = {
    ...(options.env ?? controlledProcessEnvironment()),
    GIT_CONFIG_NOSYSTEM: "1",
    ...(options.gitDirectory
      ? { GIT_CONFIG_GLOBAL: path.join(path.dirname(options.gitDirectory), "empty-gitconfig") }
      : {}),
  };
  const result = await runProcess({
    command: "git",
    args: trustedArgs,
    cwd: directory,
    env: environment,
    signal: options.signal,
    timeoutMs: 120_000,
    redactedSecrets: options.secrets ?? [],
  });
  if (result.exitCode !== 0) {
    throw new WorkspaceError("git_failed", result.stderr || "Git could not prepare the workspace.");
  }
  return options.preserveOutput ? result.stdout : result.stdout.trim();
}

export class GitWorkspaceManager {
  constructor(
    private readonly workRoot: string,
    private readonly commitIdentity: { name: string; email: string },
  ) {}

  async prepare(job: WorkerJob, token: string, signal?: AbortSignal): Promise<PreparedWorkspace> {
    await mkdir(this.workRoot, { recursive: true });
    const verifiedRoot = await realpath(this.workRoot);
    const runDirectory = path.join(verifiedRoot, job.runId);
    const directory = path.join(runDirectory, "repository");
    const gitDirectory = path.join(runDirectory, "trusted-git");
    const hooksDirectory = path.join(runDirectory, "empty-hooks");
    const emptyGitConfig = path.join(runDirectory, "empty-gitconfig");
    const markerPath = path.join(runDirectory, "run.json");
    const branch = branchForJob(job);
    const expectedMarker = JSON.stringify({
      runId: job.runId,
      repositoryId: job.repository.repositoryId,
      baseSha: job.repository.baseSha.toLowerCase(),
      branch,
    });

    await mkdir(runDirectory, { recursive: true });
    await mkdir(path.join(runDirectory, "codex-home"), { recursive: true, mode: 0o700 });
    await mkdir(hooksDirectory, { recursive: true, mode: 0o700 });
    if (!(await exists(emptyGitConfig))) {
      await writeFile(emptyGitConfig, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    if (await exists(markerPath)) {
      const actualMarker = await readFile(markerPath, "utf8");
      if (actualMarker !== expectedMarker) {
        throw new WorkspaceError(
          "workspace_identity_mismatch",
          "An existing run workspace does not match the claimed repository identity.",
        );
      }
    } else {
      await writeFile(markerPath, expectedMarker, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }

    const repositoryUrl = `https://github.com/${job.repository.owner}/${job.repository.name}.git`;
    const workspaceOptions = { gitDirectory, hooksDirectory } as const;
    if (!(await exists(gitDirectory))) {
      await mkdir(directory, { recursive: true });
      await successfulGit(directory, [
        "init",
        `--separate-git-dir=${gitDirectory}`,
        "--initial-branch=factory-bootstrap",
        directory,
      ], { signal });
      await this.assertTrustedMetadata(directory, gitDirectory);
      await successfulGit(directory, ["remote", "add", "origin", repositoryUrl], { signal, ...workspaceOptions });
      const authentication = gitAuthenticationEnvironment(token);
      const remoteSha = await successfulGit(
        directory,
        ["ls-remote", "origin", `refs/heads/${job.repository.baseBranch}`],
        { env: authentication.environment, signal, secrets: authentication.secrets, ...workspaceOptions },
      );
      const observedSha = remoteSha.split(/\s+/)[0]?.toLowerCase();
      if (observedSha !== job.repository.baseSha.toLowerCase()) {
        throw new WorkspaceError(
          "stale_base_sha",
          "The repository base branch changed after the run was planned. Re-plan from the current SHA.",
          observedSha,
        );
      }
      const existingBranch = await successfulGit(
        directory,
        ["ls-remote", "origin", `refs/heads/${branch}`],
        { env: authentication.environment, signal, secrets: authentication.secrets, ...workspaceOptions },
      );
      const existingBranchSha = existingBranch.split(/\s+/)[0]?.toLowerCase() || null;
      if (existingBranchSha && !job.recovery) {
        throw new WorkspaceError(
          "workspace_untracked_remote_branch",
          "A factory branch exists without coherent durable recovery evidence.",
        );
      }
      if (job.recovery && existingBranchSha
        && existingBranchSha !== job.recovery.commitSha.toLowerCase()) {
        throw new WorkspaceError(
          "workspace_recovery_mismatch",
          "The durable recovery commit does not match the exact remote factory branch.",
        );
      }
      await successfulGit(
        directory,
        ["fetch", "--no-tags", "--depth=1", "origin", `refs/heads/${job.repository.baseBranch}`],
        { env: authentication.environment, signal, secrets: authentication.secrets, ...workspaceOptions },
      );
      const fetchedSha = await successfulGit(directory, ["rev-parse", "FETCH_HEAD"], { signal, ...workspaceOptions });
      if (fetchedSha.toLowerCase() !== job.repository.baseSha.toLowerCase()) {
        throw new WorkspaceError("stale_base_sha", "Git fetched a different base commit than the planned SHA.");
      }
      if (existingBranchSha) {
        await successfulGit(
          directory,
          ["fetch", "--no-tags", "origin", `refs/heads/${branch}`],
          { env: authentication.environment, signal, secrets: authentication.secrets, ...workspaceOptions },
        );
        const recoveredSha = await successfulGit(directory, ["rev-parse", "FETCH_HEAD"], { signal, ...workspaceOptions });
        if (recoveredSha.toLowerCase() !== existingBranchSha) {
          throw new WorkspaceError(
            "workspace_branch_mismatch",
            "The remote factory branch changed while the worker was recovering it.",
          );
        }
        const ancestry = await runProcess({
          command: "git",
          args: ["merge-base", "--is-ancestor", job.repository.baseSha, recoveredSha],
          cwd: directory,
          env: {
            ...controlledProcessEnvironment(),
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: emptyGitConfig,
          },
          signal,
          timeoutMs: 60_000,
        });
        if (ancestry.exitCode !== 0) {
          throw new WorkspaceError(
            "workspace_branch_mismatch",
            "The existing remote factory branch is not descended from the planned base SHA.",
          );
        }
        await successfulGit(directory, ["checkout", "-b", branch, recoveredSha], { signal, ...workspaceOptions });
      } else {
        await successfulGit(directory, ["checkout", "--detach", job.repository.baseSha], { signal, ...workspaceOptions });
        await successfulGit(directory, ["checkout", "-b", branch], { signal, ...workspaceOptions });
      }
      await successfulGit(directory, ["config", "user.name", this.commitIdentity.name], { signal, ...workspaceOptions });
      await successfulGit(directory, ["config", "user.email", this.commitIdentity.email], { signal, ...workspaceOptions });
    } else {
      await this.assertTrustedMetadata(directory, gitDirectory);
      const remote = await successfulGit(directory, ["remote", "get-url", "origin"], { signal, ...workspaceOptions });
      if (remote !== repositoryUrl) {
        throw new WorkspaceError("workspace_remote_mismatch", "The resumed workspace points to another repository.");
      }
      const currentBranch = await successfulGit(directory, ["branch", "--show-current"], { signal, ...workspaceOptions });
      if (currentBranch !== branch) {
        throw new WorkspaceError("workspace_branch_mismatch", "The resumed workspace is on another branch.");
      }
      const authentication = gitAuthenticationEnvironment(token);
      const [remoteBase, remoteBranch] = await Promise.all([
        successfulGit(directory, ["ls-remote", repositoryUrl, `refs/heads/${job.repository.baseBranch}`], {
          env: authentication.environment, signal, secrets: authentication.secrets, ...workspaceOptions,
        }),
        successfulGit(directory, ["ls-remote", repositoryUrl, `refs/heads/${branch}`], {
          env: authentication.environment, signal, secrets: authentication.secrets, ...workspaceOptions,
        }),
      ]);
      if (remoteBase.split(/\s+/)[0]?.toLowerCase() !== job.repository.baseSha.toLowerCase()) {
        throw new WorkspaceError(
          "stale_base_sha",
          "The repository base branch changed after the run was planned.",
          remoteBase.split(/\s+/)[0]?.toLowerCase(),
        );
      }
      const remoteBranchSha = remoteBranch.split(/\s+/)[0]?.toLowerCase() || null;
      if ((job.recovery && remoteBranchSha
          && remoteBranchSha !== job.recovery.commitSha.toLowerCase())
        || (!job.recovery && remoteBranchSha)) {
        throw new WorkspaceError(
          "workspace_recovery_mismatch",
          "The resumed workspace does not match durable remote branch evidence.",
        );
      }
      if (!remoteBranchSha) {
        await successfulGit(
          directory,
          ["reset", "--hard", job.repository.baseSha],
          { signal, ...workspaceOptions },
        );
        await successfulGit(directory, ["clean", "-ffdx"], { signal, ...workspaceOptions });
        const resetHead = await successfulGit(
          directory,
          ["rev-parse", "HEAD"],
          { signal, ...workspaceOptions },
        );
        if (resetHead.toLowerCase() !== job.repository.baseSha.toLowerCase()) {
          throw new WorkspaceError(
            "workspace_recovery_mismatch",
            "The local retry workspace could not be reset to the planned base SHA.",
          );
        }
      }
    }

    return Object.freeze({ branch, directory, gitDirectory, hooksDirectory, runDirectory });
  }

  private async assertTrustedMetadata(directory: string, gitDirectory: string) {
    const pointer = await readFile(path.join(directory, ".git"), "utf8");
    const declared = pointer.match(/^gitdir:\s*(.+)\s*$/i)?.[1];
    if (!declared || path.resolve(directory, declared) !== path.resolve(gitDirectory)) {
      throw new WorkspaceError(
        "workspace_git_metadata_changed",
        "The repository Git metadata pointer changed inside the untrusted workspace.",
      );
    }
  }

  async assertRemoteBaseSha(
    workspace: PreparedWorkspace,
    repository: Pick<WorkerJob["repository"], "owner" | "name" | "baseBranch" | "baseSha">,
    token: string,
    signal?: AbortSignal,
  ) {
    await this.assertTrustedMetadata(workspace.directory, workspace.gitDirectory);
    const git = {
      gitDirectory: workspace.gitDirectory,
      hooksDirectory: workspace.hooksDirectory,
    } as const;
    const expectedOrigin = `https://github.com/${repository.owner}/${repository.name}.git`;
    const origin = await successfulGit(
      workspace.directory,
      ["remote", "get-url", "origin"],
      { signal, ...git },
    );
    if (origin !== expectedOrigin) {
      throw new WorkspaceError(
        "workspace_remote_mismatch",
        "The reviewed workspace no longer points to the planned GitHub repository.",
      );
    }
    const authentication = gitAuthenticationEnvironment(token);
    const remoteBase = await successfulGit(
      workspace.directory,
      ["ls-remote", "--refs", "origin", `refs/heads/${repository.baseBranch}`],
      {
        env: authentication.environment,
        signal,
        secrets: authentication.secrets,
        ...git,
      },
    );
    const lines = remoteBase.split(/\r?\n/).filter(Boolean);
    const observedSha = lines.length === 1
      ? lines[0]?.split(/\s+/)[0]?.toLowerCase()
      : undefined;
    if (observedSha !== repository.baseSha.toLowerCase()) {
      throw new WorkspaceError(
        "stale_base_sha",
        "The repository base branch changed after the run was planned. Re-plan from the current SHA.",
      );
    }
  }

  async changedFiles(workspace: PreparedWorkspace, baseSha: string, signal?: AbortSignal) {
    const commands = [
      ["diff", "--name-only", "-z", `${baseSha}...HEAD`],
      ["diff", "--name-only", "-z"],
      ["diff", "--cached", "--name-only", "-z"],
      ["ls-files", "--others", "--exclude-standard", "-z"],
    ] as const;
    const outputs = await Promise.all(commands.map((args) => successfulGit(
      workspace.directory,
      args,
      {
        signal,
        preserveOutput: true,
        gitDirectory: workspace.gitDirectory,
        hooksDirectory: workspace.hooksDirectory,
      },
    )));
    return [...new Set(outputs.flatMap((output) => output.split("\0").filter(Boolean)))].sort();
  }

  async currentHead(workspace: PreparedWorkspace, signal?: AbortSignal) {
    return (await successfulGit(workspace.directory, ["rev-parse", "HEAD"], {
      signal,
      gitDirectory: workspace.gitDirectory,
      hooksDirectory: workspace.hooksDirectory,
    })).toLowerCase();
  }

  async diffCheck(workspace: PreparedWorkspace, signal?: AbortSignal) {
    await this.assertTrustedMetadata(workspace.directory, workspace.gitDirectory);
    const result = await runProcess({
      command: "git",
      args: [
        `--git-dir=${workspace.gitDirectory}`,
        `--work-tree=${workspace.directory}`,
        "-c",
        `core.hooksPath=${workspace.hooksDirectory}`,
        "-c",
        "core.fsmonitor=false",
        "diff",
        "--check",
      ],
      cwd: workspace.directory,
      env: {
        ...controlledProcessEnvironment(),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: path.join(workspace.runDirectory, "empty-gitconfig"),
      },
      signal,
      timeoutMs: 60_000,
    });
    return result;
  }

  async commit(workspace: PreparedWorkspace, message: string, signal?: AbortSignal) {
    await this.assertTrustedMetadata(workspace.directory, workspace.gitDirectory);
    const git = {
      gitDirectory: workspace.gitDirectory,
      hooksDirectory: workspace.hooksDirectory,
    } as const;
    await successfulGit(workspace.directory, ["add", "--all"], { signal, ...git });
    const staged = await runProcess({
      command: "git",
      args: [
        `--git-dir=${workspace.gitDirectory}`,
        `--work-tree=${workspace.directory}`,
        "-c",
        `core.hooksPath=${workspace.hooksDirectory}`,
        "diff",
        "--cached",
        "--quiet",
      ],
      cwd: workspace.directory,
      env: {
        ...controlledProcessEnvironment(),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: path.join(workspace.runDirectory, "empty-gitconfig"),
      },
      signal,
      timeoutMs: 60_000,
    });
    if (staged.exitCode === 0) {
      throw new WorkspaceError("no_changes", "Codex completed without producing a repository change.");
    }
    if (staged.exitCode !== 1) {
      throw new WorkspaceError("git_failed", staged.stderr || "Git could not inspect the staged change.");
    }
    await successfulGit(workspace.directory, ["commit", "--no-verify", "-m", message], { signal, ...git });
    return await successfulGit(workspace.directory, ["rev-parse", "HEAD"], { signal, ...git });
  }

  async assertImmutableCommit(workspace: PreparedWorkspace, commitSha: string, signal?: AbortSignal) {
    await this.assertTrustedMetadata(workspace.directory, workspace.gitDirectory);
    const git = { gitDirectory: workspace.gitDirectory, hooksDirectory: workspace.hooksDirectory } as const;
    const head = await successfulGit(workspace.directory, ["rev-parse", "HEAD"], { signal, ...git });
    if (head.toLowerCase() !== commitSha.toLowerCase()) {
      throw new WorkspaceError("workspace_commit_changed", "The reviewed commit is no longer the workspace HEAD.");
    }
    const status = await successfulGit(
      workspace.directory,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { signal, preserveOutput: true, ...git },
    );
    if (status.length > 0) {
      throw new WorkspaceError(
        "workspace_changed_after_scan",
        "The workspace changed after its immutable commit was reviewed.",
      );
    }
  }

  async push(workspace: PreparedWorkspace, token: string, commitSha: string, signal?: AbortSignal) {
    await this.assertImmutableCommit(workspace, commitSha, signal);
    const authentication = gitAuthenticationEnvironment(token);
    const origin = await successfulGit(
      workspace.directory,
      ["remote", "get-url", "origin"],
      {
        signal,
        gitDirectory: workspace.gitDirectory,
        hooksDirectory: workspace.hooksDirectory,
      },
    );
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(origin)) {
      throw new WorkspaceError("workspace_remote_mismatch", "The reviewed GitHub remote URL is invalid.");
    }
    try {
      await successfulGit(
        workspace.directory,
        ["push", "--no-verify", origin, `${commitSha}:refs/heads/${workspace.branch}`],
        {
          env: authentication.environment,
          signal,
          secrets: authentication.secrets,
          gitDirectory: workspace.gitDirectory,
          hooksDirectory: workspace.hooksDirectory,
        },
      );
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === "git_failed") {
        throw new WorkspaceError(
          "git_push_failed",
          "GitHub did not conclusively accept the exact factory commit push; a bounded retry must reconcile the remote branch.",
        );
      }
      throw error;
    }
  }
}
