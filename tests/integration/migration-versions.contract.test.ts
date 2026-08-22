// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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

  it("keeps every already-hosted 20260822 prerequisite name and byte identity immutable", () => {
    const hosted = [
      ["20260822000400_job_seeker_resume_extraction.sql", 13_702, "0faa6d4174f01a43abffda463d4dbe9dc60d82be54d9207011e4c064c4f0b465"],
      ["20260822000500_job_seeker_extraction_grant_contract.sql", 2_852, "c5709783bdaa3919e65809493345b4cfbc527121c2bf44a3a7fe98e0e7e9b1ee"],
      ["20260822000700_clear_surface_activity_types.sql", 455, "184b942ef3511d1774ba6a26b9e93daf19326804d41e507ad6c48f1f6447b42b"],
      ["20260822000800_clear_backlog_and_pipelines.sql", 7_525, "e85444206c1e9c290d305e60812d47f32e9342dfd920749116ab7df143532a5a"],
    ] as const;

    for (const [filename, size, sha256] of hosted) {
      expect(migrationFiles().filter((file) => versionOf(file) === versionOf(filename)))
        .toEqual([filename]);
      const canonical = readFileSync(resolve(migrationsDirectory, filename), "utf8")
        .replace(/\r\n?/g, "\n");
      expect(Buffer.byteLength(canonical)).toBe(size);
      expect(createHash("sha256").update(canonical).digest("hex")).toBe(sha256);
    }
  });
});
