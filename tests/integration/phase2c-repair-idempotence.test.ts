// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * `scripts/repair-20260814000210.sql` must work against every state hosted
 * might actually be in.
 *
 * `20260814000210_phase2c_resource_persistence` applied partially against
 * hosted: `resource_breakers` exists, so re-running the original file fails at
 * its first statement with `42P07` — before reaching the two tables, the
 * policies, the triggers and the grants that never ran. The repair is that same
 * migration made idempotent.
 *
 * A repair for production schema that has only been reasoned about is not a
 * repair, it is a suggestion. Both states are reconstructed here on real
 * PostgreSQL and the file is run against each.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const TARGET = "20260814000210_phase2c_resource_persistence.sql";
const TABLES = ["resource_breakers", "resource_breaker_events", "resource_assignments"] as const;

async function bootstrap(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid()
    returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.jwt()
    returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  return db;
}

/**
 * `20260814002300_guard_resource_assignment_candidates` adds a constraint **to**
 * `resource_assignments`, so it cannot apply until `20260814000210` is complete.
 * Reconstructing the half-applied state therefore means holding both back, and
 * that dependency is a real ordering constraint for the owner: the repair has to
 * run before `002300`, not after.
 */
const DEPENDS_ON_TARGET = "20260814002300_guard_resource_assignment_candidates.sql";

async function applyChain(db: PGlite, options: { skip?: readonly string[] } = {}): Promise<void> {
  const skip = new Set(options.skip ?? []);
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  for (const file of files) {
    if (skip.has(file)) continue;
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
}

async function applyOne(db: PGlite, file: string): Promise<void> {
  await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
}

async function repairSql(): Promise<string> {
  const raw = await readFile(resolve(repositoryRoot, "scripts/repair-20260814000210.sql"), "utf8");
  // The trailing verification select is for a human in the SQL editor.
  return raw.slice(0, raw.indexOf("-- Verify."));
}

async function presentTables(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ relname: string }>(
    `select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)
      order by relname`,
    [TABLES as unknown as string[]],
  );
  return rows.map((row) => row.relname);
}

describe("the phase2c repair", () => {
  it("completes a half-applied migration", async () => {
    const db = await bootstrap();
    // Everything except the target, then only the first table it creates —
    // reconstructing the exact state hosted is in.
    await applyChain(db, { skip: [TARGET, DEPENDS_ON_TARGET] });

    const original = await readFile(resolve(migrationsDirectory, TARGET), "utf8");
    const firstTable = original.slice(0, original.indexOf("comment on table public.resource_breakers"));
    await db.exec(firstTable);

    expect(await presentTables(db)).toEqual(["resource_breakers"]);

    // The original file cannot recover from here. This is the failure the owner
    // hit in the SQL editor, reproduced.
    await expect(db.exec(original)).rejects.toThrow(/already exists/i);

    await db.exec(await repairSql());

    expect(await presentTables(db)).toEqual([
      "resource_assignments",
      "resource_breaker_events",
      "resource_breakers",
    ]);

    // The grants and RLS the failed run never reached.
    const { rows: rls } = await db.query<{ relname: string; ok: boolean }>(
      `select relname, (relrowsecurity and relforcerowsecurity) as ok
         from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [TABLES as unknown as string[]],
    );
    expect(rls).toHaveLength(3);
    for (const row of rls) expect(row.ok, `${row.relname} missing RLS or FORCE RLS`).toBe(true);

    // Browser roles read and nothing more; writes go through the RPCs.
    const { rows: writes } = await db.query(
      `select 1 from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
          and table_name = any($1) and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      [TABLES as unknown as string[]],
    );
    expect(writes).toEqual([]);

    // And the migration that depends on this one now applies, which is the
    // proof that the repair left the schema in a state the rest of the chain
    // can build on rather than merely one that looks right.
    await applyOne(db, DEPENDS_ON_TARGET);
    const { rows: guarded } = await db.query(
      `select 1 from pg_constraint
        where conname = 'resource_assignments_candidates_not_sensitive'`,
    );
    expect(guarded).toHaveLength(1);

    await db.close();
  }, 300_000);

  it("changes nothing when the migration already applied in full", async () => {
    const db = await bootstrap();
    await applyChain(db);

    const before = await presentTables(db);
    expect(before).toHaveLength(3);

    // Idempotence is the property that makes this safe to hand to an owner who
    // is not certain which state their database is in.
    await db.exec(await repairSql());

    expect(await presentTables(db)).toEqual(before);

    const { rows: policies } = await db.query<{ count: number }>(
      `select count(*)::int as count from pg_policies
        where schemaname = 'public' and tablename = any($1)`,
      [TABLES as unknown as string[]],
    );
    // Recreated, not duplicated: one member-select policy per table.
    expect(policies[0].count).toBe(3);

    await db.close();
  }, 300_000);
});
