// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");
const normalizerMigration = "20260822000150_normalize_legacy_bot_function_acls.sql";
const expandMigration = "20260822000200_register_bot_for_ai_account.sql";
const legacySignatures = [
  "public.register_bot(uuid,text,public.bot_provider,text,text,text,text)",
  "public.assign_bot(uuid,uuid,uuid,uuid)",
  "public.assign_bots_to_project(uuid,uuid,jsonb)",
  "public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)",
  "public.set_bot_assignment_execution(uuid,uuid,text,text)",
  "public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)",
  "public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)",
] as const;

async function createPreNormalizerDatabase(withServiceRoleDefault: boolean): Promise<PGlite> {
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

  if (withServiceRoleDefault) {
    await db.exec(`
      alter default privileges for role postgres in schema public
        grant execute on functions to service_role
    `);
  }

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const normalizerIndex = files.indexOf(normalizerMigration);
  expect(normalizerIndex).toBeGreaterThanOrEqual(0);
  expect(files[normalizerIndex - 1]).toBe("20260822000100_project_agent_selection.sql");
  expect(files[normalizerIndex + 1]).toBe(expandMigration);
  for (const file of files.slice(0, normalizerIndex)) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
  return db;
}

interface RoutineSnapshot {
  readonly acl_count: number;
  readonly anon_execute: boolean;
  readonly argument_defaults: string | null;
  readonly argument_modes: string;
  readonly argument_names: string;
  readonly argument_type_oids: string;
  readonly authenticated_direct: boolean;
  readonly authenticated_execute: boolean;
  readonly definition: string;
  readonly default_count: number;
  readonly identity_oid: number;
  readonly language_name: string;
  readonly owner_direct: boolean;
  readonly owner_name: string;
  readonly probin: string | null;
  readonly proacl: string | null;
  readonly proallargtypes: string;
  readonly proconfig: readonly string[] | null;
  readonly procost: number;
  readonly prokind: string;
  readonly proparallel: string;
  readonly proretset: boolean;
  readonly prorows: number;
  readonly prosecdef: boolean;
  readonly prosqlbody: string | null;
  readonly prosrc_md5: string;
  readonly prosupport_oid: number;
  readonly protrftypes: string | null;
  readonly provolatile: string;
  readonly public_direct: boolean;
  readonly result_type_oid: number;
  readonly service_role_direct: boolean;
  readonly service_role_execute: boolean;
  readonly signature: string;
  readonly unexpected_acl_count: number;
}

