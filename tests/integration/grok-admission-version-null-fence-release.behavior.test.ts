// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migrations = resolve(root, "supabase/migrations");
const targetMigration = "20260831001900_grok_admission_version_null_fence.sql";
const prerequisiteVersions = Array.from({ length: 17 }, (_, index) =>
  `20260831${String(index + 1).padStart(4, "0")}00`);

async function createReleaseDatabase(includeTarget: boolean): Promise<PGlite> {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  for (const file of (await readdir(migrations))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .filter((name) => includeTarget || name < targetMigration)
    .sort()) {
    await database.exec(await readFile(resolve(migrations, file), "utf8"));
  }
  await database.exec(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text primary key
    );
  `);
  await database.query(
    "insert into supabase_migrations.schema_migrations(version) select unnest($1::text[])",
    [includeTarget ? [...prerequisiteVersions, "20260831001900"] : prerequisiteVersions],
  );
  return database;
}

async function unrelatedLedgerDigest(database: PGlite): Promise<string> {
  const digest = await database.query<{ sha256: string }>(`
    select encode(sha256(convert_to(
      coalesce(jsonb_agg(to_jsonb(migration) order by migration.version), '[]'::jsonb)::text,
      'UTF8'
    )), 'hex') sha256
      from supabase_migrations.schema_migrations migration
     where migration.version <> '20260831001900'
  `);
  return digest.rows[0]!.sha256;
}

async function releasePreflight(operation: "probe" | "verify", digest: string): Promise<string> {
  return (await readFile(resolve(
    root,
    ".github/grok-release/grok-admission-version-null-fence-preflight.sql",
  ), "utf8"))
    .replace(/^\\set .*$/gm, "")
    .replace(/\\gset/g, ";")
    .replace(/:'operation'/g, `'${operation}'`)
    .replace(/:'unrelated_ledger_sha256'/g, `'${digest}'`);
}

describe("Grok admission-version null-fence protected release SQL", () => {
  let db: PGlite;
  let probeDb: PGlite;

  beforeAll(async () => {
    [probeDb, db] = await Promise.all([
      createReleaseDatabase(false),
      createReleaseDatabase(true),
    ]);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([probeDb?.close(), db?.close()]);
  });

  it("passes the absent-target preflight and rehearses only 019 under rollback", async () => {
    const digest = await unrelatedLedgerDigest(probeDb);
    await expect(probeDb.exec(await releasePreflight("probe", digest))).resolves.toBeDefined();

    const migration = await readFile(resolve(migrations, targetMigration), "utf8");
    const postflight = (await readFile(resolve(
      root,
      ".github/grok-release/grok-admission-version-null-fence-postflight.sql",
    ), "utf8")).replace(/^\\set .*$/gm, "");
    await expect(probeDb.exec(`
      begin;
      ${migration}
      insert into supabase_migrations.schema_migrations(version)
      values ('20260831001900');
      ${postflight}
    `)).resolves.toBeDefined();

    const residue = await probeDb.query<{ functions: number; ledger: number }>(`
      select
        (select count(*)::integer from pg_proc
          where proname in (
            'record_grok_specialist_roster_v2_as_server',
            'launch_grok_full_lifecycle_v4_as_server',
            'launch_grok_read_only_research_v2_as_server'
          )) functions,
        (select count(*)::integer from supabase_migrations.schema_migrations
          where version='20260831001900') ledger
    `);
    expect(residue.rows).toEqual([{ functions: 0, ledger: 0 }]);
  }, 60_000);

  it("executes the installed exact-identity and stopped-state verify preflight", async () => {
    const digest = await unrelatedLedgerDigest(db);
    await expect(db.exec(await releasePreflight("verify", digest))).resolves.toBeDefined();
  });

  it("executes exact catalog ACL and native adverse/replay probes under rollback", async () => {
    const postflight = (await readFile(resolve(
      root,
      ".github/grok-release/grok-admission-version-null-fence-postflight.sql",
    ), "utf8")).replace(/^\\set .*$/gm, "");

    await expect(db.exec(postflight)).resolves.toBeDefined();
    const state = await db.query<{
      admissions: number;
      graphs: number;
      launches: number;
      ledger: number;
      rosters: number;
    }>(`
      select
        (select count(*)::integer from public.grok_specialist_admissions) rosters,
        (select count(*)::integer from public.grok_execution_admissions) admissions,
        (select count(*)::integer from public.graphs) graphs,
        (select count(*)::integer from public.grok_graph_launches) launches,
        (select count(*)::integer from supabase_migrations.schema_migrations
          where version='20260831001900') ledger
    `);
    expect(state.rows).toEqual([{
      admissions: 0,
      graphs: 0,
      launches: 0,
      ledger: 1,
      rosters: 0,
    }]);
  }, 60_000);
});
