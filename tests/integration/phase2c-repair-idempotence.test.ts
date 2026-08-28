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

/**
 * Phase 2E added two more dependants, and they bind harder than a constraint.
 * `breaker_suppression_reason` and `portfolio_capacity_overview` are
 * `language sql`, whose bodies PostgreSQL parses and resolves *at creation*, so
 * both files fail outright on a database where `resource_breakers` is missing —
 * they cannot be created and then repaired later.
 *
 * For the owner this sharpens the ordering: the repair below has to run before
 * any of these three, not merely before the constraint.
 */
const LATER_DEPENDANTS = [
  "20260815000500_phase2e_breaker_aware_scheduling.sql",
  "20260815000600_phase2e_portfolio_visibility.sql",
] as const;

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

/**
 * `20260814002200_graph_anchors` failed the same way and needs the same remedy:
 * its enum `anchor_kind` exists, so the original file dies at its first
 * statement with `42710` before reaching the four tables it creates.
 */
const ANCHORS = "20260814002200_graph_anchors.sql";
const HOSTED_CATALOG_CONTAINMENT = [
  "20260822000850_normalize_hosted_pre_repair_function_acls.sql",
  "20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql",
  "20260822001000_factory_any_model_record_only.sql",
] as const;
const ANCHOR_TABLES = [
  "claim_acceptable_anchors", "claim_anchors", "graph_anchors", "node_run_claims",
] as const;

async function anchorRepairSql(): Promise<string> {
  const raw = await readFile(resolve(repositoryRoot, "scripts/repair-20260814002200.sql"), "utf8");
  return raw.slice(0, raw.indexOf("-- Verify."));
}

describe("the graph anchors repair", () => {
  it("completes a migration that stopped after its enums", async () => {
    const db = await bootstrap();
    // The release-tail containment migrations deliberately fail closed when
    // this legacy function/catalog is missing. They are downstream consumers,
    // not prerequisites for reconstructing and repairing the historical
    // half-applied state under test here.
    await applyChain(db, { skip: [ANCHORS, ...HOSTED_CATALOG_CONTAINMENT] });

    // Reproduce the hosted state: the enums landed, nothing after them did.
    const original = await readFile(resolve(migrationsDirectory, ANCHORS), "utf8");
    await db.exec(original.slice(0, original.indexOf("create table public.graph_anchors")));

    // The owner's error, reproduced.
    await expect(db.exec(original)).rejects.toThrow(/already exists/i);

    await db.exec(await anchorRepairSql());

    const { rows } = await db.query<{ relname: string; ok: boolean }>(
      `select relname, (relrowsecurity and relforcerowsecurity) as ok from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1) order by relname`,
      [ANCHOR_TABLES as unknown as string[]],
    );
    expect(rows.map((r) => r.relname)).toEqual([...ANCHOR_TABLES]);
    for (const row of rows) expect(row.ok, `${row.relname} missing RLS`).toBe(true);

    // The column the failed run never reached.
    const { rows: column } = await db.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'graph_verifications'
          and column_name = 'anchor_count'`,
    );
    expect(column).toHaveLength(1);

    await db.close();
  }, 300_000);

  it("changes nothing when the migration already applied in full", async () => {
    const db = await bootstrap();
    await applyChain(db);

    await db.exec(await anchorRepairSql());

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from pg_policies
        where schemaname = 'public' and tablename = any($1)`,
      [ANCHOR_TABLES as unknown as string[]],
    );
    // Recreated, not duplicated.
    expect(rows[0].count).toBe(4);

    // This migration seeds reference rows, which is the one thing in it that
    // would change *data* rather than schema on a re-run. The first version of
    // the repair duplicated them and this assertion is why that was caught.
    const { rows: seeded } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.claim_acceptable_anchors`,
    );
    expect(seeded[0].count).toBe(16);

    await db.close();
  }, 300_000);
});

describe("the phase2c repair", () => {
  it("completes a half-applied migration", async () => {
    const db = await bootstrap();
    // Everything except the target, then only the first table it creates —
    // reconstructing the exact state hosted is in.
    await applyChain(db, { skip: [TARGET, DEPENDS_ON_TARGET, ...LATER_DEPENDANTS] });

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

    // The Phase 2E files are the harder test of the same property: their SQL
    // function bodies are resolved at creation, so they only apply at all if
    // `resource_breakers` is genuinely there with its real columns.
    for (const dependant of LATER_DEPENDANTS) await applyOne(db, dependant);
    const { rows: scheduling } = await db.query<{ suppressed: string | null }>(
      `select public.breaker_suppression_reason(
         '00000000-0000-4000-8000-000000000000'::uuid, 'openai', 'gpt-5.3-codex', now()
       ) as suppressed`,
    );
    expect(scheduling[0].suppressed).toBeNull();

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

/**
 * `scripts/hosted-ledger-record-verified.sql` writes ledger rows, which is the
 * one operation in this repair sequence that cannot be undone by pushing.
 *
 * Recording a version whose objects are missing makes `supabase db push` skip
 * that migration forever: it reads as applied, so it is never run, and nothing
 * short of deleting the row brings it back. The file is written so that outcome
 * is unreachable rather than merely discouraged — it recomputes presence from
 * the catalogue and its `where` clause cannot select an incomplete version.
 *
 * That is a safety property, so it is tested by trying to violate it.
 */
describe("the verified ledger recorder", () => {
  async function recorderSql(): Promise<string> {
    const raw = await readFile(
      resolve(repositoryRoot, "scripts/hosted-ledger-record-verified.sql"),
      "utf8",
    );
    return raw.slice(0, raw.indexOf("-- Confirm."));
  }

  async function bootstrapWithLedger(): Promise<PGlite> {
    const db = await bootstrap();
    // Replay the schema as a clean, ledgerless database first. Protected graph
    // migrations deliberately reject a present-but-empty hosted ledger because
    // that state falsely claims there is authoritative migration history.
    // The empty ledger belongs to the recorder fixture, not to migration replay.
    await applyChain(db);
    await db.exec(`
      create schema if not exists supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key);
    `);
    return db;
  }

  async function ledgerCount(db: PGlite): Promise<number> {
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from supabase_migrations.schema_migrations",
    );
    return rows[0].count;
  }

  it("records every fully-present migration, and stays put on a second run", async () => {
    const db = await bootstrapWithLedger();
    const sql = await recorderSql();

    await db.exec(sql);
    const first = await ledgerCount(db);
    expect(first).toBeGreaterThan(0);

    await db.exec(sql);
    expect(await ledgerCount(db)).toBe(first);

    await db.close();
  }, 300_000);

  it("refuses to record a version whose objects are not all there", async () => {
    const db = await bootstrapWithLedger();
    const sql = await recorderSql();
    await db.exec(sql);

    // Make 20260814002200 incomplete — three of its four tables — and forget it.
    await db.exec("drop table public.claim_anchors cascade;");
    await db.exec("delete from supabase_migrations.schema_migrations where version = '20260814002200';");

    await db.exec(sql);

    const { rows } = await db.query(
      "select 1 from supabase_migrations.schema_migrations where version = '20260814002200'",
    );
    // Recording it here would make `db push` skip it permanently.
    expect(rows, "an incomplete migration was recorded as applied").toEqual([]);

    await db.close();
  }, 300_000);
});
