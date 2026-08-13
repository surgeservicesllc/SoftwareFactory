import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  codexClientOptions,
  CodexSdkAdapter,
  type CodexClientLike,
} from "@/lib/worker/codex";
import {
  controlledProcessEnvironment,
  readWorkerConfiguration,
  WorkerConfigurationError,
} from "@/lib/worker/env";
import { PolicyScanError, scanChangedFiles } from "@/lib/worker/policy-scan";
import { ProcessExecutionError, runProcess } from "@/lib/worker/process";
import { hasLikelySecret, redactText } from "@/lib/worker/redact";
import { workerJobSchema, type WorkerJob } from "@/lib/worker/types";
import { dockerContainerArguments, PINNED_VALIDATION_IMAGE } from "@/lib/worker/validation";
import { branchForJob, type PreparedWorkspace } from "@/lib/worker/workspace";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return workerJobSchema.parse({
    runId: "10000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000002",
    projectId: "10000000-0000-4000-8000-000000000003",
    commandId: "10000000-0000-4000-8000-000000000004",
    taskId: "10000000-0000-4000-8000-000000000005",
    agentId: "10000000-0000-4000-8000-000000000006",
    connectionId: "10000000-0000-4000-8000-000000000007",
    repositoryDatabaseId: "10000000-0000-4000-8000-000000000008",
    prompt: "Fix the responsive navigation without changing authentication.",
    commandType: "fix_bug",
    acceptanceCriteria: ["Mobile navigation remains keyboard accessible."],
    plan: {},
    agentRole: "frontend",
    provider: "openai",
    model: "codex-test-model",
    risk: "green",
    repository: {
      appId: 123,
      installationId: 456,
      repositoryId: 789,
      owner: "example",
      name: "repository",
      baseBranch: "main",
      baseSha: "a".repeat(40),
    },
    worker: {
      leaseToken: "10000000-0000-4000-8000-000000000009",
      leaseExpiresAt: "2026-08-13T18:00:00.000Z",
    },
    budget: {
      maximumDurationMs: 300_000,
      maximumTurns: 3,
      maximumInputTokens: 100_000,
      maximumOutputTokens: 20_000,
      maximumRepairAttempts: 1,
      ciTimeoutMs: 300_000,
    },
    ownerApproval: null,
    attempt: 1,
    cancellationRequested: false,
    ...overrides,
  });
}

describe("worker environment", () => {
  it("fails closed until every server-only setting is valid", () => {
    expect(() => readWorkerConfiguration({
      SOFTWAREFACTORY_WORKER_ENABLED: "true",
      SOFTWAREFACTORY_WORKER_ID: "worker-test",
    })).toThrow(WorkerConfigurationError);
  });

  it("does not pass application credentials into child processes", () => {
    const environment = controlledProcessEnvironment({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-this-must-not-be-inherited",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_this_must_not_be_inherited",
      GITHUB_APP_PRIVATE_KEY: "private",
    });
    expect(environment.PATH).toBe("/usr/bin");
    expect(environment.CI).toBe("true");
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(environment.GITHUB_APP_PRIVATE_KEY).toBeUndefined();
  });

  it("hard-stops a child that exceeds its execution deadline", async () => {
    const startedAt = Date.now();
    await expect(runProcess({
      command: process.execPath,
      args: ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      cwd: process.cwd(),
      env: controlledProcessEnvironment(),
      timeoutMs: 50,
    })).rejects.toMatchObject({ code: "timed_out" } satisfies Partial<ProcessExecutionError>);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("never spawns work for an already-cancelled run", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runProcess({
      command: "this-command-must-never-run",
      cwd: process.cwd(),
      env: controlledProcessEnvironment(),
      signal: controller.signal,
      timeoutMs: 5_000,
    })).rejects.toMatchObject({ code: "aborted" } satisfies Partial<ProcessExecutionError>);
  });
});

describe("worker redaction", () => {
  it("redacts known credentials and generic sensitive assignments", () => {
    const token = `ghp_${"A".repeat(30)}`;
    const result = redactText(`token=${token}\nOPENAI_API_KEY=super-secret-value`);
    expect(result).not.toContain(token);
    expect(result).not.toContain("super-secret-value");
    expect(result).toContain("[REDACTED]");
    expect(hasLikelySecret(`GITHUB_TOKEN=${token}`)).toBe(true);
  });
});

