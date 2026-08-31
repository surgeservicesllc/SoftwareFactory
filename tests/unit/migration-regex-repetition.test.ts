// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

/**
 * PostgreSQL refuses a regex repetition count above 255.
 *
 * This has now cost two releases. `crm_products.sds_url` used
 * `{4,500}` (ADR-192) and `crm_documents.storage_path` used `{2,300}`
 * (ADR-195), and both compiled *silently* — a CHECK's regex is only
 * evaluated when a row actually carries a value for that column, so the
 * constraint sat harmless through every test that left the column null and
 * would have thrown "invalid repetition count(s)" at the first real row.
 *
 * The remedy in both cases was the same: check the SHAPE with a regex and
 * the LENGTH with `char_length`. This guard makes a third occurrence fail
 * here, in a suite that runs in seconds, rather than in production.
 *
 * Comments are stripped first, because the two ADR notes explaining the
 * defect necessarily quote the counts that caused it.
 */

/** Everything before a `--` that is not inside a quoted string. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      let quoted = false;
      for (let index = 0; index < line.length - 1; index += 1) {
        if (line[index] === "'") quoted = !quoted;
        if (!quoted && line[index] === "-" && line[index + 1] === "-") {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

describe("migration regexes stay inside PostgreSQL's limits", () => {
  it("uses no regex repetition count above 255", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"))) {
      const sql = stripComments(readFileSync(resolve(migrationsDirectory, file), "utf8"));
      for (const match of sql.matchAll(/\{\s*(\d+)\s*(?:,\s*(\d+)\s*)?\}/g)) {
        const low = Number(match[1]);
        const high = match[2] === undefined ? low : Number(match[2]);
        if (low > 255 || high > 255) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }
    expect(
      offenders,
      "PostgreSQL refuses a repetition count above 255, and a CHECK's regex only "
        + "compiles when a row carries a value — so this fails in production, not in a test. "
        + "Check the shape with the regex and the length with char_length().",
    ).toEqual([]);
  });
});