async function readLegacyCatalog(db: PGlite): Promise<readonly RoutineSnapshot[]> {
  const values = legacySignatures.map((signature) => `('${signature}')`).join(",\n");
  const result = await db.query<RoutineSnapshot>(`
    with expected(signature) as (values ${values})
    select expected.signature,
           routine.oid::integer as identity_oid,
           md5(routine.prosrc) as prosrc_md5,
           pg_get_functiondef(routine.oid) as definition,
           pg_get_userbyid(routine.proowner) as owner_name,
           routine_language.lanname as language_name,
           routine.prokind::text,
           routine.provolatile::text,
           routine.prosecdef,
           routine.proparallel::text,
           routine.proconfig,
           routine.procost,
           routine.prorows,
           routine.prosupport::oid::integer as prosupport_oid,
           routine.probin,
           routine.prosqlbody::text,
           routine.protrftypes::text,
           routine.prorettype::integer as result_type_oid,
           routine.proretset,
           routine.proargtypes::text as argument_type_oids,
           coalesce(array_to_string(routine.proallargtypes, ','), '') as proallargtypes,
           coalesce(array_to_string(routine.proargnames, ','), '') as argument_names,
           coalesce(array_to_string(routine.proargmodes, ','), '') as argument_modes,
           routine.pronargdefaults::integer as default_count,
           pg_get_expr(routine.proargdefaults, 0) as argument_defaults,
           routine.proacl::text,
           (select count(*)::integer from aclexplode(routine.proacl)) as acl_count,
           exists (
             select 1 from aclexplode(routine.proacl) acl
             where acl.grantor = routine.proowner
               and acl.grantee = routine.proowner
               and acl.privilege_type = 'EXECUTE'
               and not acl.is_grantable
           ) as owner_direct,
           exists (
             select 1 from aclexplode(routine.proacl) acl
             where acl.grantor = routine.proowner
               and acl.grantee = to_regrole('authenticated')::oid
               and acl.privilege_type = 'EXECUTE'
               and not acl.is_grantable
           ) as authenticated_direct,
           exists (
             select 1 from aclexplode(routine.proacl) acl
             where acl.grantor = routine.proowner
               and acl.grantee = to_regrole('service_role')::oid
               and acl.privilege_type = 'EXECUTE'
               and not acl.is_grantable
           ) as service_role_direct,
           exists (
             select 1 from aclexplode(routine.proacl) acl
             where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
           ) as public_direct,
           (select count(*)::integer
              from aclexplode(routine.proacl) acl
             where acl.grantor <> routine.proowner
                or acl.privilege_type <> 'EXECUTE'
                or acl.is_grantable
                or acl.grantee not in (
                  routine.proowner,
                  to_regrole('authenticated')::oid,
                  to_regrole('service_role')::oid
                )) as unexpected_acl_count,
           has_function_privilege('authenticated', routine.oid, 'EXECUTE')
             as authenticated_execute,
           has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_execute,
           has_function_privilege('service_role', routine.oid, 'EXECUTE')
             as service_role_execute
      from expected
      join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
      join pg_language routine_language on routine_language.oid = routine.prolang
     order by expected.signature
  `);
  return result.rows;
}

function withoutAcl(snapshot: RoutineSnapshot) {
  const {
    acl_count: _aclCount,
    anon_execute: _anonExecute,
    authenticated_direct: _authenticatedDirect,
    authenticated_execute: _authenticatedExecute,
    owner_direct: _ownerDirect,
    proacl: _proacl,
    public_direct: _publicDirect,
    service_role_direct: _serviceRoleDirect,
    service_role_execute: _serviceRoleExecute,
    unexpected_acl_count: _unexpectedAclCount,
    ...contract
  } = snapshot;
  return contract;
}

function expectExactNormalizedAcl(snapshot: RoutineSnapshot) {
  expect(snapshot, snapshot.signature).toMatchObject({
    acl_count: 2,
    anon_execute: false,
    authenticated_direct: true,
    authenticated_execute: true,
    owner_direct: true,
    owner_name: "postgres",
    public_direct: false,
    service_role_direct: false,
    service_role_execute: false,
    unexpected_acl_count: 0,
  });
}

