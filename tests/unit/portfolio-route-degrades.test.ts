// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The portfolio read must survive a database that is behind the repository.
 *
 * This exists because of a real regression that shipped: the project detail
 * page needed the Phase 2E scheduling columns, so they were added to the
 * projects select — and `20260815000200` is not applied to hosted. PostgREST
 * fails the *entire* query when it names a column the database does not have,
 * and projects are the one source in this route that cannot fall back to
 * Unknown. The result would have been a portfolio page and a project detail
 * page that both read "The portfolio could not be loaded" in production, from
 * a change whose only purpose was to show four more fields.
 *
 * The fix is structural rather than a value check, so the test is too: the
 * columns that may not exist are asked for in their own select, whose failure
 * costs exactly the fields it carries.
 */

const routePath = resolve(import.meta.dirname, "../../app/api/portfolio/route.ts");

/** Columns added after the hosted ledger's high-water mark. */
const UNHOSTED_COLUMNS = [
  "engineering_priority",
  "strategic_focus",
  "engineering_paused",
  "engineering_pause_reason",
] as const;

async function selectStrings(): Promise<readonly string[]> {
  const source = await readFile(routePath, "utf8");
  return [...source.matchAll(/const \w*[Cc]olumns\s*=\s*\n?\s*"([^"]+)"/g)].map(
    ([, columns]) => columns,
  );
}

describe("the portfolio route degrades instead of failing", () => {
  it("never asks for a possibly-absent column in the same select as the essential ones", async () => {
    const selects = await selectStrings();
    expect(selects.length, "expected named column lists in the route").toBeGreaterThanOrEqual(2);

    for (const select of selects) {
      const columns = select.split(",");
      const risky = columns.filter((column) =>
        (UNHOSTED_COLUMNS as readonly string[]).includes(column));
      if (risky.length === 0) continue;

      // A select carrying a risky column may carry only those and the key
      // needed to join them back. Anything else in it goes down with them.
      const extras = columns.filter((column) =>
        column !== "id" && !(UNHOSTED_COLUMNS as readonly string[]).includes(column));
      expect(
        extras,
        `these columns share a select with columns that may not exist yet: ${extras.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("keeps the essential select free of every column that may not exist", async () => {
    const selects = await selectStrings();
    const essential = selects.find((select) => select.includes("health_status"));
    expect(essential, "expected the essential project select").toBeDefined();

    for (const column of UNHOSTED_COLUMNS) {
      expect(
        essential!.split(",").includes(column),
        `${column} must not be in the select the portfolio cannot do without`,
      ).toBe(false);
    }
  });

  it("treats the optional read's failure as absence rather than returning early", async () => {
    const source = await readFile(routePath, "utf8");
    const optionalRead = source.slice(source.indexOf("schedulingColumns"));

    // The essential read returns early on error; the optional one must not,
    // or the whole point of splitting them is lost.
    const optionalErrorReturn = /const \{ data: schedulingData[^}]*error[^}]*\}/.test(optionalRead);
    expect(
      optionalErrorReturn,
      "the scheduling read should not destructure an error it then acts on",
    ).toBe(false);
    expect(source).toContain("schedulingData ?? []");
  });
});
