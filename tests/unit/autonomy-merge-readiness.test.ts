import { describe, expect, it } from "vitest";

import {
  evaluateMergeReadiness,
  type MergeReadinessRequest,
} from "@/lib/autonomy/merge-readiness";

const HEAD = "aaaaaaaaaaaa";
const OLDER = "bbbbbbbbbbbb";

function request(overrides: Partial<MergeReadinessRequest> = {}): MergeReadinessRequest {
  return {
    currentHeadSha: HEAD,
    gatedHeadSha: HEAD,
    approvedHeadSha: HEAD,
    approved: true,
    mergeability: "clean",
    pullRequestOpen: true,
    requiredChecks: ["Lint, typecheck, test, and build", "Browser and accessibility tests"],
    checks: [
      { name: "Lint, typecheck, test, and build", status: "passed" },
      { name: "Browser and accessibility tests", status: "passed" },
    ],
    // The property under test in most cases is everything *except* the missing
    // executor, so it is connected by default here and asserted separately.
    executorConnected: true,
    ...overrides,
  };
}

describe("the ready case", () => {
  it("is ready when every precondition holds against the current head", () => {
    const result = evaluateMergeReadiness(request());

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.evaluatedHeadSha).toBe(HEAD);
  });
});

describe("a new push invalidates what was decided about an older commit", () => {
  it("refuses an approval given for an earlier commit", () => {
    const result = evaluateMergeReadiness(
      request({ approvedHeadSha: OLDER, gatedHeadSha: HEAD }),
    );

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("APPROVAL_STALE");
    expect(result.reason).toMatch(/does not cover this one/i);
  });

  it("refuses verification that ran against an earlier commit", () => {
    const result = evaluateMergeReadiness(request({ gatedHeadSha: OLDER }));

    expect(result.blockers).toContain("GATES_STALE");
  });

  it("refuses both when a push invalidated both", () => {
    const result = evaluateMergeReadiness(
      request({ gatedHeadSha: OLDER, approvedHeadSha: OLDER }),
    );

    expect(result.blockers).toEqual(
      expect.arrayContaining(["APPROVAL_STALE", "GATES_STALE"]),
    );
  });

  it("does not report a stale approval when there is no approval to be stale", () => {
    const result = evaluateMergeReadiness(request({ approved: false, approvedHeadSha: null }));

    expect(result.blockers).toContain("NOT_APPROVED");
    expect(result.blockers).not.toContain("APPROVAL_STALE");
  });
});

describe("conflicts and mergeability", () => {
  it("refuses a branch that conflicts with its base", () => {
    const result = evaluateMergeReadiness(request({ mergeability: "dirty" }));

    expect(result.blockers).toContain("MERGE_CONFLICT");
  });

  it("refuses while mergeability is still unknown, rather than assuming clean", () => {
    const result = evaluateMergeReadiness(request({ mergeability: "unknown" }));

    expect(result.blockers).toContain("MERGEABILITY_UNKNOWN");
  });

  it("refuses when the provider reports branch protection unsatisfied", () => {
    const result = evaluateMergeReadiness(request({ mergeability: "blocked" }));

    expect(result.blockers).toContain("BRANCH_PROTECTION_UNSATISFIED");
  });

  it("allows a branch that is merely behind its base", () => {
    // Behind is not a conflict; the merge itself resolves it.
    expect(evaluateMergeReadiness(request({ mergeability: "behind" })).ready).toBe(true);
  });
});

describe("required checks are never inferred as satisfied", () => {
  it("blocks when a required check has not reported at all", () => {
    const result = evaluateMergeReadiness(request({ checks: [] }));

    expect(result.blockers).toContain("REQUIRED_CHECK_MISSING");
    expect(result.ready).toBe(false);
  });

  it("blocks on a failing required check", () => {
    const result = evaluateMergeReadiness(
      request({
        checks: [
          { name: "Lint, typecheck, test, and build", status: "failed" },
          { name: "Browser and accessibility tests", status: "passed" },
        ],
      }),
    );

    expect(result.blockers).toContain("REQUIRED_CHECK_FAILING");
  });

  it("blocks on a required check that has not finished", () => {
    const result = evaluateMergeReadiness(
      request({
        checks: [
          { name: "Lint, typecheck, test, and build", status: "pending" },
          { name: "Browser and accessibility tests", status: "passed" },
        ],
      }),
    );

    expect(result.blockers).toContain("REQUIRED_CHECK_PENDING");
  });

  it("ignores a failing check that protection does not require", () => {
    const result = evaluateMergeReadiness(
      request({
        checks: [
          { name: "Lint, typecheck, test, and build", status: "passed" },
          { name: "Browser and accessibility tests", status: "passed" },
          { name: "Optional preview comment", status: "failed" },
        ],
      }),
    );

    expect(result.ready).toBe(true);
  });

  it("reports one blocker per kind rather than one per check", () => {
    const result = evaluateMergeReadiness(request({ checks: [] }));

    expect(result.blockers.filter((b) => b === "REQUIRED_CHECK_MISSING")).toHaveLength(1);
  });
});

describe("other preconditions", () => {
  it("refuses a dismissed review", () => {
    expect(evaluateMergeReadiness(request({ reviewDismissed: true })).blockers).toContain(
      "REVIEW_DISMISSED",
    );
  });

  it("refuses a pull request that is not open", () => {
    expect(evaluateMergeReadiness(request({ pullRequestOpen: false })).blockers).toContain(
      "PULL_REQUEST_NOT_OPEN",
    );
  });
});

describe("as this tree actually ships", () => {
  it("is never ready, because no merge executor exists", () => {
    const result = evaluateMergeReadiness(request({ executorConnected: undefined }));

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("MERGE_EXECUTOR_NOT_CONNECTED");
  });

  it("still reports the other blockers, so the record is complete", () => {
    const result = evaluateMergeReadiness(
      request({ executorConnected: undefined, mergeability: "dirty", gatedHeadSha: OLDER }),
    );

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "GATES_STALE",
        "MERGE_CONFLICT",
        "MERGE_EXECUTOR_NOT_CONNECTED",
      ]),
    );
  });

  it("explains every blocker it found", () => {
    const result = evaluateMergeReadiness(
      request({ approved: false, approvedHeadSha: null, mergeability: "dirty" }),
    );

    expect(result.reason).toMatch(/not approved/i);
    expect(result.reason).toMatch(/conflicts with its base/i);
  });
});
