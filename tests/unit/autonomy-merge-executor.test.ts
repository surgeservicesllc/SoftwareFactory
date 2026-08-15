// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EligibilityResult } from "@/lib/autonomy/merge-eligibility";
import type { MergeReadinessResult } from "@/lib/autonomy/merge-readiness";

/**
 * The merge executor is the last place that can say no, so these tests are
 * about refusals rather than about merging.
 *
 * The `githubApiRequest` module is mocked because the assertions are about what
 * this code *sends* — the `sha` guard, the merge method, the absence of any
 * protection-bypass parameter — and about how it reads GitHub's answers back.
 */

vi.mock("server-only", () => ({}));

const githubApiRequest = vi.fn();

vi.mock("@/lib/github/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/client")>(
    "@/lib/github/client",
  );
  return { ...actual, githubApiRequest };
});

const { executeApprovedMerge, isMergeExecutorConnected } = await import(
  "@/lib/autonomy/merge-executor"
);
const { GitHubApiError } = await import("@/lib/github/client");

const headSha = "a".repeat(40);

const ready: MergeReadinessResult = Object.freeze({
  ready: true, blockers: [], reason: "ok", evaluatedHeadSha: headSha,
});

const eligible: EligibilityResult = Object.freeze({
  eligible: true, blockers: [], reason: "ok",
  repositoryFullName: "surgeservicesllc/SoftwareFactory",
  baseBranch: "main", headBranch: "factory/docs-canary",
  changedFiles: 1, changedLines: 4,
});

function baseRequest(overrides = {}) {
  return {
    token: "ghs_installation_token",
    owner: "surgeservicesllc",
    repository: "SoftwareFactory",
    pullRequestNumber: 42,
    headSha,
    baseBranch: "main",
    headBranch: "factory/docs-canary",
    commitTitle: "Canary: docs change",
    readiness: ready,
    eligibility: eligible,
    ...overrides,
  };
}

beforeEach(() => {
  githubApiRequest.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("what it refuses without ever calling GitHub", () => {
  it("refuses when readiness said no", async () => {
    const result = await executeApprovedMerge(baseRequest({
      readiness: { ...ready, ready: false, blockers: ["NOT_APPROVED"], reason: "not approved" },
    }));

    expect(result.outcome).toBe("refused_not_ready");
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("refuses when eligibility said no", async () => {
    const result = await executeApprovedMerge(baseRequest({
      eligibility: {
        ...eligible, eligible: false,
        blockers: ["REPOSITORY_NOT_ALLOWLISTED"], reason: "not allowlisted",
      },
    }));

    expect(result.outcome).toBe("refused_not_eligible");
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("refuses when readiness describes a different commit", async () => {
    // The approval that produced this readiness is about other code.
    const result = await executeApprovedMerge(baseRequest({
      readiness: { ...ready, evaluatedHeadSha: "b".repeat(40) },
    }));

    expect(result.outcome).toBe("refused_head_moved");
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("refuses without a token, and reports connectivity honestly", async () => {
    const result = await executeApprovedMerge(baseRequest({ token: "  " }));

    expect(result.outcome).toBe("executor_not_connected");
    expect(githubApiRequest).not.toHaveBeenCalled();
    expect(isMergeExecutorConnected(null)).toBe(false);
    expect(isMergeExecutorConnected("")).toBe(false);
    expect(isMergeExecutorConnected("ghs_x")).toBe(true);
  });
});

describe("what it sends", () => {
  it("pins the head SHA so GitHub closes the race server-side", async () => {
    githubApiRequest.mockResolvedValue({ merged: true, sha: "c".repeat(40) });

    await executeApprovedMerge(baseRequest());

    const [path, options] = githubApiRequest.mock.calls[0];
    expect(path).toBe("/repos/surgeservicesllc/SoftwareFactory/pulls/42/merge");
    expect(options.method).toBe("PUT");
    // Without this, readiness and the merge describe two different moments.
    expect(options.body.sha).toBe(headSha);
    expect(options.body.merge_method).toBe("squash");
  });

  it("sends nothing that could bypass branch protection", async () => {
    githubApiRequest.mockResolvedValue({ merged: true, sha: "c".repeat(40) });

    await executeApprovedMerge(baseRequest());

    const body = githubApiRequest.mock.calls[0][1].body as Record<string, unknown>;
    // An admin-enforcement escape or a protection override would defeat the
    // entire policy, so the body is asserted to be exactly these three keys.
    expect(Object.keys(body).sort()).toEqual(["commit_title", "merge_method", "sha"]);
  });
});

describe("how it reads GitHub's answers", () => {
  it("returns the merge SHA on success", async () => {
    const mergeSha = "c".repeat(40);
    githubApiRequest.mockResolvedValue({ merged: true, sha: mergeSha });

    const result = await executeApprovedMerge(baseRequest());

    expect(result).toMatchObject({
      outcome: "merged",
      mergeCommitSha: mergeSha,
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
      pullRequestNumber: 42,
    });
  });

  it("treats 409 as the head having moved", async () => {
    githubApiRequest.mockRejectedValue(new GitHubApiError(409, "conflict", "head changed"));

    const result = await executeApprovedMerge(baseRequest());

    expect(result.outcome).toBe("refused_head_moved");
    expect(result.mergeCommitSha).toBeNull();
  });

  it("treats 405 as branch protection refusing, and does not retry", async () => {
    githubApiRequest.mockRejectedValue(new GitHubApiError(405, "not_mergeable", "blocked"));

    const result = await executeApprovedMerge(baseRequest());

    expect(result.outcome).toBe("refused_by_branch_protection");
    // A retry would have to recompute eligibility; silently trying again here
    // is how a protection rule gets worn down.
    expect(githubApiRequest).toHaveBeenCalledTimes(1);
  });

  it("treats 422 as not mergeable", async () => {
    githubApiRequest.mockRejectedValue(new GitHubApiError(422, "unprocessable", "nope"));

    expect((await executeApprovedMerge(baseRequest())).outcome).toBe("refused_not_mergeable");
  });

  it("does not report success when GitHub says merged without a SHA", async () => {
    // A response that claims success but names no commit is not evidence a
    // merge happened, and the audit record would have nothing to point at.
    githubApiRequest.mockResolvedValue({ merged: true, sha: null });

    const result = await executeApprovedMerge(baseRequest());

    expect(result.outcome).toBe("failed");
    expect(result.mergeCommitSha).toBeNull();
  });

  it("does not report success when GitHub says merged is false", async () => {
    githubApiRequest.mockResolvedValue({ merged: false, sha: "c".repeat(40) });

    expect((await executeApprovedMerge(baseRequest())).outcome).toBe("failed");
  });

  it("never leaks the token or the raw error", async () => {
    githubApiRequest.mockRejectedValue(new Error("connect failed to https://x?token=ghs_secret"));

    const result = await executeApprovedMerge(baseRequest());

    expect(result.outcome).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("ghs_secret");
    expect(JSON.stringify(result)).not.toContain("ghs_installation_token");
  });

  it("refuses an invalid head SHA before calling anything", async () => {
    const result = await executeApprovedMerge(baseRequest({ headSha: "not-a-sha" }));

    expect(result.outcome).toBe("failed");
    expect(githubApiRequest).not.toHaveBeenCalled();
  });
});
