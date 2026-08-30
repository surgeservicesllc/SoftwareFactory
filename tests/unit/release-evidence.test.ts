// @vitest-environment node

import { describe, expect, it } from "vitest";

import { deriveReleaseEvidence } from "@/lib/factory/release-evidence";

/**
 * The Changes & release panel derives from the ANCHOR nodes' recorded
 * observations — the exact payload shapes lib/worker/anchor-node-executor.ts
 * writes. Nothing is invented: every section is null until its observation
 * exists, and a failing check keeps its real conclusion.
 */

const lineage = {
  observation: "phase1c_change_lineage",
  repository: "factory/storefront",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  pullRequestNumber: 41,
  pullRequestUrl: "https://github.com/factory/storefront/pull/41",
  bridgeState: "PULL_REQUEST_RECORDED",
  observedAt: "2026-08-30T05:00:00.000Z",
};

const ciChecks = {
  observation: "ci_check_runs",
  sha: "b".repeat(40),
  repository: "factory/storefront",
  total: 2,
  checks: [
    { name: "Lint, typecheck, test, and build", conclusion: "success", url: "https://github.com/x/1" },
  ],
  failing: [
    { name: "Browser and accessibility tests 1/3", conclusion: "failure", url: "https://github.com/x/2" },
  ],
  observedAt: "2026-08-30T05:05:00.000Z",
};

const deployment = {
  observation: "github_production_deployment",
  repository: "factory/storefront",
  sha: "c".repeat(40),
  ref: "main",
  environment: "Production",
  state: "success",
  environmentUrl: "https://storefront.example.test",
  observedAt: "2026-08-30T05:10:00.000Z",
};

const probe = {
  observation: "production_http_probe",
  deploymentId: "00000000-0000-4000-8000-000000000001",
  url: "https://storefront.example.test",
  status: 200,
  healthy: true,
  postDeployValidation: "pass",
  observedAt: "2026-08-30T05:12:00.000Z",
};

describe("deriveReleaseEvidence", () => {
  it("answers all-null before any observation exists — no invented release", () => {
    const evidence = deriveReleaseEvidence([
      { payload: { findings: ["a model artifact, not an observation"] } },
      { payload: "not an object" },
    ]);
    expect(evidence).toEqual({
      pullRequest: null,
      producedCommit: null,
      baseBranch: null,
      checks: null,
      deployment: null,
      health: null,
    });
  });

  it("reads the pull request, produced commit and base from the recorded lineage", () => {
    const evidence = deriveReleaseEvidence([{ payload: lineage }]);
    expect(evidence.pullRequest).toEqual({
      url: "https://github.com/factory/storefront/pull/41",
      number: 41,
      repository: "factory/storefront",
    });
    expect(evidence.producedCommit).toBe("b".repeat(40));
    expect(evidence.baseBranch).toBe("main");
    expect(evidence.checks).toBeNull();
  });

  it("keeps every check's real conclusion — a failure is never smoothed over", () => {
    const evidence = deriveReleaseEvidence([{ payload: ciChecks }]);
    expect(evidence.checks).toEqual([
      { name: "Lint, typecheck, test, and build", conclusion: "success", url: "https://github.com/x/1" },
      { name: "Browser and accessibility tests 1/3", conclusion: "failure", url: "https://github.com/x/2" },
    ]);
  });

  it("composes the full release trail from all four observations", () => {
    const evidence = deriveReleaseEvidence([
      { payload: lineage },
      { payload: ciChecks },
      { payload: deployment },
      { payload: probe },
    ]);
    expect(evidence.pullRequest?.number).toBe(41);
    expect(evidence.deployment).toEqual({
      environment: "Production",
      state: "success",
      url: "https://storefront.example.test",
    });
    expect(evidence.health).toEqual({
      url: "https://storefront.example.test",
      healthy: true,
      postDeployValidation: "pass",
    });
  });
});
