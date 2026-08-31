// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migrations = resolve(root, "supabase/migrations");
const finalMigrations = {
  18: "20260831001800_grok_deploy_readiness_runtime.sql",
  19: "20260831001900_grok_admission_version_null_fence.sql",
  20: "20260831002000_exact_graph_repository_workspace.sql",
  21: "20260831002100_grok_initial_wake_receipts.sql",
} as const;

async function createReleaseDatabase(finalVersion: keyof typeof finalMigrations): Promise<PGlite> {
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
    .filter((name) => name <= finalMigrations[finalVersion])
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
    [Array.from({ length: finalVersion }, (_, index) =>
      `20260831${String(index + 1).padStart(4, "0")}00`)],
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
     where migration.version not in (
       '20260831001800', '20260831001900',
       '20260831002000', '20260831002100'
     )
  `);
  return digest.rows[0]!.sha256;
}

async function dedicated019LedgerDigest(database: PGlite): Promise<string> {
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

async function prerequisite017LedgerDigest(database: PGlite): Promise<string> {
  const digest = await database.query<{ sha256: string }>(`
    select encode(sha256(convert_to(
      coalesce(jsonb_agg(to_jsonb(migration) order by migration.version), '[]'::jsonb)::text,
      'UTF8'
    )), 'hex') sha256
      from supabase_migrations.schema_migrations migration
     where migration.version <> '20260831001700'
  `);
  return digest.rows[0]!.sha256;
}

async function releaseSql(
  path: string,
  variables: Readonly<Record<string, string>>,
): Promise<string> {
  let sql = (await readFile(resolve(root, path), "utf8"))
    .replace(/^\\set .*$/gm, "")
    .replace(/\\gset/g, ";");
  for (const [name, value] of Object.entries(variables)) {
    sql = sql.replaceAll(`:'${name}'`, `'${value}'`);
  }
  return sql;
}

describe("Grok runtime release-chain native SQL", () => {
  let db: PGlite;
  let partialDbs: Array<{ version: 18 | 19 | 20; database: PGlite }> = [];

  beforeAll(async () => {
    const [v18, v19, v20, v21] = await Promise.all([
      createReleaseDatabase(18),
      createReleaseDatabase(19),
      createReleaseDatabase(20),
      createReleaseDatabase(21),
    ]);
    partialDbs = [
      { version: 18, database: v18 },
      { version: 19, database: v19 },
      { version: 20, database: v20 },
    ];
    db = v21;
  }, 240_000);

  afterAll(async () => {
    await Promise.all([db?.close(), ...partialDbs.map(({ database }) => database.close())]);
  });

  it("accepts every intermediate prefix and its exact installed-through postflight", async () => {
    for (const { version, database } of partialDbs) {
      const prefix = `${"1".repeat(version - 17)}${"0".repeat(21 - version)}`;
      const next = `20260831${String(version + 1).padStart(4, "0")}00`;
      const unrelated = await unrelatedLedgerDigest(database);
      if (version === 18) {
        const prerequisiteDigest = await prerequisite017LedgerDigest(database);
        const prerequisite = await releaseSql(
          ".github/grok-release/grok-read-only-research-runtime-preflight.sql",
          { operation: "verify", unrelated_ledger_sha256: prerequisiteDigest },
        );
        await expect(database.exec(prerequisite)).resolves.toBeDefined();
      }
      const preflight = await releaseSql(
        ".github/grok-release/grok-runtime-release-chain-preflight.sql",
        {
          operation: "probe",
          expected_next_version: next,
          unrelated_ledger_sha256: unrelated,
        },
      );
      await expect(database.exec(preflight)).resolves.toBeDefined();
      const state = await database.query<{ prefix: string }>(`
        select
          count(*) filter (where version='20260831001800')::text
          || count(*) filter (where version='20260831001900')::text
          || count(*) filter (where version='20260831002000')::text
          || count(*) filter (where version='20260831002100')::text prefix
          from supabase_migrations.schema_migrations
      `);
      expect(state.rows).toEqual([{ prefix }]);
      const postflight = await releaseSql(
        ".github/grok-release/grok-runtime-release-chain-postflight.sql",
        { installed_through: `20260831${String(version).padStart(4, "0")}00` },
      );
      await expect(database.exec(`begin; ${postflight} rollback;`)).resolves.toBeDefined();
    }
  }, 90_000);

  it("accepts the exact complete prefix and runs catalog/runtime checks without residue", async () => {
    const unrelated = await unrelatedLedgerDigest(db);
    const preflight = await releaseSql(
      ".github/grok-release/grok-runtime-release-chain-preflight.sql",
      {
        operation: "verify",
        expected_next_version: "complete",
        unrelated_ledger_sha256: unrelated,
      },
    );
    await expect(db.exec(preflight)).resolves.toBeDefined();

    const before = await db.query<{ events: number; launches: number; wakes: number }>(`
      select
        (select count(*)::integer from public.grok_events) events,
        (select count(*)::integer from public.grok_graph_launches) launches,
        (select count(*)::integer from public.grok_graph_wake_intents) wakes
    `);
    const postflight = await releaseSql(
      ".github/grok-release/grok-runtime-release-chain-postflight.sql",
      { installed_through: "20260831002100" },
    );
    await expect(db.exec(`begin; ${postflight} rollback;`)).resolves.toBeDefined();
    const after = await db.query<{ events: number; launches: number; wakes: number }>(`
      select
        (select count(*)::integer from public.grok_events) events,
        (select count(*)::integer from public.grok_graph_launches) launches,
        (select count(*)::integer from public.grok_graph_wake_intents) wakes
    `);
    expect(after.rows).toEqual(before.rows);
  }, 90_000);

  it("keeps the unchanged dedicated 019 native verifier valid after 020 and 021", async () => {
    const dedicatedDigest = await dedicated019LedgerDigest(db);
    const preflight = await releaseSql(
      ".github/grok-release/grok-admission-version-null-fence-preflight.sql",
      { operation: "verify", unrelated_ledger_sha256: dedicatedDigest },
    );
    const postflight = await releaseSql(
      ".github/grok-release/grok-admission-version-null-fence-postflight.sql",
      {},
    );
    await expect(db.exec(preflight)).resolves.toBeDefined();
    await expect(db.exec(postflight)).resolves.toBeDefined();
  }, 90_000);

  it("rejects a changed unrelated ledger, a target gap, and every later version", async () => {
    const unrelated = await unrelatedLedgerDigest(db);
    const exact = await releaseSql(
      ".github/grok-release/grok-runtime-release-chain-preflight.sql",
      {
        operation: "verify",
        expected_next_version: "complete",
        unrelated_ledger_sha256: unrelated,
      },
    );
    const wrongDigest = await releaseSql(
      ".github/grok-release/grok-runtime-release-chain-preflight.sql",
      {
        operation: "verify",
        expected_next_version: "complete",
        unrelated_ledger_sha256: "0".repeat(64),
      },
    );
    await expect(db.exec(wrongDigest)).rejects.toThrow(
      /grok_runtime_release_unrelated_ledger_changed/i,
    );

    await db.exec("begin; delete from supabase_migrations.schema_migrations where version='20260831002000';");
    await expect(db.exec(exact)).rejects.toThrow(
      /grok_runtime_release_ledger_is_not_one_exact_prefix/i,
    );
    await db.exec("rollback;");

    await db.exec("begin; insert into supabase_migrations.schema_migrations(version) values ('20260831002200');");
    await expect(db.exec(exact)).rejects.toThrow(
      /grok_runtime_release_later_version_present/i,
    );
    await db.exec("rollback;");
  });
});
