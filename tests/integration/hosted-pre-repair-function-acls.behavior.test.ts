// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");
const normalizerMigration =
  "20260822000850_normalize_hosted_pre_repair_function_acls.sql";

const signatures = [
  "public.claim_provider_connect_session(text,text)",
  "public.normalize_bot_assignment_configuration(jsonb)",
  "public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])",
  "public.validate_pipeline_template_areas(jsonb)",
] as const;

interface RoutineSnapshot {
  readonly acl_entries: number;
  readonly anon_execute: boolean;
  readonly authenticated_execute: boolean;
  readonly contract_md5: string;
  readonly identity_oid: number;
  readonly language_name: string;
  readonly owner_name: string;
  readonly proconfig: readonly string[] | null;
  readonly prokind: string;
  readonly prosecdef: boolean;
  readonly prosrc_md5: string;
  readonly provolatile: string;
  readonly result_md5: string;
  readonly result_text: string;
  readonly service_role_execute: boolean;
  readonly signature: string;
}

async function createPreNormalizerDatabase(): Promise<PGlite> {
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
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  const normalizerIndex = files.indexOf(normalizerMigration);
  expect(normalizerIndex).toBeGreaterThan(0);
  expect(files[normalizerIndex - 1]).toBe(
    "20260822000800_clear_backlog_and_pipelines.sql",
  );
  expect(files[normalizerIndex + 1]).toBe(
    "20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql",
  );
  for (const file of files.slice(0, normalizerIndex)) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
  return db;
}

async function installMeasuredHostedState(db: PGlite): Promise<void> {
  const definition = await db.query<{ definition: string }>(`
    select pg_get_functiondef(
      'public.claim_provider_connect_session(text,text)'::regprocedure
    ) as definition
  `);
  expect(definition.rows).toHaveLength(1);
  const legacyDefinition = definition.rows[0]!.definition
    .replaceAll("claimed_organization_id", "organization_id")
    .replaceAll("claimed_purpose", "purpose");

  await db.exec(`
    drop function public.claim_provider_connect_session(text,text);
    ${legacyDefinition};

    revoke all on function public.claim_provider_connect_session(text,text)
      from public, anon, authenticated, service_role;

    grant execute on function public.normalize_bot_assignment_configuration(jsonb)
      to service_role;
    grant execute on function public.record_claim_anchoring(
      uuid, public.anchored_claim, uuid[]
    ) to service_role;
    grant execute on function public.validate_pipeline_template_areas(jsonb)
      to service_role;
  `);
}

async function readCatalog(db: PGlite): Promise<readonly RoutineSnapshot[]> {
  // format_type() is search-path-sensitive. Match the migration and hosted
  // probe so public composite/enum names stay schema-qualified in the hash.
  await db.exec("set search_path = pg_catalog");
  const values = signatures.map((signature) => `('${signature}')`).join(",\n");
  const result = await db.query<RoutineSnapshot>(`
    with expected(signature) as (values ${values})
    select expected.signature,
           routine.oid::integer as identity_oid,
           md5(replace(replace(routine.prosrc, E'\\r\\n', E'\\n'), E'\\r', E'\\n'))
             as prosrc_md5,
           pg_get_function_result(routine.oid) as result_text,
           md5(pg_get_function_result(routine.oid)) as result_md5,
           md5(jsonb_build_array(
             routine_schema.nspname, routine_language.lanname,
             pg_get_userbyid(routine.proowner), routine.prokind::text,
             format_type(routine.prorettype, null), routine.proretset,
             routine.pronargs, routine.pronargdefaults,
             coalesce(array_to_string(routine.proargnames, ','), ''),
             coalesce(array_to_string(routine.proargmodes, ','), ''),
             coalesce((
               select string_agg(
                 format_type(argument.type_oid, null), ',' order by argument.ordinality
               )
               from unnest(routine.proallargtypes) with ordinality
                    argument(type_oid, ordinality)
             ), ''),
             coalesce(pg_get_expr(routine.proargdefaults, 0), ''),
             routine.proisstrict, routine.proleakproof, routine.prosecdef,
             routine.proparallel::text, routine.provariadic = 0,
             routine.procost::text, routine.prorows::text,
             routine.prosupport = 0, routine.probin is null,
             routine.prosqlbody is null, routine.protrftypes is null,
             routine.proconfig, routine.proacl is null
           )::text) as contract_md5,
           pg_get_userbyid(routine.proowner) as owner_name,
           routine_language.lanname as language_name,
           routine.prokind::text,
           routine.provolatile::text,
           routine.prosecdef,
           routine.proconfig,
           (select count(*)::integer from aclexplode(routine.proacl)) as acl_entries,
           has_function_privilege('authenticated', routine.oid, 'EXECUTE')
             as authenticated_execute,
           has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_execute,
           has_function_privilege('service_role', routine.oid, 'EXECUTE')
             as service_role_execute
      from expected
      join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
      join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
      join pg_language routine_language on routine_language.oid = routine.prolang
     order by expected.signature
  `);
  return result.rows;
}

