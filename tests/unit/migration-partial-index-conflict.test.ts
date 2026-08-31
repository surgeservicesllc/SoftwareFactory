// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `ON CONFLICT` against a partial unique index must repeat the predicate.
 *
 * Postgres will not infer a partial unique index from its columns alone.
 * `on conflict (a, b, c) do nothing` against an index declared
 * `... (a, b, c) where p` raises "there is no unique or exclusion
 * constraint matching the ON CONFLICT specification" — at runtime, on the
 * first row that reaches it, not at CREATE FUNCTION time.
 *
 * That is what makes it worth a guard rather than a code review. The
 * migration parses, the function is created, the chain replays green, and
 * the failure waits until somebody actually presses the button. In the
 * recurring-billing generator (ADR-200) the clause it hides behind is the
 * one that stops a customer being billed twice, so the first symptom would
 * have been a duplicate-invoice error in front of a real user.
 *
 * The check is TABLE-AWARE, and deliberately so. Its first draft matched on
 * column names alone and immediately flagged the provider credential vault,
 * where `on conflict (organization_id, purpose)` targets a table with a
 * total unique constraint while an unrelated table in the same file happens
 * to carry a partial index over columns of the same name. That is not a bug,
 * and a guard that reports it is a guard people learn to ignore.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

/** Strip comments so a `where` in prose cannot satisfy — or trip — the check. */
function withoutComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function normalize(columns: string): string {
  return columns.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Every `create table public.<name> ( ... )` body, keyed by table. */
function tableBodies(sql: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const opener = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(/gi;
  for (const match of sql.matchAll(opener)) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < sql.length && depth > 0) {
      if (sql[index] === "(") depth += 1;
      else if (sql[index] === ")") depth -= 1;
      index += 1;
    }
    bodies.set(match[1].toLowerCase(), sql.slice(match.index + match[0].length, index - 1));
  }
  return bodies;
}

describe("ON CONFLICT against a partial unique index", () => {
  it("always repeats the index predicate", () => {
    const partial = new Set<string>();
    const total = new Set<string>();
    const files = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
    const sources = new Map<string, string>();

    // Pass one: every unique index and constraint in the whole chain, by
    // table and columns, split into partial and total. A later migration
    // can add the index an earlier one's insert relies on, so this cannot
    // be done file by file.
    for (const file of files) {
      const sql = withoutComments(readFileSync(resolve(migrationsDirectory, file), "utf8"));
      sources.set(file, sql);

      for (const match of sql.matchAll(
        /create\s+unique\s+index[\s\S]{0,120}?\s+on\s+public\.(\w+)\s*\(([^)]*)\)([^;]*)/gi,
      )) {
        const key = `${match[1].toLowerCase()}(${normalize(match[2])})`;
        (/\bwhere\b/i.test(match[3]) ? partial : total).add(key);
      }

      // Table-level UNIQUE constraints and PRIMARY KEY are always total.
      for (const [table, body] of tableBodies(sql)) {
        for (const match of body.matchAll(/\bunique\s*\(([^)]*)\)/gi)) {
          total.add(`${table}(${normalize(match[1])})`);
        }
        for (const match of body.matchAll(/\bprimary\s+key\s*\(([^)]*)\)/gi)) {
          total.add(`${table}(${normalize(match[1])})`);
        }
      }
      for (const match of sql.matchAll(
        /alter\s+table[\s\S]{0,80}?public\.(\w+)[\s\S]{0,120}?\badd\s+constraint\s+\w+\s+unique\s*\(([^)]*)\)/gi,
      )) {
        total.add(`${match[1].toLowerCase()}(${normalize(match[2])})`);
      }
    }

    /*
     * Pass two: every ON CONFLICT, resolved BACKWARD to the INSERT it
     * belongs to.
     *
     * Scanning forward from each INSERT looks equivalent and is not. A
     * function body with two inserts in it lets the first one's non-greedy
     * match run all the way to the SECOND one's ON CONFLICT; that match is
     * then discarded for crossing a statement boundary, and because
     * matchAll resumes past it, the real clause is never examined at all.
     * That is precisely how an earlier draft of this test passed while the
     * defect it exists for sat in the migration directory — checked by
     * deleting the predicate and watching this test stay green.
     */
    const findings: string[] = [];
    for (const [file, sql] of sources) {
      for (const match of sql.matchAll(/\bon\s+conflict\s*\(([^)]*)\)([\s\S]{0,40})/gi)) {
        const before = sql.slice(0, match.index);
        const insert = before.lastIndexOf("insert into");
        if (insert === -1) continue;
        // Same statement only: a semicolon between them means this ON
        // CONFLICT belongs to something else.
        if (before.slice(insert).includes(";")) continue;
        const target = /insert\s+into\s+public\.(\w+)/i.exec(before.slice(insert));
        if (target === null) continue;

        const key = `${target[1].toLowerCase()}(${normalize(match[1])})`;
        if (!partial.has(key) || total.has(key)) continue;
        if (/^\s*where\s/i.test(match[2])) continue;
        findings.push(`${file}: on conflict ${key} names a partial unique index but has no WHERE`);
      }
    }

    expect(
      findings,
      "An ON CONFLICT targets a partial unique index without repeating its predicate. Postgres "
        + "cannot infer the index, so this raises at runtime on the first row that reaches it — "
        + "the migration applies clean and the failure waits for a real user.",
    ).toEqual([]);
  });

  it("would catch the real one", () => {
    /*
     * The check is only worth having if it fails on the shape it exists
     * for. This is the generator's clause with its predicate removed,
     * checked against the same matching the test above performs.
     */
    const sql = withoutComments(`
      create unique index crm_invoices_plan_period_key
        on public.crm_invoices (organization_id, plan_id, service_period_start)
        where plan_id is not null;
      insert into public.crm_invoices (organization_id, plan_id, service_period_start)
      values (1, 2, 3)
      on conflict (organization_id, plan_id, service_period_start) do nothing;
    `);

    const partial = new Set<string>();
    for (const match of sql.matchAll(
      /create\s+unique\s+index[\s\S]{0,120}?\s+on\s+public\.(\w+)\s*\(([^)]*)\)([^;]*)/gi,
    )) {
      if (/\bwhere\b/i.test(match[3])) {
        partial.add(`${match[1].toLowerCase()}(${normalize(match[2])})`);
      }
    }

    const hits: string[] = [];
    for (const match of sql.matchAll(
      /insert\s+into\s+public\.(\w+)\b([\s\S]*?)\bon\s+conflict\s*\(([^)]*)\)([\s\S]{0,40})/gi,
    )) {
      const key = `${match[1].toLowerCase()}(${normalize(match[3])})`;
      if (partial.has(key) && !/^\s*where\s/i.test(match[4])) hits.push(key);
    }
    expect(hits).toHaveLength(1);
  });
});
