// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The two security invariants `AGENTS.md` states, checked across the whole
 * migration chain rather than a subset of it.
 *
 * > Keep Row Level Security enabled for every exposed Supabase table.
 *
 * Several suites assert this for the tables they touch, and the whole-chain
 * position was verified once by hand on a real PostgreSQL cluster. Neither is a
 * standing guarantee: a new migration adding a table without RLS passes every
 * existing test, because no existing test knows the table exists. The gap is
 * widest exactly when it matters most — a table added in the same change that
 * exposes it.
 *
 * So this applies every migration and asks the catalogue, which means a new
 * table is covered the moment it exists, without anyone remembering to add it
 * to a list.
 *
 * The second invariant is the `service_role` ACL matrix. That role bypasses
 * RLS, so a table privilege granted to it is an unmediated path to the data.
 * The reviewed position is that it holds table privileges on exactly the four
 * GitHub ingress tables and reaches everything else through SECURITY DEFINER
 * functions. Widening that is a RED change under `RISK_CLASSIFICATION.md`, and
 * this makes the widening visible in the diff that causes it.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

/** The only tables `service_role` may hold direct table privileges on. */
const GITHUB_INGRESS_TABLES = [
  "github_change_requests",
  "github_installations",
  "github_repositories",
  "github_webhook_deliveries",
] as const;

/**
 * Tables that deliberately carry RLS with no policy, and why.
 *
 * RLS plus zero policies denies everything, which is the strongest possible
 * position — correct when the only legitimate access is through a SECURITY
 * DEFINER function. It is listed rather than tolerated so that a *new*
 * policyless table still fails: the difference between "locked on purpose" and
 * "protected and never wired up" is intent, and intent has to be written down.
 */
const INTENTIONALLY_POLICYLESS: Readonly<Record<string, string>> = Object.freeze({
  newsletter_subscribers:
    "Public-input table. Inserts happen only through public.subscribe_to_newsletter; "
    + "anon and authenticated hold no SELECT, INSERT, UPDATE, or DELETE privilege.",
});

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);

  const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
}, 600_000);

afterAll(async () => {
  await db?.close();
});

describe("row level security", () => {
  it("is enabled and forced on every public table", async () => {
    const result = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      select class.relname, class.relrowsecurity, class.relforcerowsecurity
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public' and class.relkind = 'r'
      order by class.relname
    `);

    // Named, not counted: a count tells you something broke, a list tells you what.
    const unprotected = result.rows
      .filter((row) => !row.relrowsecurity || !row.relforcerowsecurity)
      .map((row) => row.relname);

    expect(unprotected).toEqual([]);
    // Guards against a vacuous pass if the chain ever fails to apply.
    expect(result.rows.length).toBeGreaterThan(50);
  });

  it("carries a policy on every table except the ones locked shut on purpose", async () => {
    const result = await db.query<{ relname: string; policy_count: number }>(`
      select class.relname, count(policy.oid)::integer as policy_count
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_catalog.pg_policy policy on policy.polrelid = class.oid
      where namespace.nspname = 'public' and class.relkind = 'r'
      group by class.relname
      order by class.relname
    `);

    const policyless = result.rows.filter((row) => row.policy_count === 0).map((row) => row.relname);

    // Equality, not a subset check: a table that gains a policy should drop off
    // the allowlist, and a new policyless table should fail until someone says
    // why it is locked.
    expect(policyless).toEqual(Object.keys(INTENTIONALLY_POLICYLESS).sort());
  });
});

describe("the service_role ACL matrix", () => {
  it("holds table privileges on exactly the four GitHub ingress tables", async () => {
    const result = await db.query<{ table_name: string }>(`
      select distinct table_name
      from information_schema.role_table_grants
      where grantee = 'service_role' and table_schema = 'public'
      order by table_name
    `);

    const granted = result.rows.map((row) => row.table_name);

    // service_role bypasses RLS, so each entry here is an unmediated path to
    // the data. Widening this set is RED under RISK_CLASSIFICATION.md.
    expect(granted).toEqual([...GITHUB_INGRESS_TABLES].sort());
  });

  it("reaches everything else through SECURITY DEFINER functions instead", async () => {
    const result = await db.query<{ count: number }>(`
      select count(*)::integer as count
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public' and proc.prosecdef
    `);

    expect(result.rows[0].count).toBeGreaterThan(0);
  });
});

describe("anonymous access", () => {
  it("holds no write privilege on any public table", async () => {
    const result = await db.query<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema = 'public'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      order by table_name, privilege_type
    `);

    expect(result.rows).toEqual([]);
  });
});
