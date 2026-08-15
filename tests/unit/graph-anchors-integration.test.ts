// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  anchorFromCheckRun,
  anchorFromValidation,
  anchorIsFresh,
  checkClaimAnchored,
  checkClaimAnchoredFresh,
  type Anchor,
} from "@/lib/graph/anchors";
import { findWriteConflicts, integrateBranches, type BranchResult } from "@/lib/graph/integration";

function anchor(overrides: Partial<Anchor> = {}): Anchor {
  return {
    kind: "test_run",
    source: "vitest in node:22",
    observedAt: "2026-08-14T12:00:00.000Z",
    passed: true,
    reference: null,
    detail: "tests passed",
    ...overrides,
  };
}

describe("anchors", () => {
  it("refuses a claim with no evidence attached", () => {
    // The whole point: an agent saying tests pass is a hypothesis.
    const result = checkClaimAnchored("TESTS_PASS", []);

    expect(result.anchored).toBe(false);
    expect(result.reason).toContain("assertion rather than an observation");
  });

  it("accepts a claim backed by a passing observation", () => {
    const result = checkClaimAnchored("TESTS_PASS", [anchor()]);

    expect(result.anchored).toBe(true);
    expect(result.supporting).toHaveLength(1);
  });

  it("treats contradicting evidence as refutation, not support", () => {
    // "We ran the tests" must never become "the tests pass".
    const result = checkClaimAnchored("TESTS_PASS", [anchor({ passed: false })]);

    expect(result.anchored).toBe(false);
    expect(result.reason).toContain("contradicts the claim");
  });

  it("refuses evidence of the wrong kind for the claim", () => {
    // A green deployment says nothing about whether tests pass.
    const result = checkClaimAnchored("TESTS_PASS", [
      anchor({ kind: "deployment_state", source: "vercel" }),
    ]);

    expect(result.anchored).toBe(false);
  });

  it("does not let a state-only observation support a success claim", () => {
    const result = checkClaimAnchored("SERVICE_HEALTHY", [
      anchor({ kind: "http_health", passed: null }),
    ]);

    expect(result.anchored).toBe(false);
    expect(result.reason).toContain("reports state rather than success");
  });

  it("discards stale evidence", () => {
    // A green run from before the last commit says nothing about this one.
    const now = new Date("2026-08-14T12:00:00.000Z");
    const old = anchor({ observedAt: "2026-08-14T09:00:00.000Z" });

    expect(anchorIsFresh(old, now, 60 * 60_000)).toBe(false);

    const result = checkClaimAnchoredFresh("TESTS_PASS", [old], now, 60 * 60_000);
    expect(result.anchored).toBe(false);
    expect(result.reason).toContain("stale");
  });

  it("accepts fresh evidence within the window", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const recent = anchor({ observedAt: "2026-08-14T11:45:00.000Z" });

    expect(checkClaimAnchoredFresh("TESTS_PASS", [recent], now, 60 * 60_000).anchored).toBe(true);
  });

  it("converts a container validation result into an anchor", () => {
    const built = anchorFromValidation({
      script: "test",
      passed: true,
      image: "node:22.22.0-bookworm",
      observedAt: "2026-08-14T12:00:00.000Z",
    });

    expect(built.kind).toBe("test_run");
    expect(checkClaimAnchored("TESTS_PASS", [built]).anchored).toBe(true);
  });

  it("counts only an explicit CI success as a pass", () => {
    const observedAt = "2026-08-14T12:00:00.000Z";
    const success = anchorFromCheckRun({ name: "CI", conclusion: "success", url: "u", observedAt });
    expect(success.passed).toBe(true);

    // Cancelled, skipped, neutral and timed_out are not passes and must not
    // read as one.
    for (const conclusion of ["cancelled", "skipped", "neutral", "timed_out", "failure"]) {
      const other = anchorFromCheckRun({ name: "CI", conclusion, url: "u", observedAt });
      expect(other.passed, conclusion).toBe(false);
    }
  });
});

describe("integration nodes", () => {
  function branch(key: string, overrides: Partial<BranchResult> = {}): BranchResult {
    return {
      branchKey: key,
      status: "COMPLETED",
      writes: [],
      output: { by: key },
      ...overrides,
    };
  }

  it("waits while no branch has reported", () => {
    const result = integrateBranches(["a", "b"], []);

    expect(result.outcome).toBe("WAITING");
    expect(result.missingBranches).toEqual(["a", "b"]);
  });

  it("integrates when every branch arrived without conflicts", () => {
    const result = integrateBranches(["a", "b"], [branch("a"), branch("b")]);

    expect(result.outcome).toBe("INTEGRATED");
    expect(result.integrated).toHaveLength(2);
    expect(result.incompleteness).toBeNull();
  });

  it("refuses to integrate when two branches wrote the same resource", () => {
    // Taking the last writer and calling it the answer is the failure this
    // node exists to prevent.
    const shared = [{ kind: "file" as const, id: "app/page.tsx" }];
    const result = integrateBranches(
      ["a", "b"],
      [branch("a", { writes: shared }), branch("b", { writes: shared })],
    );

    expect(result.outcome).toBe("CONFLICT");
    expect(result.conflicts).toHaveLength(1);
    expect(result.detail).toContain("rather than letting one branch overwrite another");
  });

  it("allows overlapping writes to a resource declared reconcilable", () => {
    const shared = [{ kind: "file" as const, id: "CHANGELOG.md" }];
    const result = integrateBranches(
      ["a", "b"],
      [branch("a", { writes: shared }), branch("b", { writes: shared })],
      { reconcilableResources: ["file:CHANGELOG.md"] },
    );

    expect(result.outcome).toBe("INTEGRATED");
  });

  it("refuses partial integration by default", () => {
    const result = integrateBranches(["a", "b", "c"], [branch("a"), branch("b")]);

    expect(result.outcome).toBe("INCOMPLETE_INPUT");
    expect(result.missingBranches).toEqual(["c"]);
    expect(result.incompleteness).toContain("must not be presented as a complete answer");
  });

  it("permits partial integration only when the plan opted in, and keeps the caveat", () => {
    const result = integrateBranches(["a", "b", "c"], [branch("a"), branch("b")], {
      allowPartial: true,
    });

    expect(result.outcome).toBe("INTEGRATED");
    expect(result.integrated).toHaveLength(2);
    // Opting in changes what happens, not what is true.
    expect(result.incompleteness).not.toBeNull();
    expect(result.detail).toContain("partial-integration policy");
  });

  it("stops on a failed branch unless partial integration was allowed", () => {
    const failed = branch("b", { status: "FAILED" });

    expect(integrateBranches(["a", "b"], [branch("a"), failed]).outcome).toBe("FAILED_BRANCHES");
    expect(
      integrateBranches(["a", "b"], [branch("a"), failed], { allowPartial: true }).outcome,
    ).toBe("INTEGRATED");
  });

  it("reports conflicts ahead of incompleteness, since a conflict is unsafe either way", () => {
    const shared = [{ kind: "migration" as const, id: "0042" }];
    const result = integrateBranches(
      ["a", "b", "c"],
      [branch("a", { writes: shared }), branch("b", { writes: shared })],
    );

    expect(result.outcome).toBe("CONFLICT");
  });

  it("names every branch fighting over a resource", () => {
    const shared = [{ kind: "file" as const, id: "shared.ts" }];
    const conflicts = findWriteConflicts(
      [branch("a", { writes: shared }), branch("b", { writes: shared }), branch("c", { writes: shared })],
      [],
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].branches).toEqual(["a", "b", "c"]);
  });
});
