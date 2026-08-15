// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  evaluateMergeEligibility,
  isBinaryPath,
  isGeneratedPath,
  isWithinPrefix,
  parseMergeAllowlist,
  type ChangedFile,
  type MergeAllowlist,
} from "@/lib/autonomy/merge-eligibility";

/**
 * `policies/AUTO_MERGE_POLICY.md` listed these conditions and recorded them as
 * unimplemented. The tests below are written against the policy text, not
 * against the implementation, and they concentrate on the direction that
 * matters: every unknown must block.
 */

const allowlist: MergeAllowlist = {
  repositories: ["surgeservicesllc/SoftwareFactory"],
  baseBranches: ["main"],
  headBranchPrefixes: ["factory/"],
  allowedPathPrefixes: ["docs"],
  maxChangedFiles: 3,
  maxChangedLines: 100,
};

function request(overrides: Partial<Parameters<typeof evaluateMergeEligibility>[0]> = {}) {
  return evaluateMergeEligibility({
    repositoryFullName: "surgeservicesllc/SoftwareFactory",
    baseBranch: "main",
    headBranch: "factory/docs-canary",
    files: [{ path: "docs/README.md", additions: 3, deletions: 1 }],
    allowlist,
    ...overrides,
  });
}

describe("an unconfigured allowlist authorizes nothing", () => {
  it("blocks rather than allowing everything", () => {
    // The whole safety argument rests on this reading. "No allowlist" must not
    // mean "no restrictions".
    const result = request({ allowlist: null });

    expect(result.eligible).toBe(false);
    expect(result.blockers).toEqual(["ALLOWLIST_NOT_CONFIGURED"]);
  });

  it("refuses a malformed allowlist rather than applying part of it", () => {
    // A half-read allowlist is indistinguishable from a wider one.
    expect(parseMergeAllowlist("not json")).toBeNull();
    expect(parseMergeAllowlist("[]")).toBeNull();
    expect(parseMergeAllowlist(JSON.stringify({ repositories: ["a/b"] }))).toBeNull();
    expect(parseMergeAllowlist(JSON.stringify({
      repositories: ["a/b"], baseBranches: ["main"], headBranchPrefixes: ["factory/"],
      allowedPathPrefixes: ["docs"], maxChangedFiles: 0, maxChangedLines: 10,
    }))).toBeNull();
    expect(parseMergeAllowlist(undefined)).toBeNull();
    expect(parseMergeAllowlist("   ")).toBeNull();
  });

  it("accepts a complete allowlist", () => {
    const parsed = parseMergeAllowlist(JSON.stringify({
      repositories: ["surgeservicesllc/SoftwareFactory"],
      baseBranches: ["main"],
      headBranchPrefixes: ["factory/"],
      allowedPathPrefixes: ["docs"],
      maxChangedFiles: 3,
      maxChangedLines: 100,
    }));

    expect(parsed).toMatchObject({ maxChangedFiles: 3, maxChangedLines: 100 });
  });
});

describe("repository and branch allowlisting", () => {
  it("accepts the approved target", () => {
    expect(request().eligible).toBe(true);
  });

  it("refuses another repository, another base, or an unapproved head branch", () => {
    expect(request({ repositoryFullName: "someone/else" }).blockers)
      .toContain("REPOSITORY_NOT_ALLOWLISTED");
    expect(request({ baseBranch: "production" }).blockers)
      .toContain("BASE_BRANCH_NOT_ALLOWLISTED");
    // Without this, an approved decision could be redirected at any branch.
    expect(request({ headBranch: "attacker/patch" }).blockers)
      .toContain("HEAD_BRANCH_NOT_PERMITTED");
  });

  it("matches the base branch exactly rather than by prefix", () => {
    // `main` must not authorize `maintenance` or `main-experimental`.
    expect(request({ baseBranch: "main-experimental" }).blockers)
      .toContain("BASE_BRANCH_NOT_ALLOWLISTED");
  });
});

