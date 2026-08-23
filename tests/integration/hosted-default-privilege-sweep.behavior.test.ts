// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Every migration, replayed on a database configured the way hosted Supabase
 * configures one.
 *
 * Three times now the same sentence has shipped: a migration ends
 * `revoke all on function ... from public` (or `from public, anon`), grants
 * `authenticated`, and believes it is done. Hosted Supabase carries ALTER
 * DEFAULT PRIVILEGES on the `public` schema granting new routines to anon,
 * authenticated and service_role at CREATE time, so whichever role the revoke
 * did not name keeps a direct grant.
 *
 *   20260822000500  left service_role on apply_resume_extraction  (ADR-118)
 *   20260822000800  left service_role on the two clear controls   (ADR-120)
 *   20260815000700  left anon on archive_project/unarchive_project
 *
 * The first two were found by a hosted readback, after shipping. This file
 * exists because they did not have to be.
 *
 * The repository's memory recorded that "PGlite cannot reproduce this — it has
 * no default privileges configured for these roles", and concluded that only a
 * hosted readback could find it. The first half is true and the second does not
 * follow: PGlite has no default privileges *by default*, and a test may simply
 * configure them. That is all this does.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

/**
 * The protected repair chain is excluded, and only that.
 *
 * These four freeze an exact catalog fingerprint taken from the one hosted
 * database they were written for, so they correctly refuse any other database —
 * including this one. Excluding them is not a convenience: running them here
 * would test the fingerprint rather than the grants.
 *
 * Named individually rather than as "everything from 20260822000900", so a
 * later ordinary migration is applied instead of silently skipped for sorting
 * above them. Excluding them hides nothing this file looks for: 01100 and
 * 01200 contract service_role, and anon was already revoked on those functions
 * by 00500 and 00800.
 */
const PROTECTED_CHAIN = new Set([
  "20260822000900",
  "20260822001000",
  "20260822001100",
  "20260822001200",
]);

/**
 * Volatile SECURITY DEFINER functions an unauthenticated caller may execute.
 *
 * One entry, and it earns it: the marketing newsletter form is public by
 * design. Anything else appearing here is a migration that revoked the roles
 * it remembered instead of the roles that exist.
 */
const ANON_MAY_EXECUTE = new Set(["subscribe_to_newsletter"]);

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

  // The hosted condition. Everything created after this line is granted to the
  // three roles at CREATE time, exactly as it is on Supabase.
  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on routines to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);

  const files = (await readdir(migrationsRoot))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .filter((name) => !PROTECTED_CHAIN.has(name.slice(0, 14)))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
}, 300_000);

afterAll(async () => {
  await db?.close();
});

describe("the chain, under hosted default privileges", () => {
  it("lets no unauthenticated caller execute a function that changes state", async () => {
    /*
     * Volatile, because that is what separates a mutator from the membership
     * predicates. can_manage_organization and its siblings are `stable` and
     * *must* stay anon-executable — RLS policies call them as the querying
     * role, and revoking anon would break every policy on the database. They
     * answer one boolean about the caller's own membership and require
     * auth.uid(), so reaching them proves nothing and changes nothing.
     *
     * Trigger functions are excluded for a different reason: a trigger runs as
     * the table owner whatever the grant says, so an EXECUTE grant on one is
     * inert.
     */
    const { rows } = await db.query<{ proname: string; args: string }>(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.prokind = 'f'
         and p.prosecdef
         and p.provolatile = 'v'
         and p.prorettype <> 'trigger'::regtype
         and has_function_privilege('anon', p.oid, 'EXECUTE')
       order by 1
    `);

    const unexpected = rows.filter((row) => !ANON_MAY_EXECUTE.has(row.proname));
    expect(
      unexpected.map((row) => `${row.proname}(${row.args})`),
      "a volatile SECURITY DEFINER function is reachable by anon; the migration that "
      + "created it revoked the roles it remembered rather than the roles that exist",
    ).toEqual([]);
  });

  it("reproduces the condition rather than assuming it", async () => {
    /*
     * The guard above is only worth anything if the default privileges are
     * actually in force — otherwise it passes on a database where nothing was
     * ever granted, which is precisely the blind spot it exists to remove.
     *
     * Asked as *direct ACL entries*, not as has_function_privilege. PostgreSQL
     * grants EXECUTE to PUBLIC on every new function, so anon reads as
     * privileged through PUBLIC whether or not the hosted default exists —
     * checking effective privilege here would pass on a database with no
     * default privileges at all. Mutation-checked: deleting the routines line
     * from the harness above must fail this, and asking the effective-privilege
     * way it did not.
     */
    await db.exec(`
      create table public.sweep_probe_table (id int);
      create function public.sweep_probe_function() returns int language sql volatile as $$ select 1 $$;
    `);
    const { rows } = await db.query<{
      table_grantees: string[];
      function_grantees: string[];
    }>(`
      select
        (select array_agg(distinct pg_get_userbyid(acl.grantee) order by pg_get_userbyid(acl.grantee))
           from pg_class c, aclexplode(c.relacl) acl
          where c.oid = 'public.sweep_probe_table'::regclass
            and acl.grantee <> 0) as table_grantees,
        (select array_agg(distinct pg_get_userbyid(acl.grantee) order by pg_get_userbyid(acl.grantee))
           from pg_proc p, aclexplode(p.proacl) acl
          where p.oid = 'public.sweep_probe_function()'::regprocedure
            and acl.grantee <> 0) as function_grantees
    `);

    /*
     * Asserted per object kind, not as one combined list. Unioning them lets
     * the surviving table default privilege stand in for a removed routine one
     * — mutation-checked, and the union form did exactly that.
     *
     * A grantee of 0 is PUBLIC and is filtered out, so what remains is only
     * what ALTER DEFAULT PRIVILEGES put there, plus the owner.
     */
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(
        rows[0].table_grantees,
        `${role} holds no direct table grant, so the harness is not reproducing hosted`,
      ).toContain(role);
      expect(
        rows[0].function_grantees,
        `${role} holds no direct routine grant, so the harness is not reproducing hosted`,
      ).toContain(role);
    }

    await db.exec(`
      drop table public.sweep_probe_table;
      drop function public.sweep_probe_function();
    `);
  });
});
