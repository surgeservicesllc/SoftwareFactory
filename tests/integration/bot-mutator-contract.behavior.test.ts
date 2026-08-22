// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");
const expandMigration = "20260822000200_register_bot_for_ai_account.sql";
const contractMigration = "20260822000300_contract_bot_mutator_acls.sql";
const legacySignatures = [
  "public.assign_bot(uuid,uuid,uuid,uuid)",
  "public.assign_bots_to_project(uuid,uuid,jsonb)",
  "public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)",
  "public.set_bot_assignment_execution(uuid,uuid,text,text)",
  "public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)",
  "public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)",
] as const;

async function createExpandedDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const expandIndex = files.indexOf(expandMigration);
  expect(expandIndex).toBeGreaterThanOrEqual(0);
  expect(files[expandIndex + 1]).toBe(contractMigration);
  for (const file of files.slice(0, expandIndex + 1)) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
  return db;
}

interface RoutineSnapshot {
  readonly authenticated_execute: boolean;
  readonly definition: string;
  readonly identity: string;
  readonly oid: number;
  readonly owner_name: string;
  readonly proacl: string | null;
  readonly proconfig: readonly string[] | null;
  readonly prosecdef: boolean;
  readonly public_execute: boolean;
  readonly anon_execute: boolean;
  readonly service_role_execute: boolean;
}

async function readPublicRoutineCatalog(db: PGlite): Promise<readonly RoutineSnapshot[]> {
  const result = await db.query<RoutineSnapshot>(`
    select routine.oid::integer as oid,
           routine.oid::regprocedure::text as identity,
           pg_get_functiondef(routine.oid) as definition,
           pg_get_userbyid(routine.proowner) as owner_name,
           routine.prosecdef,
           routine.proconfig,
           routine.proacl::text,
           has_function_privilege('authenticated', routine.oid, 'EXECUTE') as authenticated_execute,
           has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_execute,
           has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_role_execute,
           exists (
             select 1 from aclexplode(routine.proacl) acl
             where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
           ) as public_execute
      from pg_proc routine
      join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
     where routine_schema.nspname = 'public'
     order by routine.oid
  `);
  return result.rows;
}

