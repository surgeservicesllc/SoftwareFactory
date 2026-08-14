// @vitest-environment node

import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One migration per version, enforced.
 *
 * Supabase's ledger (`supabase_migrations.schema_migrations`) stores one row per
 * *version* — the numeric prefix — not per filename. Two files sharing a version
 * is therefore not a cosmetic clash: whichever applies first claims the version,
 * and the other can never be applied. `db push` skips it silently, because from
 * the ledger's point of view that version is already done.
 *
 * This has happened four times in two days, once per merge of `main` into a long
 * running branch, because concurrent workstreams pick timestamps independently
 * and nothing stopped them agreeing. Every occurrence was caught by hand, and
 * catching it by hand is exactly what fails the time nobody looks.
 *
 * The resolution rule, for whoever hits this next: **an applied filename cannot
 * move; an unhosted one can.** Check `AI/DECISIONS.md` for whether a migration
 * has reached hosted before renaming it, and renumber the unhosted one.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** The ledger's key: everything before the first underscore. */
function versionOf(file: string): string {
  return file.split("_")[0];
}

describe("migration versions", () => {
  it("gives every migration a distinct version", () => {
    const byVersion = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const version = versionOf(file);
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }

    const duplicates = [...byVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `${version}: ${files.join(" and ")}`);

    // The message carries the fix, because the person reading it is mid-merge
    // and the failure is otherwise cryptic.
    expect(
      duplicates,
      duplicates.length > 0
        ? `Two migrations share a version. The ledger stores one row per version, so the loser can never be applied. Renumber the migration that has NOT reached hosted (check AI/DECISIONS.md); an applied filename must not move.\n  ${duplicates.join("\n  ")}`
        : undefined,
    ).toEqual([]);
  });

  it("names every migration <version>_<description>.sql", () => {
    const malformed = migrationFiles().filter(
      (file) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(file),
    );

    expect(malformed).toEqual([]);
  });

  it("keeps versions monotonically increasing in sort order", () => {
    // Filename sort is the apply order, so a version that sorts before an
    // already-applied one would be skipped rather than run.
    const versions = migrationFiles().map(versionOf);
    const sorted = [...versions].sort();

    expect(versions).toEqual(sorted);
  });
});
