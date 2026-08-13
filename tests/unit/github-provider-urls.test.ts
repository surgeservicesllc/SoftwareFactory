// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listGitHubInstallationRepositories } from "@/lib/github/client";
import {
  createGitHubDraftPullRequest,
  getGitHubFile,
  listGitHubCheckRuns,
  listGitHubCommits,
  listGitHubPullRequests,
  listGitHubTree,
  updateGitHubFileOnBranch,
} from "@/lib/github/repository";
import { githubWebUrlSchema } from "@/lib/github/schemas";

const sha = "a".repeat(40);
const now = "2026-08-12T20:00:00.000Z";

function response(body: unknown) {
  return Response.json(body);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GitHub provider web URLs", () => {
  it.each([
    "http://github.com/example/repository",
    "https://github.example/example/repository",
    "https://github.com.evil.example/example/repository",
    "https://user:password@github.com/example/repository",
  ])("rejects a non-GitHub or credential-bearing web URL: %s", (url) => {
    expect(githubWebUrlSchema.safeParse(url).success).toBe(false);
  });

  it("accepts only the canonical HTTPS GitHub web origin", () => {
    expect(githubWebUrlSchema.parse("https://github.com/example/repository"))
      .toBe("https://github.com/example/repository");
  });

  it("loads bounded per-pull details so mergeability is real provider data", async () => {
    const listedPullRequest = {
      base: { ref: "main" },
      created_at: now,
      draft: false,
      head: { ref: "feature", sha },
      html_url: "https://github.com/example/repository/pull/1",
      id: 1,
      number: 1,
      state: "open",
      title: "Change",
      updated_at: now,
      user: null,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([listedPullRequest]))
      .mockResolvedValueOnce(response({
        ...listedPullRequest,
        mergeable: true,
        mergeable_state: "clean",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGitHubPullRequests("token", "example", "repository", { includeMergeability: true }))
      .resolves.toEqual([expect.objectContaining({
        mergeability: "mergeable",
        mergeableState: "clean",
      })]);
    expect(String(fetchMock.mock.calls[1]?.[0]))
      .toBe("https://api.github.com/repos/example/repository/pulls/1");
  });

  it("keeps list data with unknown mergeability when a detail lookup fails", async () => {
    const listedPullRequest = {
      base: { ref: "main" }, created_at: now, draft: false,
      head: { ref: "feature", sha },
      html_url: "https://github.com/example/repository/pull/1",
      id: 1, number: 1, state: "open", title: "Change", updated_at: now, user: null,
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response([listedPullRequest]))
      .mockResolvedValueOnce(Response.json({ message: "temporary" }, { status: 503 })));

    await expect(listGitHubPullRequests("token", "example", "repository", { includeMergeability: true }))
      .resolves.toEqual([expect.objectContaining({ mergeability: "unknown", number: 1 })]);
  });

  it("rejects an unsafe repository URL from installation synchronization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      repositories: [{
        archived: false,
        default_branch: "main",
        disabled: false,
        full_name: "example/repository",
        html_url: "https://evil.example/example/repository",
        id: 101,
        name: "repository",
        owner: { login: "example" },
        permissions: { pull: true },
        private: false,
        pushed_at: now,
        updated_at: now,
        visibility: "public",
      }],
      total_count: 1,
    })));

    await expect(listGitHubInstallationRepositories("installation-token"))
      .rejects.toMatchObject({ code: "github_repositories_invalid", status: 502 });
  });

  it.each([
    {
      invoke: () => listGitHubPullRequests("token", "example", "repository"),
      payload: [{
        base: { ref: "main" },
        created_at: now,
        draft: true,
        head: { ref: "feature", sha },
        html_url: "https://evil.example/pull/1",
        id: 1,
        number: 1,
        state: "open",
        title: "Change",
        updated_at: now,
        user: null,
      }],
      subject: "pull request",
    },
    {
      invoke: () => listGitHubCommits("token", "example", "repository", "main"),
      payload: [{
        author: null,
        commit: { author: { date: now, email: null, name: "Factory" }, message: "Change" },
        html_url: "https://evil.example/commit/a",
        sha,
      }],
      subject: "commit",
    },
    {
      invoke: () => listGitHubCheckRuns("token", "example", "repository", "main"),
      payload: { check_runs: [{
        completed_at: now,
        conclusion: "success",
        html_url: "https://evil.example/check/1",
        id: 1,
        name: "quality",
        started_at: now,
        status: "completed",
      }] },
      subject: "check",
    },
    {
      invoke: () => listGitHubTree("token", "example", "repository", "main"),
      payload: [{
        html_url: "https://evil.example/blob/main/README.md",
        name: "README.md",
        path: "README.md",
        sha,
        size: 1,
        type: "file",
      }],
      subject: "tree file",
    },
  ])("rejects an unsafe $subject URL from GitHub", async ({ invoke, payload }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(payload)));

    await expect(invoke()).rejects.toMatchObject({
      code: "github_invalid_response",
      status: 502,
    });
  });

  it("rejects an unsafe editable-file URL and accepts null where GitHub permits it", async () => {
    const file = (htmlUrl: string | null) => ({
      content: Buffer.from("x", "utf8").toString("base64"),
      encoding: "base64",
      html_url: htmlUrl,
      name: "README.md",
      path: "README.md",
      sha,
      size: 1,
      type: "file",
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(file("https://evil.example/blob/main/README.md")))
      .mockResolvedValueOnce(response(file(null))));

    await expect(getGitHubFile("token", "example", "repository", "main", "README.md"))
      .rejects.toMatchObject({ code: "github_invalid_response", status: 502 });
    await expect(getGitHubFile("token", "example", "repository", "main", "README.md"))
      .resolves.toMatchObject({ url: null });
  });

  it("accepts nullable check and tree URLs", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ check_runs: [{
        completed_at: null,
        conclusion: null,
        html_url: null,
        id: 1,
        name: "quality",
        started_at: null,
        status: "queued",
      }] }))
      .mockResolvedValueOnce(response([{
        html_url: null,
        name: "README.md",
        path: "README.md",
        sha,
        size: 1,
        type: "file",
      }])));

    await expect(listGitHubCheckRuns("token", "example", "repository", "main"))
      .resolves.toEqual([expect.objectContaining({ url: null })]);
    await expect(listGitHubTree("token", "example", "repository", "main"))
      .resolves.toEqual([expect.objectContaining({ url: null })]);
  });

  it("rejects unsafe commit and draft-PR URLs from write responses", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({
        commit: { html_url: "https://evil.example/commit/a", sha },
        content: { html_url: "https://github.com/example/repository/blob/feature/README.md" },
      }))
      .mockResolvedValueOnce(response({
        draft: true,
        html_url: "https://evil.example/pull/1",
        id: 1,
        number: 1,
        state: "open",
        title: "Change",
      })));

    await expect(updateGitHubFileOnBranch("token", {
      branch: "feature",
      content: "change",
      expectedBlobSha: sha,
      message: "Change",
      owner: "example",
      path: "README.md",
      repository: "repository",
    })).rejects.toMatchObject({ code: "github_invalid_response", status: 502 });

    await expect(createGitHubDraftPullRequest("token", {
      baseBranch: "main",
      body: "Body",
      headBranch: "feature",
      owner: "example",
      repository: "repository",
      title: "Change",
    })).rejects.toMatchObject({ code: "github_invalid_response", status: 502 });
  });
});
