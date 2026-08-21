// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * The apply runbook states the hosted position. It must agree with the
 * repository and with the workflow that measures production.
 *
 * `AI/HOSTED_APPLY_RUNBOOK.md` is the document an owner executes from when
 * applying migrations to hosted Supabase, and its opening numbers are how a
 * reader decides whether the tables below them are complete. They have gone
 * stale repeatedly, for a structural reason rather than a careless one:
 * several agents add migrations to this repository in parallel, and none of
 * them is reading that paragraph. A count maintained by remembering is a count
 * that drifts, and a runbook that undercounts tells an owner they are finished
 * when they are not.
 *
 * The model the earlier version of this test enforced — a single hosted
 * high-water mark, everything after it outstanding — was itself disproven.
 * Probe run 32103778884 showed the hosted ledger is missing nineteen versions
 * in the *middle* of the sequence while carrying every row above them, so no
 * prefix describes it. What is asserted now is the measured set: the runbook
 * names it, the workflow's probe asks about exactly it, and every version in
 * it is a real file.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

let runbook = "";
let workflow = "";
let migrationFiles: string[] = [];

beforeAll(async () => {
  runbook = await readFile(resolve(repositoryRoot, "AI/HOSTED_APPLY_RUNBOOK.md"), "utf8");
  workflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/apply-hosted-migrations.yml"),
    "utf8",
  );
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

/**
 * The versions the runbook's measured table lists as absent from the hosted
 * ledger. Read from the table's first cell, which is the only place the set is
 * written down in full.
 */
function runbookLedgerAbsent(): string[] {
  const table = /\*\*Absent from the hosted ledger[^\n]*\r?\n([\s\S]*?)\r?\n\r?\n/.exec(runbook);
  if (!table) return [];
  return [...table[1].matchAll(/^\| `(\d{14})` \|/gm)].map((match) => match[1]);
}

/** The versions the workflow's read-only probe asks about, one row each. */
function probedVersions(): string[] {
  const block = /with expected\(version, kind, object, marker\) as \(values([\s\S]*?)\r?\n\s*\)\r?\n/
    .exec(workflow);
  if (!block) return [];
  return [...block[1].matchAll(/\('(\d{14})',/g)].map((match) => match[1]);
}

describe("the hosted apply runbook", () => {
  it("still states both numbers in the expected form", () => {
    // If this fails the sentences were reworded, and the assertions below
    // would otherwise pass vacuously by matching nothing.
    expect(statedTotal()).not.toBeNull();
    expect(statedUnhosted()).not.toBeNull();
  });

  it("states a repository total matching the migration directory", () => {
    expect(
      statedTotal(),
      `AI/HOSTED_APPLY_RUNBOOK.md says "the repository total is ${statedTotal()} migration files" `
        + `but there are ${migrationFiles.length}. Update that sentence.`,
    ).toBe(migrationFiles.length);
  });

  it("names as many ledger-absent versions as it claims", () => {
    const named = runbookLedgerAbsent();
    expect(
      named.length,
      `AI/HOSTED_APPLY_RUNBOOK.md says "The current total is ${statedUnhosted()}" but its `
        + `"Absent from the hosted ledger" table names ${named.length} versions. `
        + `Update whichever is wrong — the table is the one an owner acts from.`,
    ).toBe(statedUnhosted());
  });

  it("names only versions that exist as migration files", () => {
    const versions = new Set(
      migrationFiles.map((name) => /^(\d{14})_/.exec(name)?.[1] ?? ""),
    );
    const unknown = runbookLedgerAbsent().filter((version) => !versions.has(version));
    expect(
      unknown,
      `AI/HOSTED_APPLY_RUNBOOK.md lists ${unknown.join(", ")} as unhosted, but no migration `
        + "file carries those versions. A renamed or deleted migration leaves the runbook "
        + "pointing at nothing.",
    ).toEqual([]);
  });

  it("is probed by the workflow for exactly the set it names", () => {
    // The probe is what an owner runs to decide repair-versus-apply. If it
    // asks about a different set than the runbook names, the answer it prints
    // is not an answer to the question the runbook poses.
    expect(
      probedVersions(),
      "The scope=probe step in .github/workflows/apply-hosted-migrations.yml asks about a "
        + "different set of versions than AI/HOSTED_APPLY_RUNBOOK.md names as ledger-absent. "
        + "Bring the two into line.",
    ).toEqual(runbookLedgerAbsent());
  });

  it("still records the run the measurement came from", () => {
    // Without the run id the table is an assertion; with it, it is evidence.
    expect(runbook).toContain("32103778884");
  });
});
