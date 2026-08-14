import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexSession } from "@/lib/worker/codex";
import {
  workerJobSchema,
  type ValidationResult,
  type WorkerJob,
  type WorkerStore,
} from "@/lib/worker/types";
import { SoftwareFactoryWorker } from "@/lib/worker/worker";
import { WorkspaceError, type PreparedWorkspace } from "@/lib/worker/workspace";

const temporaryPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
    prompt: "Fix the responsive navigation.",
    commandType: "fix_bug",
    acceptanceCriteria: ["The navigation remains keyboard accessible."],
    plan: {},
    agentRole: "frontend",
    provider: "openai",
    model: "gpt-5.3-codex",
    risk: "yellow",
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

function storeFor(claimed: WorkerJob) {
  return {
    claim: vi.fn().mockResolvedValue(claimed),
    heartbeat: vi.fn().mockResolvedValue({ cancelRequested: false }),
    event: vi.fn().mockResolvedValue(undefined),
    validation: vi.fn().mockResolvedValue(undefined),
    artifact: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  } satisfies WorkerStore;
}

function codexSession() {
  return {
    threadId: null,
    turns: 0,
    usage: { turns: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
    run: vi.fn().mockResolvedValue({
      threadId: "thread-1",
      summary: "Fixed the responsive navigation and added coverage.",
      tests: ["Focused tests passed."],
      risks: [],
      usage: { turns: 1, inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, reasoningOutputTokens: 10 },
    }),
  } satisfies CodexSession;
}

async function preparedWorkspace() {
  const directory = await mkdtemp(path.join(tmpdir(), "softwarefactory-worker-lifecycle-"));
  temporaryPaths.push(directory);
  await mkdir(path.join(directory, "src"));
  await writeFile(path.join(directory, "src", "change.ts"), "export const changed = true;\n");
  return {
    branch: "factory/10000000-0000-4000-8000-000000000001-fix-navigation",
    directory,
    gitDirectory: path.join(directory, "trusted-git"),
    hooksDirectory: path.join(directory, "empty-hooks"),
    runDirectory: directory,
  } satisfies PreparedWorkspace;
}

const passingValidation: readonly ValidationResult[] = [
  { name: "diff-check", command: "git diff --check", status: "passed", durationMs: 1, output: "" },
  { name: "lint", command: "npm run lint", status: "passed", durationMs: 2, output: "" },
  { name: "typecheck", command: "npm run typecheck", status: "passed", durationMs: 3, output: "" },
  { name: "test", command: "npm run test", status: "passed", durationMs: 4, output: "" },
  { name: "build", command: "npm run build", status: "passed", durationMs: 5, output: "" },
];

describe("SoftwareFactoryWorker lifecycle", () => {
  it("persists validation and provider artifacts before completing a passing draft-PR run", async () => {
    const claimed = job();
    const store = storeFor(claimed);
    const workspace = await preparedWorkspace();
    const session = codexSession();
    const assertRemoteBaseSha = vi.fn().mockResolvedValue(undefined);
    const push = vi.fn().mockResolvedValue(undefined);
    const createOrRecoverDraft = vi.fn().mockResolvedValue({
      number: 12,
      url: "https://github.com/example/repository/pull/12",
      headSha: "b".repeat(40),
    });
    const verifyExistingDraft = vi.fn().mockResolvedValue({
      number: 12,
      url: "https://github.com/example/repository/pull/12",
      headSha: "b".repeat(40),
    });
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn().mockResolvedValue({ token: "installation-token", expiresAt: "2026-08-13T19:00:00.000Z" }) },
      workspace: {
        prepare: vi.fn().mockResolvedValue(workspace),
        currentHead: vi.fn().mockResolvedValue("b".repeat(40)),
        changedFiles: vi.fn().mockResolvedValue(["src/change.ts"]),
        commit: vi.fn().mockResolvedValue("b".repeat(40)),
        assertImmutableCommit: vi.fn().mockResolvedValue(undefined),
        assertRemoteBaseSha,
        push,
      },
      codex: { createSession: vi.fn().mockReturnValue(session), initialPrompt: vi.fn().mockReturnValue("Do the work"), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: {
        bootstrap: vi.fn().mockResolvedValue({ name: "dependency-install", command: "npm ci", status: "passed", durationMs: 1, output: "" }),
        run: vi.fn().mockResolvedValue(passingValidation),
      },
      publisher: {
        createOrRecoverDraft,
        verifyExistingDraft,
        waitForChecks: vi.fn().mockResolvedValue({ status: "passed", checks: [{ id: 1, name: "CI", status: "completed", conclusion: "success", url: "https://github.com/example/repository/actions/runs/1" }] }),
      },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(store.validation).toHaveBeenCalledTimes(6);
    expect(store.validation).toHaveBeenNthCalledWith(1, claimed, "worker-1", 0, expect.objectContaining({ name: "dependency-install" }));
    expect(store.validation).toHaveBeenNthCalledWith(2, claimed, "worker-1", 1, expect.objectContaining({ name: "diff-check" }));
    expect(store.artifact.mock.calls.map(([, , artifact]) => artifact.type)).toEqual([
      "branch",
      "commit",
      "pull_request",
    ]);
    expect(store.complete).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      branch: workspace.branch,
      commitSha: "b".repeat(40),
      pullRequestNumber: 12,
      summary: "Fixed the responsive navigation and added coverage.",
    }));
    expect(assertRemoteBaseSha).toHaveBeenCalledTimes(3);
    expect(assertRemoteBaseSha).toHaveBeenNthCalledWith(
      1, workspace, claimed.repository, "installation-token", expect.any(AbortSignal),
    );
    expect(assertRemoteBaseSha.mock.invocationCallOrder[0]!)
      .toBeLessThan(push.mock.invocationCallOrder[0]!);
    expect(assertRemoteBaseSha.mock.invocationCallOrder[1]!)
      .toBeLessThan(createOrRecoverDraft.mock.invocationCallOrder[0]!);
    expect(assertRemoteBaseSha.mock.invocationCallOrder[2]!)
      .toBeLessThan(verifyExistingDraft.mock.invocationCallOrder[0]!);
    expect(verifyExistingDraft.mock.invocationCallOrder[0]!)
      .toBeLessThan(store.complete.mock.invocationCallOrder[0]!);
    expect(store.event).not.toHaveBeenCalledWith(
      claimed,
      "worker-1",
      expect.objectContaining({ kind: "completed" }),
    );
    expect(store.fail).not.toHaveBeenCalled();
  });

  it("fails closed on a stale base immediately before the first provider mutation", async () => {
    const claimed = job();
    const store = storeFor(claimed);
    const workspace = await preparedWorkspace();
    const push = vi.fn();
    const createOrRecoverDraft = vi.fn();
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn().mockResolvedValue({ token: "installation-token", expiresAt: "2026-08-13T19:00:00.000Z" }) },
      workspace: {
        prepare: vi.fn().mockResolvedValue(workspace),
        currentHead: vi.fn().mockResolvedValue("b".repeat(40)),
        changedFiles: vi.fn().mockResolvedValue(["src/change.ts"]),
        commit: vi.fn().mockResolvedValue("b".repeat(40)),
        assertImmutableCommit: vi.fn().mockResolvedValue(undefined),
        assertRemoteBaseSha: vi.fn().mockRejectedValue(new WorkspaceError(
          "stale_base_sha",
          "The repository base branch changed after the run was planned.",
        )),
        push,
      },
      codex: { createSession: vi.fn().mockReturnValue(codexSession()), initialPrompt: vi.fn().mockReturnValue("Do the work"), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: {
        bootstrap: vi.fn().mockResolvedValue({ name: "dependency-install", command: "npm ci", status: "passed", durationMs: 1, output: "" }),
        run: vi.fn().mockResolvedValue(passingValidation),
      },
      publisher: { createOrRecoverDraft, verifyExistingDraft: vi.fn(), waitForChecks: vi.fn() },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(push).not.toHaveBeenCalled();
    expect(createOrRecoverDraft).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      code: "stale_base_sha",
      retryable: false,
    }));
  });

  it("refuses terminal success when the planned base changes after stable CI", async () => {
    const claimed = job();
    const store = storeFor(claimed);
    const workspace = await preparedWorkspace();
    const staleBase = new WorkspaceError(
      "stale_base_sha",
      "The repository base branch changed after the run was planned.",
    );
    const assertRemoteBaseSha = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(staleBase);
    const push = vi.fn().mockResolvedValue(undefined);
    const createOrRecoverDraft = vi.fn().mockResolvedValue({
      number: 12,
      url: "https://github.com/example/repository/pull/12",
      headSha: "b".repeat(40),
    });
    const verifyExistingDraft = vi.fn();
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn().mockResolvedValue({ token: "installation-token", expiresAt: "2026-08-13T19:00:00.000Z" }) },
      workspace: {
        prepare: vi.fn().mockResolvedValue(workspace),
        currentHead: vi.fn().mockResolvedValue("b".repeat(40)),
        changedFiles: vi.fn().mockResolvedValue(["src/change.ts"]),
        commit: vi.fn().mockResolvedValue("b".repeat(40)),
        assertImmutableCommit: vi.fn().mockResolvedValue(undefined),
        assertRemoteBaseSha,
        push,
      },
      codex: { createSession: vi.fn().mockReturnValue(codexSession()), initialPrompt: vi.fn().mockReturnValue("Do the work"), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: {
        bootstrap: vi.fn().mockResolvedValue({ name: "dependency-install", command: "npm ci", status: "passed", durationMs: 1, output: "" }),
        run: vi.fn().mockResolvedValue(passingValidation),
      },
      publisher: {
        createOrRecoverDraft,
        verifyExistingDraft,
        waitForChecks: vi.fn().mockResolvedValue({
          status: "passed",
          checks: [{ id: 1, name: "CI", status: "completed", conclusion: "success", url: null }],
        }),
      },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(push).toHaveBeenCalledOnce();
    expect(createOrRecoverDraft).toHaveBeenCalledOnce();
    expect(assertRemoteBaseSha).toHaveBeenCalledTimes(3);
    expect(verifyExistingDraft).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      code: "stale_base_sha",
      retryable: false,
    }));
  });

  it("retains failing validation evidence even when no pull request is published", async () => {
    const claimed = job({
      budget: {
        maximumDurationMs: 300_000,
        maximumTurns: 3,
        maximumInputTokens: 100_000,
        maximumOutputTokens: 20_000,
        maximumRepairAttempts: 0,
        ciTimeoutMs: 300_000,
      },
    });
    const store = storeFor(claimed);
    const workspace = await preparedWorkspace();
    const failedValidation: readonly ValidationResult[] = [
      passingValidation[0]!,
      { name: "test", command: "npm run test", status: "failed", durationMs: 10, output: "One test failed safely." },
    ];
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn().mockResolvedValue({ token: "installation-token", expiresAt: "2026-08-13T19:00:00.000Z" }) },
      workspace: {
        prepare: vi.fn().mockResolvedValue(workspace),
        currentHead: vi.fn().mockResolvedValue("b".repeat(40)),
        changedFiles: vi.fn(),
        commit: vi.fn(),
        assertImmutableCommit: vi.fn(),
        assertRemoteBaseSha: vi.fn(),
        push: vi.fn(),
      },
      codex: { createSession: vi.fn().mockReturnValue(codexSession()), initialPrompt: vi.fn().mockReturnValue("Do the work"), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: {
        bootstrap: vi.fn().mockResolvedValue({ name: "dependency-install", command: "npm ci", status: "passed", durationMs: 1, output: "" }),
        run: vi.fn().mockResolvedValue(failedValidation),
      },
      publisher: { createOrRecoverDraft: vi.fn(), verifyExistingDraft: vi.fn(), waitForChecks: vi.fn() },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(store.validation).toHaveBeenCalledWith(claimed, "worker-1", 1, failedValidation[1]);
    expect(store.fail).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      code: "worker_failed",
      changedFiles: [],
      checks: [],
      retryable: true,
    }));
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("honors a durable cancellation before creating a workspace", async () => {
    const claimed = job({ cancellationRequested: true });
    const store = storeFor(claimed);
    const prepare = vi.fn();
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn() },
      workspace: { prepare, currentHead: vi.fn(), changedFiles: vi.fn(), commit: vi.fn(), assertImmutableCommit: vi.fn(), assertRemoteBaseSha: vi.fn(), push: vi.fn() },
      codex: { createSession: vi.fn(), initialPrompt: vi.fn(), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: { bootstrap: vi.fn(), run: vi.fn() },
      publisher: { createOrRecoverDraft: vi.fn(), verifyExistingDraft: vi.fn(), waitForChecks: vi.fn() },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(prepare).not.toHaveBeenCalled();
    expect(store.cancel).toHaveBeenCalledOnce();
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("records a local deadline as retryable timeout rather than owner cancellation", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      queueMicrotask(() => { if (typeof callback === "function") callback(); });
      return 1 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
    const claimed = job({ budget: { ...job().budget, maximumDurationMs: 60_000 } });
    const store = storeFor(claimed);
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn() },
      workspace: { prepare: vi.fn(), currentHead: vi.fn(), changedFiles: vi.fn(), commit: vi.fn(), assertImmutableCommit: vi.fn(), assertRemoteBaseSha: vi.fn(), push: vi.fn() },
      codex: { createSession: vi.fn(), initialPrompt: vi.fn(), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: { bootstrap: vi.fn(), run: vi.fn() },
      publisher: { createOrRecoverDraft: vi.fn(), verifyExistingDraft: vi.fn(), waitForChecks: vi.fn() },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(store.fail).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      code: "timed_out",
      retryable: true,
    }));
    expect(store.cancel).not.toHaveBeenCalled();
  });

  it("makes an inconclusive Git push eligible for bounded remote reconciliation", async () => {
    const claimed = job();
    const store = storeFor(claimed);
    const workspace = await preparedWorkspace();
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn().mockResolvedValue({ token: "installation-token", expiresAt: "2026-08-13T19:00:00.000Z" }) },
      workspace: {
        prepare: vi.fn().mockResolvedValue(workspace),
        currentHead: vi.fn().mockResolvedValue("b".repeat(40)),
        changedFiles: vi.fn().mockResolvedValue(["src/change.ts"]),
        commit: vi.fn().mockResolvedValue("b".repeat(40)),
        assertImmutableCommit: vi.fn().mockResolvedValue(undefined),
        assertRemoteBaseSha: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockRejectedValue(new WorkspaceError("git_push_failed", "Push outcome is unknown.")),
      },
      codex: { createSession: vi.fn().mockReturnValue(codexSession()), initialPrompt: vi.fn().mockReturnValue("Do the work"), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: {
        bootstrap: vi.fn().mockResolvedValue({ name: "dependency-install", command: "npm ci", status: "passed", durationMs: 1, output: "" }),
        run: vi.fn().mockResolvedValue(passingValidation),
      },
      publisher: { createOrRecoverDraft: vi.fn(), verifyExistingDraft: vi.fn(), waitForChecks: vi.fn() },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(store.fail).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      code: "git_push_failed",
      retryable: true,
    }));
    expect(store.artifact.mock.calls.map(([, , artifact]) => artifact.type)).toEqual(["branch", "commit"]);
  });

  it("fails RED work closed even when a stale caller supplies approval-shaped data", async () => {
    const claimed = job({
      risk: "red",
      ownerApproval: {
        approvalId: "10000000-0000-4000-8000-000000000010",
        expiresAt: "2030-08-13T18:00:00.000Z",
        approvedPaths: [],
      },
    });
    const store = storeFor(claimed);
    const prepare = vi.fn();
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn() },
      workspace: { prepare, currentHead: vi.fn(), changedFiles: vi.fn(), commit: vi.fn(), assertImmutableCommit: vi.fn(), assertRemoteBaseSha: vi.fn(), push: vi.fn() },
      codex: { createSession: vi.fn(), initialPrompt: vi.fn(), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: { bootstrap: vi.fn(), run: vi.fn() },
      publisher: { createOrRecoverDraft: vi.fn(), verifyExistingDraft: vi.fn(), waitForChecks: vi.fn() },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(prepare).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      code: "red_not_executable",
      retryable: false,
    }));
  });

  it("resumes exact draft-PR evidence without rerunning Codex or creating another commit", async () => {
    const workspace = await preparedWorkspace();
    const recovery = {
      branch: workspace.branch,
      commitSha: "b".repeat(40),
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.com/example/repository/pull/12",
      providerRunReference: "thread-1",
      usage: { turns: 1, inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, reasoningOutputTokens: 10 },
    } as const;
    const claimed = job({ attempt: 2, recovery });
    const store = storeFor(claimed);
    const createSession = vi.fn();
    const commit = vi.fn();
    const push = vi.fn();
    const assertRemoteBaseSha = vi.fn().mockResolvedValue(undefined);
    const createOrRecoverDraft = vi.fn();
    const verifyExistingDraft = vi.fn().mockResolvedValue({
      number: 12,
      url: recovery.pullRequestUrl,
      headSha: recovery.commitSha,
    });
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn().mockResolvedValue({ token: "installation-token", expiresAt: "2026-08-13T19:00:00.000Z" }) },
      workspace: {
        prepare: vi.fn().mockResolvedValue(workspace),
        currentHead: vi.fn().mockResolvedValue(recovery.commitSha),
        changedFiles: vi.fn().mockResolvedValue(["src/change.ts"]),
        commit,
        assertImmutableCommit: vi.fn().mockResolvedValue(undefined),
        assertRemoteBaseSha,
        push,
      },
      codex: { createSession, initialPrompt: vi.fn(), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: { bootstrap: vi.fn(), run: vi.fn() },
      publisher: {
        createOrRecoverDraft,
        verifyExistingDraft,
        waitForChecks: vi.fn().mockResolvedValue({
          status: "passed",
          checks: [{ id: 1, name: "CI", status: "completed", conclusion: "success", url: null }],
        }),
      },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(verifyExistingDraft).toHaveBeenCalledWith(
      claimed, 12, recovery.pullRequestUrl, recovery.commitSha, "installation-token", expect.any(AbortSignal),
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(createOrRecoverDraft).not.toHaveBeenCalled();
    expect(assertRemoteBaseSha).toHaveBeenCalledTimes(2);
    expect(verifyExistingDraft).toHaveBeenCalledTimes(2);
    expect(assertRemoteBaseSha.mock.invocationCallOrder[0]!)
      .toBeLessThan(verifyExistingDraft.mock.invocationCallOrder[0]!);
    expect(assertRemoteBaseSha.mock.invocationCallOrder[1]!)
      .toBeLessThan(verifyExistingDraft.mock.invocationCallOrder[1]!);
    expect(verifyExistingDraft.mock.invocationCallOrder[1]!)
      .toBeLessThan(store.complete.mock.invocationCallOrder[0]!);
    expect(store.complete).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      commitSha: recovery.commitSha,
      pullRequestNumber: 12,
      threadId: "thread-1",
    }));
  });

  it("records an immutable PR-head transition and completes after a bounded CI repair", async () => {
    const claimed = job();
    const store = storeFor(claimed);
    const workspace = await preparedWorkspace();
    const firstSha = "b".repeat(40);
    const repairedSha = "c".repeat(40);
    const session = codexSession();
    const createOrRecoverDraft = vi.fn()
      .mockResolvedValueOnce({ number: 12, url: "https://github.com/example/repository/pull/12", headSha: firstSha })
      .mockResolvedValueOnce({ number: 12, url: "https://github.com/example/repository/pull/12", headSha: repairedSha });
    const waitForChecks = vi.fn()
      .mockResolvedValueOnce({
        status: "failed",
        checks: [{ id: 1, name: "CI", status: "completed", conclusion: "failure", url: null }],
      })
      .mockResolvedValueOnce({
        status: "passed",
        checks: [{ id: 2, name: "CI", status: "completed", conclusion: "success", url: null }],
      });
    const worker = new SoftwareFactoryWorker("worker-1", 60_000, {
      store,
      tokenProvider: { createToken: vi.fn().mockResolvedValue({ token: "installation-token", expiresAt: "2026-08-13T19:00:00.000Z" }) },
      workspace: {
        prepare: vi.fn().mockResolvedValue(workspace),
        currentHead: vi.fn().mockResolvedValue(firstSha),
        changedFiles: vi.fn().mockResolvedValue(["src/change.ts"]),
        commit: vi.fn().mockResolvedValueOnce(firstSha).mockResolvedValueOnce(repairedSha),
        assertImmutableCommit: vi.fn().mockResolvedValue(undefined),
        assertRemoteBaseSha: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      },
      codex: { createSession: vi.fn().mockReturnValue(session), initialPrompt: vi.fn().mockReturnValue("Do the work"), prepare: vi.fn().mockResolvedValue(undefined) },
      validator: {
        bootstrap: vi.fn().mockResolvedValue({ name: "dependency-install", command: "npm ci", status: "passed", durationMs: 1, output: "" }),
        run: vi.fn().mockResolvedValue(passingValidation),
      },
      publisher: { createOrRecoverDraft, verifyExistingDraft: vi.fn(), waitForChecks },
    });

    await expect(worker.runOnce()).resolves.toBe("processed");

    expect(store.artifact.mock.calls.map(([, , artifact]) => artifact.type)).toEqual([
      "branch", "commit", "pull_request", "commit", "pull_request_head",
    ]);
    expect(store.complete).toHaveBeenCalledWith(claimed, "worker-1", expect.objectContaining({
      commitSha: repairedSha,
      pullRequestNumber: 12,
    }));
    expect(store.fail).not.toHaveBeenCalled();
  });
});
