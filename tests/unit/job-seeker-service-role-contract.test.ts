import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every job_seeker table must revoke service_role explicitly somewhere in
 * the chain. Hosted Supabase grants every new public table to service_role
 * through ALTER DEFAULT PRIVILEGES; PGlite does not, so a missing revoke is
 * invisible to every behavior test and visible only to a hosted postflight
 * (20260902001700 is the one that found twelve of them). This pins the
 * convention so the next table cannot skip it.
 */

describe("job_seeker tables and the service_role revoke", () => {
  it("names every job_seeker table in an explicit revoke from service_role", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const sql = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(join(dir, file), "utf8"))
      .join("\n");
    const tables = [...new Set([...sql.matchAll(/create table if not exists public\.(job_seeker_[a-z_]+)/g)].map((match) => match[1]!))].sort();
    expect(tables.length).toBeGreaterThanOrEqual(18);
    const revoked = new Set<string>();
    for (const match of sql.matchAll(/revoke all(?: privileges)? on table public\.(job_seeker_[a-z_]+)\s+from[^;]*service_role/g)) {
      revoked.add(match[1]!);
    }
    // The contraction migration names its tables in a loop; read them from it.
    const contraction = readFileSync(join(dir, "20260902001700_job_seeker_service_role_contract.sql"), "utf8");
    for (const match of contraction.matchAll(/'(job_seeker_[a-z_]+)'/g)) revoked.add(match[1]!);
    const missing = tables.filter((table) => !revoked.has(table));
    expect(missing).toEqual([]);
  });
});
