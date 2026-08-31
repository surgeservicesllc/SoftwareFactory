// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every `supabase/migrations/...` path a workflow or a test names must be a
 * file that exists.
 *
 * Two live bugs are why this exists, and both are the same shape: a
 * migration is renumbered, and something that pointed at the old name is
 * missed.
 *
 * The first was mine. Two branches collided on version 20260830001100, so
 * the CRM chain renumbered up a slot — and the sweep rewrote that version
 * string everywhere, including in three places that referred to the OTHER
 * branch's migration of the same number. Two of them were tests, so CI
 * would have caught it; the third was a release workflow, which nothing
 * executes until a dispatch.
 *
 * The second was already on main and had been for a while: the
 * `budget-tracker` apply scope pointed at
 * `20260829000300_budget_tracker_activity_types.sql`, a name the file lost
 * when the job-seeker alert engine took 000300. Its pinned hash still
 * matched the real file byte for byte, so only the version had drifted —
 * but a dispatch would have died at `sha256sum` with "No such file"
 * instead of applying, and the ledger probe was asking about a version this
 * repository does not contain. That is a production release path that
 * cannot work, sitting green because nothing ever reads it.
 *
 * A dangling path in a workflow fails at a dispatch and nowhere earlier,
 * which is the worst possible place to find it.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrations = new Set(readdirSync(resolve(repositoryRoot, "supabase/migrations")));

/**
 * Fabricated names inside unit-test fixtures — diffs that describe a
 * migration rather than reference one. They are arguments to a risk
 * classifier, not files anybody opens.
 */
const FIXTURE_PREFIX = "20260101000000_";

const PATH = /supabase\/migrations\/(\d{14}_[a-z0-9_]+\.sql)/g;

/**
 * The same hazard, one directory over. Postflight and guard SQL live in
 * `.github/hosted-apply/` because the workflow is measured against a byte
 * ceiling and each scope's verification would otherwise breach it. Nothing
 * but a production dispatch executes those `psql -f` paths, so a rename on
 * either side is invisible until the release it breaks.
 *
 * The check runs both ways deliberately. A workflow naming a file that is
 * gone dies at the dispatch; a file nothing names is verification that
 * silently stopped running, which is worse, because the scope still
 * reports success.
 */
const HOSTED_APPLY = /\.github\/hosted-apply\/((?:[a-z]+\/)?[a-z0-9-]+\.sql)/g;

function hostedApplyFiles(): string[] {
  const root = resolve(repositoryRoot, ".github/hosted-apply");
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const nested of readdirSync(resolve(root, entry.name))) {
        if (nested.endsWith(".sql")) found.push(`${entry.name}/${nested}`);
      }
    } else if (entry.isFile() && entry.name.endsWith(".sql")) {
      found.push(entry.name);
    }
  }
  return found.sort();
}

function hostedApplyReferences(): { file: string; name: string }[] {
  const found: { file: string; name: string }[] = [];
  for (const entry of readdirSync(resolve(repositoryRoot, ".github/workflows"), {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;
    const text = readFileSync(resolve(repositoryRoot, ".github/workflows", entry.name), "utf8");
    for (const match of text.matchAll(HOSTED_APPLY)) {
      found.push({ file: `.github/workflows/${entry.name}`, name: match[1] });
    }
  }
  return found;
}

function referencesIn(directory: string, extension: string): { file: string; name: string }[] {
  const found: { file: string; name: string }[] = [];
  for (const entry of readdirSync(resolve(repositoryRoot, directory), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
    const text = readFileSync(resolve(repositoryRoot, directory, entry.name), "utf8");
    for (const match of text.matchAll(PATH)) {
      found.push({ file: `${directory}/${entry.name}`, name: match[1] });
    }
  }
  return found;
}

describe("migration paths named outside the migrations directory", () => {
  it("all exist, in every workflow", () => {
    const dangling = referencesIn(".github/workflows", ".yml")
      .filter(({ name }) => !migrations.has(name))
      .map(({ file, name }) => `${file} names ${name}`);
    expect(
      dangling,
      "A workflow points at a migration file that does not exist. A release scope with a "
        + "dangling path fails at a production dispatch and nowhere earlier — nothing else "
        + "ever reads it.\n" + dangling.join("\n"),
    ).toEqual([]);
  });

  it("all exist, in every test", () => {
    const dangling = [...referencesIn("tests/unit", ".ts"), ...referencesIn("tests/integration", ".ts")]
      .filter(({ name }) => !migrations.has(name) && !name.startsWith(FIXTURE_PREFIX))
      .map(({ file, name }) => `${file} names ${name}`);
    expect(
      dangling,
      "A test points at a migration file that does not exist. If a migration was renumbered, "
        + "sweep every reference to it — and check that the sweep did not rewrite a reference "
        + "to somebody else's migration that happened to share the number.\n"
        + dangling.join("\n"),
    ).toEqual([]);
  });

  it("names a real file for every extracted postflight and guard, and runs every one it has", () => {
    const present = new Set(hostedApplyFiles());
    const referenced = hostedApplyReferences();

    const dangling = referenced
      .filter(({ name }) => !present.has(name))
      .map(({ file, name }) => `${file} names .github/hosted-apply/${name}`);
    expect(
      dangling,
      "A workflow runs a hosted-apply SQL file that does not exist. The scope dies at "
        + "`psql -f` during a production dispatch and nowhere earlier.\n" + dangling.join("\n"),
    ).toEqual([]);

    const named = new Set(referenced.map(({ name }) => name));
    const orphaned = [...present].filter((name) => !named.has(name));
    expect(
      orphaned,
      "A hosted-apply SQL file is not run by any workflow. Verification nothing executes is "
        + "worse than none: the scope it belonged to still reports success.\n"
        + orphaned.join("\n"),
    ).toEqual([]);
  });
});