describe("size and scope limits", () => {
  it("refuses a change with too many files or too many lines", () => {
    const many: ChangedFile[] = Array.from({ length: 4 }, (_, index) => ({
      path: `docs/page-${index}.md`, additions: 1, deletions: 0,
    }));
    expect(request({ files: many }).blockers).toContain("TOO_MANY_FILES");

    expect(request({ files: [{ path: "docs/big.md", additions: 90, deletions: 30 }] }).blockers)
      .toContain("CHANGE_TOO_LARGE");
  });

  it("counts deletions toward the limit, not only additions", () => {
    // A large deletion is exactly as unreviewable as a large addition.
    expect(request({ files: [{ path: "docs/big.md", additions: 0, deletions: 101 }] }).blockers)
      .toContain("CHANGE_TOO_LARGE");
  });

  it("refuses a path outside the approved scope", () => {
    expect(request({ files: [{ path: "lib/autonomy/pipeline.ts", additions: 1, deletions: 0 }] })
      .blockers).toContain("PATH_OUT_OF_SCOPE");
  });

  it("does not treat a lookalike sibling directory as in scope", () => {
    // The prefix bug: `docs` must not authorize `docs-internal`.
    expect(request({ files: [{ path: "docs-internal/secrets.md", additions: 1, deletions: 0 }] })
      .blockers).toContain("PATH_OUT_OF_SCOPE");
    expect(isWithinPrefix("docs-internal/secrets.md", "docs")).toBe(false);
    expect(isWithinPrefix("docs/readme.md", "docs")).toBe(true);
    expect(isWithinPrefix("docs", "docs")).toBe(true);
  });

  it("treats an empty scope as authorizing nothing", () => {
    const empty = { ...allowlist, allowedPathPrefixes: [] };
    expect(request({ allowlist: empty }).blockers).toContain("PATH_OUT_OF_SCOPE");
  });
});

describe("generated and binary content", () => {
  it("refuses a lockfile, a bundle, and a build directory", () => {
    for (const path of [
      "docs/package-lock.json", "docs/app.min.js", "docs/dist/index.js",
      "docs/bundle.map", "docs/types.generated.ts",
    ]) {
      expect(isGeneratedPath(path)).toBe(true);
      expect(request({ files: [{ path, additions: 1, deletions: 0 }] }).blockers)
        .toContain("GENERATED_CONTENT");
    }
  });

  it("refuses binary content by extension even when GitHub sends no flag", () => {
    expect(isBinaryPath("docs/diagram.png")).toBe(true);
    expect(request({ files: [{ path: "docs/diagram.png", additions: 0, deletions: 0 }] })
      .blockers).toContain("BINARY_CONTENT");
  });

  it("refuses binary content flagged by GitHub even with an innocent extension", () => {
    // GitHub reporting no patch is the authoritative signal; the extension list
    // is the backstop, not the other way round.
    expect(request({ files: [{ path: "docs/notes.md", additions: 0, deletions: 0, binary: true }] })
      .blockers).toContain("BINARY_CONTENT");
  });

  it("still accepts ordinary prose", () => {
    expect(isGeneratedPath("docs/architecture.md")).toBe(false);
    expect(isBinaryPath("docs/architecture.md")).toBe(false);
  });
});

describe("unresolved review threads", () => {
  it("blocks while a thread is open", () => {
    expect(request({ unresolvedReviewThreads: 1 }).blockers)
      .toContain("UNRESOLVED_REVIEW_THREAD");
    expect(request({ unresolvedReviewThreads: 0 }).eligible).toBe(true);
  });
});

describe("the audit record the policy requires", () => {
  it("carries repository, branches and change size", () => {
    // `AUTO_MERGE_POLICY.md` requires repository and branch in the audit
    // record, and named their absence as a gap.
    const result = request();

    expect(result).toMatchObject({
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
      baseBranch: "main",
      headBranch: "factory/docs-canary",
      changedFiles: 1,
      changedLines: 4,
    });
  });

  it("reports every reason rather than only the first", () => {
    const result = request({
      repositoryFullName: "someone/else",
      files: [{ path: "lib/secret.ts", additions: 400, deletions: 0 }],
    });

    expect(result.blockers).toEqual(expect.arrayContaining([
      "REPOSITORY_NOT_ALLOWLISTED", "CHANGE_TOO_LARGE", "PATH_OUT_OF_SCOPE",
    ]));
    expect(result.reason).toContain("not on the auto-merge allowlist");
  });
});
