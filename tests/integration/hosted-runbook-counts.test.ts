// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * The apply runbook states two counts. They must match the repository.
 *
 * `AI/HOSTED_APPLY_RUNBOOK.md` is the document an owner executes from when
 * applying migrations to hosted Supabase. It opens by saying how many
 * migrations exist and how many are unhosted, and those numbers are how a
 * reader decides whether the tables below them are complete.
 *
 * Both have gone stale three times. The reason is structural rather than
 * careless: several agents add migrations to this repository in parallel, and
 * none of them is reading that paragraph. A count maintained by remembering is
 * a count that drifts, and a runbook that undercounts is worse than one that
 * says nothing — it tells an owner they are finished when they are not.
 *
 * So the numbers are derived here and asserted. The failure message points at
 * the sentence to edit, because the fix is a documentation edit rather than a
 * code change and that is not obvious from a red test.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

/**
 * The hosted ledger position the runbook is written against — owner-measured
 * 2026-08-16 (`select count(*), max(version) from
 * supabase_migrations.schema_migrations` → 65 rows, max below). The one
 * hosted row above the local file set at this position is the renamed
 * `20260814002000_graph_engineering`, handled by the runbook's repair step.
 *
 * It moved here from `20260813001400` once the repair completed the
 * half-applied `20260814000210`. Note which way the old value erred: it
 * counted already-applied migrations as outstanding, which overstates the
 * owner's remaining work — still wrong, and the direction that wastes an apply
 * window on migrations that would fail as duplicates.
 */
const HOSTED_LEDGER_ENDS_AT = "20260814002300";

let runbook = "";
let currentState = "";
let migrationFiles: string[] = [];

beforeAll(async () => {
  runbook = await readFile(resolve(repositoryRoot, "AI/HOSTED_APPLY_RUNBOOK.md"), "utf8");
  currentState = await readFile(resolve(repositoryRoot, "AI/CURRENT_STATE.md"), "utf8");
  migrationFiles = (await readdir(resolve(repositoryRoot, "supabase/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
});

function statedTotal(): number | null {
  const match = /repository total is (\d+) migration/.exec(runbook);
  return match ? Number(match[1]) : null;
}

function statedUnhosted(): number | null {
  const match = /\*\*The current total is (\d+)\*\*/.exec(runbook);
  return match ? Number(match[1]) : null;
}

describe("the hosted apply runbook's counts", () => {
  it("still states both numbers in the expected form", () => {
    // If this fails the sentences were reworded, and the two assertions below
    // would otherwise pass vacuously by matching nothing.
    expect(statedTotal()).not.toBeNull();
    expect(statedUnhosted()).not.toBeNull();
  });

  it("matches the number of migration files in the repository", () => {
    expect(
      statedTotal(),
      `AI/HOSTED_APPLY_RUNBOOK.md says "the repository total is ${statedTotal()} migration files" `
        + `but there are ${migrationFiles.length}. Update that sentence.`,
    ).toBe(migrationFiles.length);
  });

  it("matches the number of migrations after the hosted ledger position", () => {
    const unhosted = migrationFiles.filter(
      (name) => (/^(\d{14})_/.exec(name)?.[1] ?? "") > HOSTED_LEDGER_ENDS_AT,
    );

    expect(
      statedUnhosted(),
      `AI/HOSTED_APPLY_RUNBOOK.md says "The current total is ${statedUnhosted()}" unhosted `
        + `migrations, but ${unhosted.length} files sort after ${HOSTED_LEDGER_ENDS_AT}. `
        + `Update that sentence, and check whether the tables below it need a new row.`,
    ).toBe(unhosted.length);
  });

  it("still names the ledger position this document assumes", () => {
    // If the hosted position moves, every count in the file changes meaning.
    expect(runbook).toContain(HOSTED_LEDGER_ENDS_AT);
  });
});

/**
 * `AI/CURRENT_STATE.md` states the same number, in two different paragraphs.
 *
 * It drifted the way an unchecked number always does, and the giveaway was that
 * the two paragraphs disagreed with *each other* — 15 in one, 29 in the other,
 * and the truth was 9. A reader has no way to tell which to believe, so both
 * are worthless, and the document is the one an agent reads first.
 *
 * The runbook's counts are derived above. These are derived the same way rather
 * than cross-checked against the runbook: agreeing with another document is not
 * the same as being right, and two files copying one stale number is exactly
 * how this got here.
 */
describe("the current-state summary's hosted count", () => {
  function statedCounts(): number[] {
    return [...currentState.matchAll(/(\d+) migrations (?:behind|remain unhosted)/g)]
      .map((match) => Number(match[1]));
  }

  it("still states the count in the expected form, in both places", () => {
    // Two sentences say this. If a reword drops one, the assertion below would
    // pass by checking fewer things rather than by being satisfied.
    expect(statedCounts()).toHaveLength(2);
  });

  it("matches the number of migrations after the hosted ledger position", () => {
    const unhosted = migrationFiles.filter(
      (name) => (/^(\d{14})_/.exec(name)?.[1] ?? "") > HOSTED_LEDGER_ENDS_AT,
    );

    for (const stated of statedCounts()) {
      expect(
        stated,
        `AI/CURRENT_STATE.md states ${stated} unhosted migrations, but ${unhosted.length} files `
          + `sort after ${HOSTED_LEDGER_ENDS_AT}. Update both sentences -- they have disagreed `
          + `with each other before.`,
      ).toBe(unhosted.length);
    }
  });

  it("names the ledger position it is written against", () => {
    expect(currentState).toContain(HOSTED_LEDGER_ENDS_AT);
  });
});
