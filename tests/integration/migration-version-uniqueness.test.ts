// @vitest-environment node

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Two migrations must never share a version prefix.
 *
 * Supabase's ledger keys on the numeric prefix, not the filename. Two files at
 * `20260814000300_*` are two applies competing for one primary key in
 * `supabase_migrations.schema_migrations`: the first records the version, the
 * second collides, and `db push` fails partway with the schema half-applied
 * against a hosted database.
 *
 * Nothing else in the suite catches it. Both files apply cleanly in isolation,
 * both apply cleanly in filename order under PGlite (which has no ledger), and
 * every behavioral test passes — because the failure lives in the ledger, not
 * the schema. It surfaces for the first time during the one operation that is
 * hardest to reverse.
 *
 * This has now happened twice in this repository, both times because separate
 * agents picked the same timestamp while working in parallel. A collision is a
 * near-certainty under concurrent authorship, so it is checked rather than
 * remembered.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

/** `20260814000300_declare_model_characteristics.sql` → `20260814000300`. */
function versionOf(filename: string): string | null {
  const match = /^(\d{14})_/.exec(filename);
  return match ? match[1] : null;
}

describe("migration versions", () => {
  it("are unique, because the hosted ledger keys on the prefix", async () => {
    const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql"));
    const byVersion = new Map<string, string[]>();

    for (const file of files) {
      const version = versionOf(file);
      if (!version) continue;
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }

    const collisions = [...byVersion.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([version, names]) => `${version}: ${names.sort().join(", ")}`);

    expect(collisions).toEqual([]);
  });

  it("all parse, so nothing escapes the uniqueness check by being unparseable", async () => {
    const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql"));
    const malformed = files.filter((file) => versionOf(file) === null);

    expect(malformed).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
  });

  it("sort identically by filename and by version", async () => {
    // `supabase db push` applies in filename order and records the version, so
    // a set where those two orders disagree would apply out of ledger order.
    const files = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const versions = files.map((file) => versionOf(file) ?? "");

    expect(versions).toEqual([...versions].sort());
  });
});
