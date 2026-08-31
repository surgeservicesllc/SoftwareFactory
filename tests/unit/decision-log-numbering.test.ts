// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The decision log is an index, and an index with two ADR-190s is broken.
 *
 * This guard exists because that is exactly what happened: two branches
 * were open at once, each appended what it believed was the next number,
 * and the collision survived until a merge put both headings in the same
 * file. A duplicate is not a merge conflict — git resolves "both sides
 * added a section" without complaint — so nothing caught it. The same week
 * produced a migration-version collision for the same reason; that one has
 * had a guard for a while, and this is its counterpart for the prose.
 *
 * It is a RATCHET, not a clean sweep. Four collisions and two orderings
 * predate it, all of them merged records that other documents, commit
 * messages and code comments already point at by number. Renumbering a
 * landed decision to satisfy a new test would break those references to
 * make a number tidy, so they are named here instead — visible, counted,
 * and explicitly not growing. A fifth duplicate fails this test.
 */

const decisions = readFileSync(resolve(import.meta.dirname, "../../AI/DECISIONS.md"), "utf8");

/**
 * Collisions that predate the guard. Each is two unrelated decisions that
 * were written on parallel branches and merged without either side seeing
 * the other's heading.
 */
const KNOWN_DUPLICATES = new Set([140, 141, 149, 150]);

/**
 * The same four, seen from the ordering side: the second copy of each was
 * appended at the end of the log rather than in sequence, so a reader
 * scanning downward passes its number before reaching it.
 */
const KNOWN_OUT_OF_ORDER = new Set([141, 149]);

function headings(): { number: number; line: number; title: string }[] {
  const found: { number: number; line: number; title: string }[] = [];
  decisions.replace(/\r\n?/g, "\n").split("\n").forEach((text, index) => {
    const match = /^## ADR-(\d+)\s*[-–—]\s*(.+)$/.exec(text);
    if (match) found.push({ number: Number(match[1]), line: index + 1, title: match[2] });
  });
  return found;
}

describe("the decision log", () => {
  it("gives every new ADR its own number", () => {
    const seen = new Map<number, number>();
    const duplicates: string[] = [];
    for (const heading of headings()) {
      const first = seen.get(heading.number);
      if (first === undefined) {
        seen.set(heading.number, heading.line);
        continue;
      }
      if (KNOWN_DUPLICATES.has(heading.number)) continue;
      duplicates.push(`ADR-${heading.number} appears at line ${first} and again at line ${heading.line}`);
    }
    expect(
      duplicates,
      "Two ADRs carry the same number. The merged one keeps it; renumber the branch that has "
        + "not landed yet, and sweep every reference — migrations, tests, code comments and the "
        + "other AI/ documents. Do not add it to KNOWN_DUPLICATES: that list is closed.\n"
        + duplicates.join("\n"),
    ).toEqual([]);
  });

  it("keeps the rest of them in ascending order", () => {
    const entries = headings();
    const outOfOrder = entries
      .map((entry, index) => ({ entry, previous: entries[index - 1] }))
      .filter(
        ({ entry, previous }) =>
          previous !== undefined
          && entry.number < previous.number
          && !KNOWN_OUT_OF_ORDER.has(entry.number),
      )
      .map(({ entry, previous }) => `ADR-${entry.number} (line ${entry.line}) follows ADR-${previous.number}`);
    expect(
      outOfOrder,
      "An ADR is out of sequence, so a reader scanning for it stops before reaching it.\n"
        + outOfOrder.join("\n"),
    ).toEqual([]);
  });

  it("only ever grows", () => {
    // A cheap tripwire against a truncating edit or a botched merge
    // resolution that drops one side's sections.
    expect(headings().length).toBeGreaterThanOrEqual(201);
  });
});
