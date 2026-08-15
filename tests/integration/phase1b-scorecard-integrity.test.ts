// @vitest-environment node

import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hold the Phase 1B scorecard to its own citations.
 *
 * This exists because of a specific failure, not a hypothetical one. Item 8
 * ("detect stale SHA / version conflicts") was scored PASS citing
 * `tests/unit/github-protected-change-route.test.ts`, which covers commit
 * attribution, the approval requirement, administrator rejection and the
 * owner-approved draft — and nothing about the stale path. Searching the tree
 * for `stale_file` returned nothing at all. The item had been scored on code
 * that existed rather than on a test that ran, and it stayed that way through
 * several reviews because reading a score is not the same as running it.
 *
 * A scorecard is a claim about the repository, so the repository should be able
 * to refuse it. Three things are checked:
 *
 *   1. Every test file the scorecard cites exists.
 *   2. The headline totals match the rows underneath them.
 *   3. Rows claiming live evidence say so in a way that cannot be confused with
 *      a passing test, because the distinction between "proven against real
 *      GitHub" and "proven against real migrations" is the entire remaining
 *      difference between 18/20 and 20/20.
 *
 * What this deliberately does not do is check that a cited test *proves* its
 * row. No parser can judge that. It narrows the gap to the part that needs a
 * person, and removes the part that does not.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const scorecardPath = resolve(repositoryRoot, "AI/PHASE_1B_COMPLETION.md");

async function scorecard(): Promise<string> {
  return readFile(scorecardPath, "utf8");
}

/** Rows of the item table: `| 8 | claim | **PASS** | evidence |`. */
function itemRows(source: string) {
  return [...source.matchAll(/^\| (\d+) \| ([^|]+)\| \*\*([A-Z (),]+)\*\* \| (.+)$/gm)].map(
    ([, id, claim, score, evidence]) => ({
      claim: claim.trim(),
      evidence: evidence.trim(),
      id: Number(id),
      score: score.trim(),
    }),
  );
}

describe("Phase 1B scorecard integrity", () => {
  it("cites only test files that exist", async () => {
    const source = await scorecard();
    const cited = [
      ...new Set(
        [...source.matchAll(/tests\/[a-z0-9/-]+\.(?:behavior\.|contract\.)?test\.tsx?/g)].map(
          ([path]) => path,
        ),
      ),
    ];

    // A scorecard citing nothing would pass every assertion below vacuously.
    expect(cited.length).toBeGreaterThan(10);

    const missing: string[] = [];
    for (const path of cited) {
      try {
        await access(resolve(repositoryRoot, path));
      } catch {
        missing.push(path);
      }
    }
    expect(missing, `cited but absent: ${missing.join(", ")}`).toEqual([]);
  });

  it("covers all twenty items exactly once", async () => {
    const rows = itemRows(await scorecard());
    expect(rows.map((row) => row.id)).toEqual(
      Array.from({ length: 20 }, (unused, index) => index + 1),
    );
  });

  it("states totals that match the rows", async () => {
    const source = await scorecard();
    const rows = itemRows(source);

    const passes = rows.filter((row) => row.score.startsWith("PASS")).length;
    const partials = rows.filter((row) => row.score.startsWith("PARTIAL")).length;
    const fails = rows.filter((row) => row.score.startsWith("FAIL")).length;

    // The headline is written by hand in several places. Each of them is a
    // number a reader will quote without re-counting, so each has to agree.
    // Both separators are in use across the /AI documents, and the trailing
    // percentage is sometimes inside the bold and sometimes outside it. Matching
    // the tally itself rather than its surrounding punctuation keeps this from
    // failing on formatting that is not the claim.
    const tallies = [
      ...source.matchAll(/(\d+) PASS\s*[,/]\s*(\d+) PARTIAL\s*[,/]\s*(\d+) FAIL/g),
    ].map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
    expect(tallies.length, "no tally of the form 'N PASS / N PARTIAL / N FAIL'")
      .toBeGreaterThan(0);

    // Every tally, not just the first. The document states the score in more
    // than one place, and the failure mode worth catching is the one where a
    // later section is updated and an earlier one is not.
    for (const tally of tallies) {
      expect(tally).toEqual([passes, partials, fails]);
    }
    expect(passes + partials + fails).toBe(20);
  });

  it("does not claim a percentage the rows do not support", async () => {
    const source = await scorecard();
    const rows = itemRows(source);
    const passes = rows.filter((row) => row.score.startsWith("PASS")).length;

    // Only percentages on a line that also states a score. The document
    // legitimately quotes a goal asking for "Phase 1B at 100%" and explains what
    // "100% connected to Supabase" means; neither is a claim about the score,
    // and flagging them would train the next reader to ignore this test.
    const scoringLines = source
      .split("\n")
      .filter((line) => line.includes("PASS") && /\d+%/.test(line));
    const percentages = scoringLines.flatMap((line) =>
      [...line.matchAll(/(\d+)%/g)].map(([, value]) => Number(value)));
    const overstated = percentages.filter((value) => value > (passes / 20) * 100);
    expect(
      overstated,
      `rows support ${(passes / 20) * 100}% but the document claims ${overstated.join("%, ")}%`,
    ).toEqual([]);
  });

  it("keeps live evidence distinguishable from test evidence", async () => {
    const rows = itemRows(await scorecard());

    // Items 11-15 are proven against real migrations, not against live GitHub,
    // and the scorecard says so. If a later edit quietly promoted one of them to
    // an unqualified PASS, the difference between "the schema refuses this" and
    // "GitHub actually did this and we saw it" would disappear — which is the
    // whole of what items 2 and 20 are still waiting for.
    for (const id of [11, 12, 13, 14, 15]) {
      const row = rows.find((candidate) => candidate.id === id)!;
      expect(row.score, `item ${id} should stay marked as test-proven`).toBe("PASS (TEST)");
      expect(row.evidence.startsWith("TEST:"), `item ${id} evidence should lead with TEST:`).toBe(
        true,
      );
    }
  });

  it("keeps the two owner-blocked items open until they are actually observed", async () => {
    const source = await scorecard();
    const rows = itemRows(source);

    for (const id of [2, 20]) {
      const row = rows.find((candidate) => candidate.id === id)!;
      // These may only become PASS when someone has run
      // `scripts/verify-1b-live-acceptance.mts` against a real second
      // installation. Until then the honest score is PARTIAL, and this test is
      // here so that promoting them requires deleting an assertion rather than
      // editing a table cell at the end of a long session.
      expect(row.score, `item ${id} needs live observation before it can pass`).toBe("PARTIAL");
    }

    expect(source).toContain("OWNER ACTION REQUIRED");
    expect(source).toContain("scripts/verify-1b-live-acceptance.mts");
  });
});