describe("worker repository boundary", () => {
  it("generates one deterministic factory branch from the immutable run id", () => {
    expect(branchForJob(job())).toBe(
      "factory/10000000-0000-4000-8000-000000000001-fix-the-responsive-navigation-without-ch",
    );
  });

  it("uses an unguessable run UUID rather than prompt text as the branch authority", () => {
    expect(branchForJob(job({ prompt: "../../main\nforce push" }))).toMatch(
      /^factory\/10000000-0000-4000-8000-000000000001-[a-z0-9-]+$/,
    );
    expect(branchForJob(job({ prompt: "../../main\nforce push" }))).not.toContain("..");
  });

  it("blocks likely secrets before a change can be committed", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "softwarefactory-worker-test-"));
    temporaryPaths.push(directory);
    await mkdir(path.join(directory, "src"));
    await writeFile(path.join(directory, "src", "config.ts"), `export const API_KEY = "${"z".repeat(32)}";`);
    const workspace: PreparedWorkspace = {
      branch: branchForJob(job()),
      directory,
      gitDirectory: path.join(directory, "trusted-git"),
      hooksDirectory: path.join(directory, "empty-hooks"),
      runDirectory: directory,
    };
    await expect(scanChangedFiles(job(), workspace, ["src/config.ts"]))
      .rejects.toMatchObject({ code: "likely_secret_detected" } satisfies Partial<PolicyScanError>);
  });

  it("requires current owner approval for protected paths", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "softwarefactory-worker-test-"));
    temporaryPaths.push(directory);
    await mkdir(path.join(directory, "supabase", "migrations"), { recursive: true });
    await writeFile(path.join(directory, "supabase", "migrations", "safe.sql"), "select 1;\n");
    const workspace: PreparedWorkspace = {
      branch: branchForJob(job()),
      directory,
      gitDirectory: path.join(directory, "trusted-git"),
      hooksDirectory: path.join(directory, "empty-hooks"),
      runDirectory: directory,
    };
    await expect(scanChangedFiles(job(), workspace, ["supabase/migrations/safe.sql"]))
      .rejects.toMatchObject({ code: "owner_approval_required" } satisfies Partial<PolicyScanError>);
  });

  it("blocks binary files instead of skipping their content scan", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "softwarefactory-worker-test-"));
    temporaryPaths.push(directory);
    await writeFile(path.join(directory, "asset.bin"), Buffer.from([0, 1, 2, 3]));
    const workspace: PreparedWorkspace = {
      branch: branchForJob(job()),
      directory,
      gitDirectory: path.join(directory, "trusted-git"),
      hooksDirectory: path.join(directory, "empty-hooks"),
      runDirectory: directory,
    };
    await expect(scanChangedFiles(job(), workspace, ["asset.bin"]))
      .rejects.toMatchObject({ code: "binary_file_blocked" } satisfies Partial<PolicyScanError>);
  });

  it("runs deterministic checks in the pinned networkless Docker sandbox", () => {
    const workspace: PreparedWorkspace = {
      branch: branchForJob(job()),
      directory: process.cwd(),
      gitDirectory: path.join(process.cwd(), ".git"),
      hooksDirectory: path.join(process.cwd(), ".git", "empty-hooks"),
      runDirectory: process.cwd(),
    };
    const args = dockerContainerArguments({
      workspace,
      network: "none",
      command: "npm",
      args: ["run", "test"],
    });
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain(PINNED_VALIDATION_IMAGE);
    expect(args.join(" ")).not.toContain("OPENAI_API_KEY");
  });
});

