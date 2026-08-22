// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The clear controls' function ACL, against real PostgreSQL.
 *
 * `20260822000800` ends each function with `revoke all ... from public, anon`
 * and a grant to `authenticated`. On a database with no default privileges
 * that produces the intended result, which is why every local test passed and
 * why the apply's own gate reported success. Hosted Supabase carries ALTER
 * DEFAULT PRIVILEGES granting EXECUTE on new public functions to anon,
 * authenticated and service_role at CREATE FUNCTION time, so there the revoke
 * left `service_role` holding a direct grant nobody revoked. Probe run
 * 32590061431 measured `service_may_execute = t` on both.
 *
 * PGlite cannot reproduce that by itself — it has no default privileges
 * configured for these roles — so the fixture reproduces the *result* instead:
 * grant the three roles EXECUTE, which is the state a hosted CREATE FUNCTION
 * leaves behind, then run the contraction against it.
 *
 * A test that only ran the chain top to bottom would prove nothing here. It
 * would assert the absence of a grant that was never present, and pass just as
 * happily against `20260822000800` alone — which is precisely the migration
 * that did not close this.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");
const contractionFile = "20260822001200_contract_clear_control_function_acls.sql";

const signatures = [
  "public.clear_backlog_tasks(uuid,text,boolean)",
  "public.clear_all_pipelines(uuid,text,boolean)",
] as const;

let db: PGlite;
let contractionSql: string;

/** What each role can actually do, which is what a caller experiences. */
async function privileges(signature: string) {
  const { rows } = await db.query<{
    anon: boolean;
    member: boolean;
    service: boolean;
    acl_entries: number;
    acl: string | null;
  }>(
    `select has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') as anon,
            has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') as member,
            has_function_privilege('service_role', to_regprocedure($1), 'EXECUTE') as service,
            (select count(*)::int from aclexplode(p.proacl)) as acl_entries,
            p.proacl::text as acl
       from pg_proc p
      where p.oid = to_regprocedure($1)`,
    [signature],
  );
  return rows[0];
}

/**
 * The state hosted was actually measured in, restored before each case.
 *
 * Not "grant all three roles EXECUTE": that would be the state at CREATE
 * FUNCTION time, and `20260822000800` then revoked anon a few lines later. The
 * hosted database probe run 32590061431 read had `anon_may_execute = f` and
 * `service_may_execute = t`, so that is the input this migration has to
 * handle, and reproducing anything else would test a database that never
 * existed.
 */
async function reproduceHostedState() {
  for (const signature of signatures) {
    await db.exec(`
      revoke all on function ${signature} from public, anon, authenticated, service_role;
      grant execute on function ${signature} to authenticated, service_role;
    `);
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
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

  const files = (await readdir(migrationsRoot)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  expect(files.at(-1)).toBe(contractionFile);
  contractionSql = await readFile(resolve(migrationsRoot, contractionFile), "utf8");

  // Everything up to but not including the contraction: the database as it
  // stood when the hole was live.
  for (const file of files.filter((name) => name !== contractionFile)) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the clear controls' EXECUTE grants", () => {
  it("survives service_role when only public and anon are revoked", async () => {
    // The defect itself, stated as a passing assertion: 20260822000800 has
    // already run, and this is what hosted looked like afterwards.
    await reproduceHostedState();

    for (const signature of signatures) {
      const state = await privileges(signature);
      expect(state.member).toBe(true);
      expect(state.anon).toBe(false);
      expect(state.service).toBe(true);
    }
  });

  it("holds owner and authenticated only once the contraction runs", async () => {
    await reproduceHostedState();
    await db.exec(contractionSql);

    for (const signature of signatures) {
      const state = await privileges(signature);
      expect(state.member).toBe(true);
      expect(state.anon).toBe(false);
      expect(state.service).toBe(false);
      // Two entries, not "no service_role entry": a grant to a role nobody
      // thought to name is the whole failure mode, so the count is asserted
      // rather than the absence of the one role already known about.
      expect(state.acl_entries).toBe(2);
      expect(state.acl).toContain("authenticated=X/postgres");
      expect(state.acl).not.toContain("service_role");
      expect(state.acl).not.toContain("anon=");
    }
  });

  it("is replayable, and re-closes a grant handed back afterwards", async () => {
    await db.exec(contractionSql);
    await reproduceHostedState();
    await db.exec(contractionSql);

    for (const signature of signatures) {
      const state = await privileges(signature);
      expect(state.service).toBe(false);
      expect(state.acl_entries).toBe(2);
    }
  });

  it("refuses to run when a clear control is missing", async () => {
    await reproduceHostedState();
    await db.exec("begin");
    await db.exec("drop function public.clear_all_pipelines(uuid, text, boolean);");
    await expect(db.exec(contractionSql)).rejects.toThrow(/20260822001200 preflight/);
    await db.exec("rollback");

    // The rollback must actually restore it, or every later case is testing a
    // database that lost a function.
    const restored = await privileges("public.clear_all_pipelines(uuid,text,boolean)");
    expect(restored).toBeTruthy();
  });

  it("refuses to run when anon can already execute a clear control", async () => {
    await reproduceHostedState();
    await db.exec("begin");
    await db.exec(
      "grant execute on function public.clear_backlog_tasks(uuid, text, boolean) to anon;",
    );
    await expect(db.exec(contractionSql)).rejects.toThrow(/20260822001200 preflight/);
    await db.exec("rollback");
  });
});
