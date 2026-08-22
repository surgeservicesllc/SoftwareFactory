// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * 20260822001300 removes the hosted service_role EXECUTE overgrant from
 * reject_activity_event_mutation().
 *
 * 20260812000300 revoked the guard function from PUBLIC, anon, and
 * authenticated but not service_role, because locally that grant never
 * existed. Hosted Supabase grants EXECUTE on new functions to anon,
 * authenticated, and service_role through ALTER DEFAULT PRIVILEGES, so the
 * revoke left service_role holding a live grant — probe run 32599284961
 * measured it as the one containment clause still refusing the protected
 * chain. PGlite has no default privileges either, so a test that only
 * replays the chain would pass without exercising the contraction at all;
 * the drift case reproduces the hosted grant first, the same way the
 * job-seeker grant-contract test does.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const contractMigration = "20260822001300_contract_audit_guard_function_acl.sql";

// The protected factory-any-model-record-only chain applies only through its
// atomic scope; hosted runs this contract before it, so the primary replay
// mirrors that order.
const protectedChain = new Set([
  "20260822000300_contract_bot_mutator_acls.sql",
  "20260822000850_normalize_hosted_pre_repair_function_acls.sql",
  "20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql",
  "20260822001000_factory_any_model_record_only.sql",
  "20260822001100_contract_resume_extraction_function_acl.sql",
  "20260822001200_contract_clear_function_acls.sql",
]);

const postureQuery = `
  select
    (select count(*) from aclexplode(p.proacl)) as acl_entries,
    p.proacl::text as proacl,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
    l.lanname = 'plpgsql'
      and p.prokind = 'f' and p.provolatile = 'v'
      and p.prorettype = 'trigger'::regtype
      and not p.prosecdef
      and p.proconfig = array['search_path=pg_catalog']::text[]
      and pg_get_userbyid(p.proowner) = 'postgres'
      and btrim(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n'), E' \n') =
        E'begin\n  raise exception using errcode = ''55000'', message = ''activity events are append-only'';\nend;'
      as identity_exact
  from pg_proc p
  join pg_language l on l.oid = p.prolang
  where p.oid = to_regprocedure('public.reject_activity_event_mutation()')
`;

type PostureRow = {
  acl_entries: number;
  anon_execute: boolean;
  authenticated_execute: boolean;
  identity_exact: boolean;
  proacl: string;
  service_role_execute: boolean;
};

async function freshDb() {
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
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  return db;
}

async function applyChain(db: PGlite, skip: (file: string) => boolean) {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  for (const file of files) {
    if (skip(file)) continue;
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
}

async function posture(db: PGlite): Promise<PostureRow> {
  const result = await db.query<PostureRow>(postureQuery);
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

function expectContracted(row: PostureRow) {
  expect(row.identity_exact).toBe(true);
  expect(row.acl_entries).toBe(1);
  expect(row.proacl).toBe("{postgres=X/postgres}");
  expect(row.anon_execute).toBe(false);
  expect(row.authenticated_execute).toBe(false);
  expect(row.service_role_execute).toBe(false);
}

describe("20260822001300 audit guard ACL contract", () => {
  it("is a no-op on the already-clean local chain", async () => {
    const db = await freshDb();
    try {
      await applyChain(db, (file) => protectedChain.has(file));
      expectContracted(await posture(db));
    } finally {
      await db.close();
    }
  }, 240_000);

  it("removes the reproduced hosted service_role default grant", async () => {
    const db = await freshDb();
    try {
      await applyChain(
        db,
        (file) => protectedChain.has(file) || file === contractMigration,
      );
      // Reproduce the hosted input: Supabase default privileges granted
      // EXECUTE to service_role at CREATE time and nothing revoked it.
      await db.exec(`
        grant execute on function public.reject_activity_event_mutation()
          to service_role;
      `);
      const drifted = await posture(db);
      expect(drifted.acl_entries).toBe(2);
      expect(drifted.service_role_execute).toBe(true);

      await db.exec(
        await readFile(resolve(migrationsDirectory, contractMigration), "utf8"),
      );
      expectContracted(await posture(db));
    } finally {
      await db.close();
    }
  }, 240_000);

  it("refuses an ACL that is neither the clean nor the known hosted input", async () => {
    const db = await freshDb();
    try {
      await applyChain(
        db,
        (file) => protectedChain.has(file) || file === contractMigration,
      );
      await db.exec(`
        grant execute on function public.reject_activity_event_mutation()
          to anon;
      `);
      await expect(
        db.exec(
          await readFile(resolve(migrationsDirectory, contractMigration), "utf8"),
        ),
      ).rejects.toThrow(/identity or known ACL input drifted/);
    } finally {
      await db.close();
    }
  }, 240_000);

  it("stays exact on a full replay including the protected chain", async () => {
    const db = await freshDb();
    try {
      await applyChain(db, () => false);
      expectContracted(await posture(db));
    } finally {
      await db.close();
    }
  }, 240_000);
});