describe("Codex SDK adapter", () => {
  it("gives model shell commands only an explicit credential-free environment", () => {
    const runDirectory = path.join(process.cwd(), "isolated-run");
    const workspace: PreparedWorkspace = {
      branch: branchForJob(job()),
      directory: process.cwd(),
      gitDirectory: path.join(runDirectory, "trusted-git"),
      hooksDirectory: path.join(runDirectory, "empty-hooks"),
      runDirectory,
    };
    const options = codexClientOptions("dedicated-sdk-api-key", workspace, {
      PATH: "/safe/bin",
      TEMP: "/safe/tmp",
      HOME: "/unsafe/host-home",
      CODEX_API_KEY: "ambient-codex-key",
      OPENAI_API_KEY: "ambient-openai-key",
      DEPLOY_KEY: "ambient-deploy-key",
      WEBHOOK_SECRET: "ambient-webhook-secret",
      ACCESS_TOKEN: "ambient-access-token",
      SAFE_BUT_UNNEEDED: "must-not-be-inherited",
    });
    const shellPolicy = options.config?.shell_environment_policy as {
      inherit: string;
      experimental_use_profile: boolean;
      ignore_default_excludes: boolean;
      set: Record<string, string>;
      filters: Record<string, string>;
    };
    const codexHome = path.join(runDirectory, "codex-home");

    expect(options.apiKey).toBe("dedicated-sdk-api-key");
    expect(options.env).toEqual({
      PATH: "/safe/bin",
      TEMP: "/safe/tmp",
      HOME: codexHome,
      USERPROFILE: codexHome,
      CI: "true",
      GIT_TERMINAL_PROMPT: "0",
      NEXT_TELEMETRY_DISABLED: "1",
      NO_COLOR: "1",
      CODEX_HOME: codexHome,
    });
    expect(options.config?.allow_login_shell).toBe(false);
    expect(shellPolicy).toMatchObject({
      inherit: "none",
      experimental_use_profile: false,
      ignore_default_excludes: false,
    });
    expect(shellPolicy.filters).toEqual({
      CODEX_API_KEY: "exclude",
      OPENAI_API_KEY: "exclude",
      PATH: "include",
      SYSTEMROOT: "include",
      WINDIR: "include",
      COMSPEC: "include",
      PATHEXT: "include",
      TEMP: "include",
      TMP: "include",
      HOME: "include",
      USERPROFILE: "include",
      LANG: "include",
      LC_ALL: "include",
      TERM: "include",
      CI: "include",
      GIT_TERMINAL_PROMPT: "include",
      NEXT_TELEMETRY_DISABLED: "include",
      NO_COLOR: "include",
    });
    expect(shellPolicy.set).toEqual({
      PATH: "/safe/bin",
      TEMP: "/safe/tmp",
      HOME: codexHome,
      USERPROFILE: codexHome,
      CI: "true",
      GIT_TERMINAL_PROMPT: "0",
      NEXT_TELEMETRY_DISABLED: "1",
      NO_COLOR: "1",
    });
    expect(Object.keys(shellPolicy.set)).not.toContain("CODEX_HOME");
    expect(Object.keys(shellPolicy.set).some((name) => /key|secret|token/i.test(name))).toBe(false);
    expect(Object.values(shellPolicy.set)).not.toContain("ambient-codex-key");
    expect(Object.values(shellPolicy.set)).not.toContain("ambient-openai-key");
    expect(Object.values(shellPolicy.set)).not.toContain("ambient-deploy-key");
    expect(Object.values(shellPolicy.set)).not.toContain("ambient-webhook-secret");
    expect(Object.values(shellPolicy.set)).not.toContain("ambient-access-token");
    expect(Object.values(shellPolicy.set)).not.toContain("must-not-be-inherited");
  });

  it("uses a writable sandbox with no agent network, no approvals, and bounded usage", async () => {
    let observedOptions: ThreadOptions | null = null;
    const events: ThreadEvent[] = [
      { type: "thread.started", thread_id: "thread-1" },
      { type: "turn.started" },
      { type: "item.completed", item: { id: "message-1", type: "agent_message", text: JSON.stringify({ summary: "Done", tests: [], risks: [] }) } },
      { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 30, reasoning_output_tokens: 10 } },
    ];
    const client: CodexClientLike = {
      startThread(options) {
        observedOptions = options;
        let threadId: string | null = null;
        return {
          get id() { return threadId; },
          async runStreamed() {
            async function* stream() {
              for (const event of events) {
                if (event.type === "thread.started") threadId = event.thread_id;
                yield event;
              }
            }
            return { events: stream() };
          },
        };
      },
      resumeThread: vi.fn(),
    };
    const adapter = new CodexSdkAdapter("test-api-key-not-used", () => client);
    const workspace: PreparedWorkspace = {
      branch: branchForJob(job()),
      directory: process.cwd(),
      gitDirectory: path.join(process.cwd(), ".git"),
      hooksDirectory: path.join(process.cwd(), ".git", "empty-hooks"),
      runDirectory: process.cwd(),
    };
    const session = adapter.createSession(job(), workspace);
    const result = await session.run("Do the work.", new AbortController().signal, vi.fn());

    expect(observedOptions).toMatchObject({
      approvalPolicy: "never",
      networkAccessEnabled: false,
      sandboxMode: "workspace-write",
      webSearchMode: "disabled",
      workingDirectory: process.cwd(),
    });
    expect(result).toMatchObject({
      threadId: "thread-1",
      summary: "Done",
      usage: { inputTokens: 100, outputTokens: 30, reasoningOutputTokens: 10 },
    });
  });
});
