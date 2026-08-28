import { describe, expect, it } from "vitest";

import {
  approvedArchitecturePrompt,
  mergedPullRequestMismatch,
  productionDeploymentMismatch,
} from "@/lib/graph/phase1c-gate-bridge";

const headSha = "a".repeat(40);
const mergeSha = "b".repeat(40);
const merged = {
  baseBranch: "main",
  headBranch: "factory/change",
  headSha,
  merged: true,
  mergedAt: "2026-08-27T12:00:00.000Z",
  mergeCommitSha: mergeSha,
  number: 42,
  state: "closed" as const,
  url: "https://github.com/owner/repository/pull/42",
};
const expected = {
  baseBranch: "main",
  headBranch: "factory/change",
  headSha,
  number: 42,
};
const production = {
  completedAt: "2026-08-27T12:05:00.000Z",
  creatorLogin: "vercel[bot]",
  deploymentId: 6130925898,
  environment: "Production",
  environmentUrl: "https://softwarefactory-exact.vercel.app",
  productionEnvironment: true,
  ref: "main",
  sha: mergeSha,
  startedAt: "2026-08-27T12:00:00.000Z",
  status: "success",
  statusCreatorLogin: "vercel[bot]",
  task: "deploy",
};
const deploymentAnchor = {
  deploymentId: 6130925898,
  environment: "Production" as const,
  environmentUrl: "https://softwarefactory-exact.vercel.app",
  observation: "github_production_deployment" as const,
  observedAt: "2026-08-27T12:05:01.000Z",
  ref: "main",
  repository: "owner/repository",
  sha: mergeSha,
  state: "success" as const,
};

describe("Full Lifecycle Phase 1C gate bridge", () => {
  it("keeps the real goal and architecture context inside the command bound", () => {
    const prompt = approvedArchitecturePrompt("G".repeat(4_000), { answer: "A".repeat(8_000) });
    expect(prompt.length).toBeLessThanOrEqual(4_000);
    expect(prompt).toContain("Goal:");
    expect(prompt).toContain("Approved architecture:");
    expect(prompt).toContain("[architecture payload truncated]");
    expect(prompt).toContain("do not merge or deploy");
  });

  it("accepts only complete exact merged GitHub identity", () => {
    expect(mergedPullRequestMismatch(merged, expected)).toBeNull();
    expect(mergedPullRequestMismatch({ ...merged, merged: false }, expected)).toContain("not been merged");
    expect(mergedPullRequestMismatch({ ...merged, headSha: "c".repeat(40) }, expected)).toContain("head commit");
    expect(mergedPullRequestMismatch({ ...merged, baseBranch: "develop" }, expected)).toContain("base branch");
    expect(mergedPullRequestMismatch({ ...merged, mergeCommitSha: null }, expected)).toContain("complete merge identity");
  });

  it("accepts only exact successful Vercel Production evidence", () => {
    expect(productionDeploymentMismatch(production, deploymentAnchor)).toBeNull();
    expect(productionDeploymentMismatch({ ...production, sha: headSha }, deploymentAnchor))
      .toContain("merged lifecycle commit");
    expect(productionDeploymentMismatch({ ...production, productionEnvironment: false }, deploymentAnchor))
      .toContain("not a Production deployment");
    expect(productionDeploymentMismatch({ ...production, status: "pending" }, deploymentAnchor))
      .toContain("successful status");
    expect(productionDeploymentMismatch({
      ...production,
      environmentUrl: "https://different.vercel.app",
    }, deploymentAnchor)).toContain("does not match");
  });

  it("normalizes only scheme, host, and the default port when comparing deployment URLs", () => {
    const expectedWithPath = {
      ...deploymentAnchor,
      environmentUrl: "HTTPS://SoftwareFactory-Exact.VERCEL.APP:443/Releases/Exact",
    };
    expect(productionDeploymentMismatch({
      ...production,
      environmentUrl: "https://softwarefactory-exact.vercel.app/Releases/Exact",
    }, expectedWithPath)).toBeNull();
    expect(productionDeploymentMismatch({
      ...production,
      environmentUrl: "https://softwarefactory-exact.vercel.app/releases/Exact",
    }, expectedWithPath)).toContain("does not match");
  });

  it.each([
    "https://owner:password@softwarefactory-exact.vercel.app",
    "https://softwarefactory-exact.vercel.app/?token=value",
    "https://softwarefactory-exact.vercel.app/#release",
    `https://softwarefactory-exact.vercel.app/sk-${"a".repeat(32)}`,
  ])("refuses unsafe live deployment evidence: %s", (environmentUrl) => {
    expect(productionDeploymentMismatch({ ...production, environmentUrl }, deploymentAnchor))
      .toContain("does not match");
  });
});
