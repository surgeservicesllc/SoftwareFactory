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

/** The hosted ledger position the runbook is written against. */
// Moved 2026-08-15: the repair scripts completed the half-applied
// `20260814000210` and the ledger was reconciled to 65 rows covering all 64
// files up to this version, with `scripts/hosted-schema-audit.mts` reporting 0
// outstanding and 0 indeterminate. Leaving the old position here would have
// counted already-applied migrations as outstanding, which overstates the
// owner's remaining work rather than understating it -- still wrong, and the
// direction that wastes an apply window on migrations that would fail as
// duplicates.
const HOSTED_LEDGER_ENDS_AT = "20260814002300";

let runbook = "";
let migrationFiles: string[] = [];

beforeAll(async () => {
  runbook = await readFile(resolve(repositoryRoot, "AI/HOSTED_APPLY_RUNBOOK.md"), "utf8");
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