describe("legacy bot mutator CONTRACT", { timeout: 180_000 }, () => {
  it("changes only the six exact EXECUTE ACLs and preserves every function definition", async () => {
    const db = await createExpandedDatabase();
    try {
      const before = await readPublicRoutineCatalog(db);
      const beforeByIdentity = new Map(before.map((routine) => [routine.identity, routine]));
      for (const signature of legacySignatures) {
        const routine = beforeByIdentity.get(signature.replaceAll("public.", ""))
          ?? beforeByIdentity.get(signature);
        expect(routine, signature).toBeDefined();
        expect(routine).toMatchObject({
          anon_execute: false,
          authenticated_execute: true,
          owner_name: "postgres",
          prosecdef: true,
          public_execute: false,
          service_role_execute: false,
        });
        expect(routine?.proconfig).toEqual(["search_path=pg_catalog"]);
      }

      await db.exec(await readFile(resolve(migrationsDirectory, contractMigration), "utf8"));

      const after = await readPublicRoutineCatalog(db);
      expect(after).toHaveLength(before.length);
      const changed: string[] = [];
      for (const current of after) {
        const previous = before.find((candidate) => candidate.oid === current.oid);
        expect(previous, current.identity).toBeDefined();
        if (previous?.proacl !== current.proacl) changed.push(current.identity);
        expect({
          definition: current.definition,
          identity: current.identity,
          oid: current.oid,
          owner_name: current.owner_name,
          proconfig: current.proconfig,
          prosecdef: current.prosecdef,
        }).toEqual({
          definition: previous?.definition,
          identity: previous?.identity,
          oid: previous?.oid,
          owner_name: previous?.owner_name,
          proconfig: previous?.proconfig,
          prosecdef: previous?.prosecdef,
        });
      }

      expect(changed.sort()).toEqual(
        legacySignatures.map((signature) => signature.replaceAll("public.", "")).sort(),
      );
      const afterByIdentity = new Map(after.map((routine) => [routine.identity, routine]));
      for (const signature of legacySignatures) {
        const routine = afterByIdentity.get(signature.replaceAll("public.", ""))
          ?? afterByIdentity.get(signature);
        expect(routine, signature).toMatchObject({
          anon_execute: false,
          authenticated_execute: false,
          prosecdef: true,
          public_execute: false,
          service_role_execute: false,
        });
        expect(routine?.proacl).toBe("{postgres=X/postgres}");
      }

      const checked = await db.query<{ ready: boolean }>(`
        select not exists (
          select 1
          from (values
            ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)', 'authenticated'),
            ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)', 'authenticated'),
            ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)', 'authenticated'),
            ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)', 'authenticated'),
            ('public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)', 'service_role')
          ) expected(signature, grantee)
          where not has_function_privilege(expected.grantee, expected.signature, 'EXECUTE')
        ) as ready
      `);
      expect(checked.rows[0].ready).toBe(true);

      await db.exec("set role authenticated");
      await expect(db.query(`
        select * from public.assign_bot(
          null::uuid, null::uuid, null::uuid, null::uuid
        )
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("reset role");
      await db.close();
    }
  });

  it("refuses definition, security, ACL, and overload drift before changing a grant", async () => {
    for (const drift of [
      "alter function public.assign_bot(uuid,uuid,uuid,uuid) security invoker",
      "grant execute on function public.assign_bot(uuid,uuid,uuid,uuid) to service_role",
      "create function public.assign_bot(uuid) returns void language sql as $$ select $$",
    ]) {
      const db = await createExpandedDatabase();
      try {
        await db.exec(drift);
        const before = await readPublicRoutineCatalog(db);
        await expect(db.exec(
          await readFile(resolve(migrationsDirectory, contractMigration), "utf8"),
        )).rejects.toThrow(/legacy bot mutator|unexpected legacy bot mutator overload/i);
        const after = await readPublicRoutineCatalog(db);
        expect(after).toEqual(before);
      } finally {
        await db.close();
      }
    }
  });

  it("atomically refuses CONTRACT when either revision default is missing", async () => {
    for (const relation of ["public.bots", "public.bot_assignments"]) {
      const db = await createExpandedDatabase();
      try {
        await db.exec(`alter table ${relation} alter column revision drop default`);
        const before = await readPublicRoutineCatalog(db);
        await expect(db.exec(
          await readFile(resolve(migrationsDirectory, contractMigration), "utf8"),
        )).rejects.toThrow(/revision column or constraint catalog is not exact/i);
        expect(await readPublicRoutineCatalog(db)).toEqual(before);
      } finally {
        await db.close();
      }
    }
  });

  it("is forward-only and refuses replay after the authenticated grants are gone", async () => {
    const db = await createExpandedDatabase();
    try {
      const migration = await readFile(resolve(migrationsDirectory, contractMigration), "utf8");
      await db.exec(migration);
      const contracted = await readPublicRoutineCatalog(db);
      await expect(db.exec(migration)).rejects.toThrow(
        /does not match the exact authenticated-only EXPAND contract/i,
      );
      expect(await readPublicRoutineCatalog(db)).toEqual(contracted);
    } finally {
      await db.close();
    }
  });

  it("contains exactly the six approved ACL statements and no persistent DDL", async () => {
    const migration = await readFile(resolve(migrationsDirectory, contractMigration), "utf8");
    const statements = [...migration.matchAll(/execute '([^']+)'/g)].map((match) => match[1]);
    expect(statements).toEqual(legacySignatures.map((signature) =>
      `revoke all privileges on function ${signature} from public, anon, authenticated, service_role`
    ));
    expect(migration).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?(?:function|table|trigger|policy)\b/i);
    expect(migration).not.toMatch(/\balter\s+(?:function|table)\b/i);
    expect(migration).not.toMatch(/\b(?:insert|update|delete)\s+(?:into|from)?\s*public\./i);
  });
});
