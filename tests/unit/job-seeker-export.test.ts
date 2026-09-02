import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildManifest, EXPORT_BASIS, EXPORT_LIMIT, EXPORT_TABLES, exportFilename, NOT_PERSONAL } from "@/lib/job-seeker/export";

/**
 * The export roster (ADR-247) is the contract: every job_seeker table in
 * the migrations is either exported or named as not personal, no blob
 * column is inlined, and the manifest carries the basis.
 */

function jobSeekerTablesInMigrations(): string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  const tables = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    for (const match of sql.matchAll(/create table if not exists public\.(job_seeker_[a-z_]+)/g)) {
      tables.add(match[1]!);
    }
  }
  return [...tables].sort();
}

describe("the export roster", () => {
  it("covers every job_seeker table in the migrations, or names it as not personal", () => {
    const covered = [...EXPORT_TABLES.map((entry) => entry.table), ...NOT_PERSONAL.map((entry) => entry.table)].sort();
    expect(covered).toEqual(jobSeekerTablesInMigrations());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("never inlines the bytes of an uploaded file", () => {
    const uploads = EXPORT_TABLES.find((entry) => entry.table === "job_seeker_uploads")!;
    expect(uploads.columns).not.toBe("*");
    expect(uploads.columns.split(",").map((column) => column.trim())).not.toContain("data");
  });

  it("builds a manifest that carries the outcomes, the limit and the basis", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const manifest = buildManifest(
      [{ table: "job_seeker_jobs", label: "Recorded jobs", rows: 3, truncated: false, error: null }],
      now,
    );
    expect(manifest.exportedAt).toBe("2026-09-02T12:00:00.000Z");
    expect(manifest.limitPerTable).toBe(EXPORT_LIMIT);
    expect(manifest.tables).toHaveLength(1);
    expect(manifest.notPersonal.map((entry) => entry.table)).toEqual(["job_seeker_posting_sightings"]);
    expect(manifest.basis).toBe(EXPORT_BASIS);
    expect(exportFilename(now)).toBe("job-seeker-export-2026-09-02.json");
  });
});