describe("legacy bot function ACL normalizer", { timeout: 300_000 }, () => {
  it("normalizes a Supabase default-privilege grant and leaves EXPAND admissible", async () => {
    const db = await createPreNormalizerDatabase(true);
    try {
      const before = await readLegacyCatalog(db);
      expect(before).toHaveLength(legacySignatures.length);
      for (const routine of before) {
        expect(routine, routine.signature).toMatchObject({
          acl_count: 3,
          anon_execute: false,
          authenticated_direct: true,
          authenticated_execute: true,
          owner_direct: true,
          owner_name: "postgres",
          public_direct: false,
          service_role_direct: true,
          service_role_execute: true,
          unexpected_acl_count: 0,
        });
      }

      await db.exec(await readFile(resolve(migrationsDirectory, normalizerMigration), "utf8"));
      const after = await readLegacyCatalog(db);
      expect(after.map(withoutAcl)).toEqual(before.map(withoutAcl));
      after.forEach(expectExactNormalizedAcl);

      // The committed EXPAND preflight requires the exact normalized catalog.
      await db.exec(await readFile(resolve(migrationsDirectory, expandMigration), "utf8"));
      const checked = await db.query<{ present: boolean }>(`
        select to_regprocedure(
          'public.assign_bots_to_project_checked(uuid,uuid,jsonb)'
        ) is not null as present
      `);
      expect(checked.rows).toEqual([{ present: true }]);
    } finally {
      await db.close();
    }
  });

  it("is a catalog no-op when the seven ACLs are already normalized", async () => {
    const db = await createPreNormalizerDatabase(false);
    try {
      const before = await readLegacyCatalog(db);
      before.forEach(expectExactNormalizedAcl);
      await db.exec(await readFile(resolve(migrationsDirectory, normalizerMigration), "utf8"));
      expect(await readLegacyCatalog(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });

  it("atomically refuses a mixed 6-of-7 service_role state", async () => {
    const db = await createPreNormalizerDatabase(true);
    try {
      await db.exec(`
        revoke execute on function public.register_bot(
          uuid, text, public.bot_provider, text, text, text, text
        ) from service_role
      `);
      const before = await readLegacyCatalog(db);
      expect(before.filter((routine) => routine.service_role_direct)).toHaveLength(6);
      expect(before.filter((routine) => routine.service_role_execute)).toHaveLength(6);

      await expect(db.exec(
        await readFile(resolve(migrationsDirectory, normalizerMigration), "utf8"),
      )).rejects.toThrow(/mixed service_role state/i);

      const after = await readLegacyCatalog(db);
      expect(after).toEqual(before);
      expect(after.filter((routine) => routine.service_role_direct)).toHaveLength(6);
    } finally {
      await db.close();
    }
  });

  it("fails closed on ACL, metadata, or overload drift without partially revoking", async () => {
    const driftCases = [
      {
        name: "PUBLIC execute",
        sql: `grant execute on function public.assign_bot(uuid,uuid,uuid,uuid) to public`,
      },
      {
        name: "an unexpected role",
        sql: `
          create role unexpected_acl_role nologin;
          grant execute on function public.assign_bot(uuid,uuid,uuid,uuid)
            to unexpected_acl_role;
        `,
      },
      {
        name: "a grantable service_role ACL",
        sql: `grant execute on function public.assign_bot(uuid,uuid,uuid,uuid)
                to service_role with grant option`,
      },
      {
        name: "a missing authenticated ACL",
        sql: `revoke execute on function public.assign_bot(uuid,uuid,uuid,uuid)
                from authenticated`,
      },
      {
        name: "SECURITY INVOKER metadata",
        sql: `alter function public.assign_bot(uuid,uuid,uuid,uuid) security invoker`,
      },
      {
        name: "COST metadata",
        sql: `alter function public.assign_bot(uuid,uuid,uuid,uuid) cost 101`,
      },
      {
        name: "an unexpected overload",
        sql: `create function public.assign_bot(uuid) returns void
                language sql as $$ select $$`,
      },
    ] as const;

    const migration = await readFile(resolve(migrationsDirectory, normalizerMigration), "utf8");
    for (const drift of driftCases) {
      const db = await createPreNormalizerDatabase(true);
      try {
        await db.exec(drift.sql);
        const before = await readLegacyCatalog(db);
        await expect(db.exec(migration), drift.name).rejects.toThrow(/ACL normalization/i);
        expect(await readLegacyCatalog(db), drift.name).toEqual(before);
      } finally {
        await db.close();
      }
    }
  });

  it("contains only the seven service_role ACL edits and no ledger write", async () => {
    const migration = await readFile(resolve(migrationsDirectory, normalizerMigration), "utf8");
    const executed = [...migration.matchAll(/execute '([^']+)'/g)].map((match) => match[1]);
    expect(executed).toEqual(legacySignatures.map(
      (signature) => `revoke execute on function ${signature} from service_role`,
    ));
    expect(migration).not.toContain("pg_get_functiondef(");
    expect(migration).not.toContain("supabase_migrations");
    expect(migration).not.toMatch(/\b(?:insert|update|delete)\b/i);
  });
});
