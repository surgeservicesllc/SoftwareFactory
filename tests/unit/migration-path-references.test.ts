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
});
