import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubAppInstallationTokenProvider, GitHubDraftPublisher, GitHubWorkerError } from "@/lib/worker/github";
import { workerJobSchema, type WorkerJob } from "@/lib/worker/types";

function job(): WorkerJob {
  return workerJobSchema.parse({
    runId: "10000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000002",
    projectId: "10000000-0000-4000-8000-000000000003",
    commandId: "10000000-0000-4000-8000-000000000004",
    taskId: "10000000-0000-4000-8000-000000000005",
    agentId: "10000000-0000-4000-8000-000000000006",
    connectionId: "10000000-0000-4000-8000-000000000007",
    repositoryDatabaseId: "10000000-0000-4000-8000-000000000008",
    prompt: "Fix the navigation",
    commandType: "fix_bug",
    acceptanceCriteria: [],
    plan: {},
    agentRole: "frontend",
    provider: "openai",
    model: "gpt-5.3-codex",
    risk: "yellow",
    repository: {
      appId: 1,
      installationId: 2,
      repositoryId: 3,
      owner: "example",
      name: "application",
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
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubDraftPublisher", () => {
  it("creates only a draft PR on the exact planned base branch", async () => {
    const commitSha = "b".repeat(40);
    const request = vi.fn().mockResolvedValue({
      number: 12,
      html_url: "https://github.com/example/application/pull/12",
      state: "open",
      draft: true,
      head: { sha: commitSha },
      base: { ref: "main", sha: "a".repeat(40) },
    });
    const publisher = new GitHubDraftPublisher(request);

    await expect(publisher.createOrRecoverDraft(job(), "factory/run-fix", commitSha, "token"))
      .resolves.toEqual({
        number: 12,
        url: "https://github.com/example/application/pull/12",
        headSha: commitSha,
      });

    expect(request).toHaveBeenCalledWith("/repos/example/application/pulls", expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        base: "main",
        head: "factory/run-fix",
        draft: true,
        maintainer_can_modify: false,
      }),
    }));
  });

  it("recovers the exact already-created draft after an ambiguous provider failure", async () => {
    const commitSha = "b".repeat(40);
    const request = vi.fn()
      .mockRejectedValueOnce(new GitHubWorkerError("github_unavailable", "ambiguous"))
      .mockResolvedValueOnce([{
        number: 12,
        html_url: "https://github.com/example/application/pull/12",
        state: "open",
        draft: true,
        head: { sha: commitSha },
        base: { ref: "main", sha: "a".repeat(40) },
      }]);
    const publisher = new GitHubDraftPublisher(request);

    await expect(publisher.createOrRecoverDraft(job(), "factory/run-fix", commitSha, "token"))
      .resolves.toMatchObject({ number: 12, headSha: commitSha });
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[1]?.[0])).toContain("state=open&head=example%3Afactory%2Frun-fix&base=main");
  });

  it("revalidates every immutable field of an existing recovery draft", async () => {
    const commitSha = "b".repeat(40);
    const request = vi.fn().mockResolvedValue({
      number: 12,
      html_url: "https://github.com/example/application/pull/12",
      state: "open",
      draft: true,
      head: { sha: commitSha },
      base: { ref: "main", sha: "a".repeat(40) },
    });
    const publisher = new GitHubDraftPublisher(request);

    await expect(publisher.verifyExistingDraft(
      job(), 12, "https://github.com/example/application/pull/12", commitSha, "token",
    )).resolves.toMatchObject({ number: 12, headSha: commitSha });
    await expect(publisher.verifyExistingDraft(
      job(), 12, "https://github.com/example/application/pull/99", commitSha, "token",
    )).rejects.toMatchObject({ code: "github_pr_changed" });
  });

  it("rejects an open draft whose provider base SHA is no longer the planned base", async () => {
    const commitSha = "b".repeat(40);
    const request = vi.fn().mockResolvedValue({
      number: 12,
      html_url: "https://github.com/example/application/pull/12",
      state: "open",
      draft: true,
      head: { sha: commitSha },
      base: { ref: "main", sha: "c".repeat(40) },
    });
    const publisher = new GitHubDraftPublisher(request);

    await expect(publisher.verifyExistingDraft(
      job(), 12, "https://github.com/example/application/pull/12", commitSha, "token",
    )).rejects.toMatchObject({ code: "github_pr_changed" });
  });

  it("requires at least one completed passing check before reporting CI success", async () => {
    const passingChecks = {
      total_count: 1,
      check_runs: [{
        id: 1,
        name: "CI",
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/example/application/actions/runs/1",
      }],
    };
    const request = vi.fn()
      .mockResolvedValueOnce({ total_count: 0, check_runs: [] })
      .mockResolvedValueOnce(passingChecks)
      .mockResolvedValueOnce(passingChecks)
      .mockResolvedValueOnce({
        number: 12,
        html_url: "https://github.com/example/application/pull/12",
        state: "open",
        draft: true,
        head: { sha: "b".repeat(40) },
        base: { ref: "main", sha: "a".repeat(40) },
      });
    let now = 0;
    const publisher = new GitHubDraftPublisher(
      request,
      vi.fn(async (milliseconds: number) => { now += milliseconds; }),
      () => now,
    );

    await expect(publisher.waitForChecks(job(), 12, "b".repeat(40), "token", 30_000))
      .resolves.toMatchObject({ status: "passed", checks: [expect.objectContaining({ conclusion: "success" })] });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("reports a completed failing check without weakening the conclusion", async () => {
    const request = vi.fn().mockResolvedValue({
      total_count: 1,
      check_runs: [{
        id: 1,
        name: "CI",
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/example/application/actions/runs/1",
      }],
    });
    const publisher = new GitHubDraftPublisher(request);

    await expect(publisher.waitForChecks(job(), 12, "b".repeat(40), "token", 30_000))
      .resolves.toMatchObject({ status: "failed", checks: [expect.objectContaining({ conclusion: "failure" })] });
  });

  it("fails closed when GitHub indicates more checks than the bounded page contains", async () => {
    const request = vi.fn().mockResolvedValue({
      total_count: 101,
      check_runs: [],
    });
    const publisher = new GitHubDraftPublisher(request);

    await expect(publisher.waitForChecks(job(), 12, "b".repeat(40), "token", 30_000))
      .rejects.toMatchObject({ code: "github_checks_invalid" });
  });

  it("waits for a stable check set and revalidates the exact open draft PR head", async () => {
    const first = { total_count: 1, check_runs: [{ id: 1, name: "lint", status: "completed", conclusion: "success" }] };
    const final = { total_count: 2, check_runs: [
      { id: 1, name: "lint", status: "completed", conclusion: "success" },
      { id: 2, name: "test", status: "completed", conclusion: "success" },
    ] };
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(final)
      .mockResolvedValueOnce(final)
      .mockResolvedValueOnce({
        number: 12,
        html_url: "https://github.com/example/application/pull/12",
        state: "open",
        draft: true,
        head: { sha: "c".repeat(40) },
        base: { ref: "main", sha: "a".repeat(40) },
      });
    let now = 0;
    const publisher = new GitHubDraftPublisher(
      request,
      vi.fn(async (milliseconds: number) => { now += milliseconds; }),
      () => now,
    );

    await expect(publisher.waitForChecks(job(), 12, "b".repeat(40), "token", 40_000))
      .rejects.toMatchObject({ code: "github_pr_changed" });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("cancels an oversized provider response before parsing or persisting it", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const environment = {
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([123, 125]));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      headers: { "content-length": String(9 * 1024 * 1024) },
      status: 200,
    })));

    await expect(new GitHubAppInstallationTokenProvider(environment).createToken(job()))
      .rejects.toMatchObject({ code: "github_response_too_large" });
  });
});