function withoutAcl(snapshot: RoutineSnapshot) {
  const {
    acl_entries: _aclEntries,
    anon_execute: _anonExecute,
    authenticated_execute: _authenticatedExecute,
    service_role_execute: _serviceRoleExecute,
    ...catalog
  } = snapshot;
  return catalog;
}

describe("hosted pre-repair function ACL normalization", { timeout: 300_000 }, () => {
  it("converges the exact hosted matrix without changing any function contract", async () => {
    const db = await createPreNormalizerDatabase();
    try {
      await installMeasuredHostedState(db);
      const before = await readCatalog(db);
      expect(before).toHaveLength(4);
      expect(before.map((routine) => ({
        signature: routine.signature,
        source: routine.prosrc_md5,
        result: routine.result_md5,
        contract: routine.contract_md5,
        config: routine.proconfig,
        acl: routine.acl_entries,
        authenticated: routine.authenticated_execute,
        anon: routine.anon_execute,
        service: routine.service_role_execute,
      }))).toEqual([
        {
          signature: signatures[0], source: "9961e16bbe95da08903caac340633bca",
          result: "3b2b93799687f2d2de6b154376542759",
          contract: "a7ca5a02b1faa50ebba452c4a4f46195",
          config: ["search_path=pg_catalog"], acl: 1,
          authenticated: false, anon: false, service: false,
        },
        {
          signature: signatures[1], source: "643e307fdd9f98479bbe54d6f29c3623",
          result: "cd8a1292080b231b3e9a85d440b02023",
          contract: "451c6919550f1ebe87eb5ec83b50366b",
          config: ["search_path=pg_catalog"], acl: 2,
          authenticated: false, anon: false, service: true,
        },
        {
          signature: signatures[2], source: "5c78babb546ecec96e81878a3c02ac0f",
          result: "dca150e997a47d6e579413ace8b530be",
          contract: "8d7877b6de24358edd3e75981eb5411f",
          config: ["search_path=public, pg_temp"], acl: 3,
          authenticated: true, anon: false, service: true,
        },
        {
          signature: signatures[3], source: "d10799c81d59269ae5cd6bcd2a5e5d27",
          result: "cab8111fd0b710a336c898e539090e34",
          contract: "0d286e56441a0a9e377719309b75a912",
          config: ["search_path=pg_catalog"], acl: 2,
          authenticated: false, anon: false, service: true,
        },
      ]);

      const migration = await readFile(
        resolve(migrationsDirectory, normalizerMigration),
        "utf8",
      );
      await db.exec(migration);

      const after = await readCatalog(db);
      expect(after.map(withoutAcl)).toEqual(before.map(withoutAcl));
      expect(after.map((routine) => ({
        signature: routine.signature,
        acl: routine.acl_entries,
        authenticated: routine.authenticated_execute,
        anon: routine.anon_execute,
        service: routine.service_role_execute,
      }))).toEqual([
        { signature: signatures[0], acl: 2, authenticated: false, anon: false, service: true },
        { signature: signatures[1], acl: 1, authenticated: false, anon: false, service: false },
        { signature: signatures[2], acl: 2, authenticated: true, anon: false, service: false },
        { signature: signatures[3], acl: 1, authenticated: false, anon: false, service: false },
      ]);
      expect(after[0]!.result_text).toBe("TABLE(organization_id uuid, purpose text)");
      expect(migration).not.toMatch(/\balter\s+function\b/i);
      expect(migration).not.toContain("supabase_migrations");
    } finally {
      await db.close();
    }
  });
});
