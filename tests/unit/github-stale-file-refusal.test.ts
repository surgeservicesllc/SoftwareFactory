// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The stale-SHA refusal in the file-change route.
 *
 * Phase 1B item 8 ("detect stale SHA / version conflicts") is scored PASS and
 * cites `tests/unit/github-protected-change-route.test.ts` as its evidence.
 * That file tests commit attribution, the approval requirement, administrator
 * rejection, and the owner-approved draft — none of which touch the stale-SHA
 * path. Searching the whole test tree for `stale_file` returned nothing, so the
 * item was scored on code that existed rather than on a test that ran.
 *
 * Why the guard matters: without it a save built against an old view of the
 * file silently overwrites whatever landed in between. That is the lost-update
 * problem, and it is worse here than in an ordinary editor because the write is
 * performed by an agent that never saw the intervening change.
 *
 * These assert the ordering that makes the guard effective, at source level.
 * A route-level behavioural test would need the full GitHub client, tenant
 * boundary, and provider-execution boundary mocked, which buys less than it
 * costs; what actually breaks this guard is somebody moving the check.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const routePath = "app/api/github/repositories/[owner]/[repo]/changes/route.ts";
const source = readFileSync(resolve(repositoryRoot, routePath), "utf8");

describe("stale file refusal", () => {
  it("refuses with 409 stale_file when the live blob SHA differs from the submitted one", () => {
    expect(source).toMatch(
      /if \(currentFile\.sha !== parsed\.data\.expectedBlobSha\) \{\s*\n\s*throw new GitHubApiError\(409, "stale_file"/,
    );
  });

  it("requires a caller-supplied expected blob SHA rather than defaulting one", () => {
    // A defaulted or optional SHA would make the comparison above vacuous: the
    // route would compare the live SHA against whatever it had just read.
    expect(source).toMatch(/expectedBlobSha:\s*z\.string\(\)\.regex\(\/\^\[0-9a-f\]\{40,64\}\$\/\)/);
    expect(source).not.toMatch(/expectedBlobSha:.*\.optional\(\)/);
    expect(source).not.toMatch(/expectedBlobSha:.*\.default\(/);
  });

  it("checks staleness before creating a branch or writing a commit", () => {
    // Ordering is the whole guarantee. Refusing after the branch exists would
    // leave a stray branch behind on every conflict, and refusing after the
    // commit would not be a refusal at all.
    const staleCheck = source.indexOf('"stale_file"');
    const branchCreation = source.indexOf("createGitHubBranch(");
    const commitWrite = source.indexOf("updateGitHubFileOnBranch(");

    expect(staleCheck).toBeGreaterThan(-1);
    expect(branchCreation).toBeGreaterThan(-1);
    expect(commitWrite).toBeGreaterThan(-1);
    expect(staleCheck).toBeLessThan(branchCreation);
    expect(staleCheck).toBeLessThan(commitWrite);
  });

  it("also passes the expected SHA to the commit itself, so GitHub re-checks it", () => {
    // Defence in depth: the route's own comparison can only see the moment it
    // read the file. Handing the SHA to the update call makes GitHub reject a
    // change that went stale in the window between the two.
    expect(source).toMatch(/updateGitHubFileOnBranch\(token, \{[\s\S]{0,400}?expectedBlobSha: parsed\.data\.expectedBlobSha/);
  });

  it("distinguishes an unchanged submission from a stale one", () => {
    // Different faults with different fixes: "reload before saving" versus
    // "there is nothing to save". Collapsing them would send a caller to
    // re-read a file that was never out of date.
    expect(source).toMatch(/"no_file_change"/);
    expect(source).toMatch(/The submitted content is unchanged\./);
    expect(source).toMatch(/The file changed in GitHub\. Reload it before saving\./);
  });
});
