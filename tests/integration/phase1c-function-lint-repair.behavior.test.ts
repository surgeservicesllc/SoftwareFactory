// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260814002300_guard_resource_assignment_candidates.sql";

describe("Phase 1C function lint repair", () => {
  let db: PGlite;

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
    const migrations = (await readdir(migrationsDirectory))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    expect(migrations.at(-1)).toBe(latestMigration);
    for (const migration of migrations) {
      await db.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    }
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("preserves the completion signature, definer boundary, search path, and closed ACL", async () => {
    const catalog = await db.query<{
      anon_execute: boolean;
      authenticated_execute: boolean;
      definition: string;
      identity_arguments: string;
      function_config: string;
      prosecdef: boolean;
      service_role_execute: boolean;
    }>(`
      select
        pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition,
        coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '') as function_config,
        procedure.prosecdef,
        pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
        pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute,
        pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE') as service_role_execute
      from pg_catalog.pg_proc procedure
      where procedure.oid = (
        'public.complete_phase1c_run_internal(text,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,text,text,boolean)'
      )::regprocedure
    `);

    expect(catalog.rows).toHaveLength(1);
    expect(catalog.rows[0]).toMatchObject({
      anon_execute: false,
      authenticated_execute: false,
      function_config: "search_path=pg_catalog",
      identity_arguments: [
        "p_worker_id text", "p_run_id uuid", "p_lease_token uuid", "p_outcome text",
        "p_summary text", "p_provider_run_reference text", "p_usage jsonb",
        "p_changed_files jsonb", "p_checks jsonb", "p_error_code text",
        "p_error_message text", "p_retryable boolean",
      ].join(", "),
      prosecdef: true,
      service_role_execute: false,
    });
    expect(catalog.rows[0]!.definition).not.toMatch(/\bcommand_record\b/i);
    expect(catalog.rows[0]!.definition).toMatch(
      /PERFORM 1\s+FROM public\.commands command\s+WHERE command\.id = run_record\.command_id\s+FOR UPDATE/i,
    );
  });

  it("marks only the usage normalizer STABLE while retaining its catalog boundary", async () => {
    const catalog = await db.query<{
      anon_execute: boolean;
      authenticated_execute: boolean;
      function_config: string;
      identity_arguments: string;
      prosecdef: boolean;
      provolatile: string;
      result_type: string;
      service_role_execute: boolean;
    }>(`
      select
        pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
        pg_catalog.format_type(procedure.prorettype, null) as result_type,
        coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '') as function_config,
        procedure.prosecdef,
        procedure.provolatile,
        pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
        pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute,
        pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE') as service_role_execute
      from pg_catalog.pg_proc procedure
      where procedure.oid = 'public.canonical_phase1c_usage(jsonb)'::regprocedure
    `);

    expect(catalog.rows).toEqual([{
      anon_execute: false,
      authenticated_execute: false,
      function_config: "search_path=pg_catalog",
      identity_arguments: "p_usage jsonb",
      prosecdef: false,
      provolatile: "s",
      result_type: "jsonb",
      service_role_execute: false,
    }]);
  });

  it("preserves canonical usage output, validation, and completion lease rejection", async () => {
    const usage = await db.query<{ usage: Record<string, number> }>(`
      select public.canonical_phase1c_usage(
        '{"turns":2,"inputTokens":1200,"cachedInputTokens":300,"outputTokens":80}'::jsonb
      ) as usage
    `);
    expect(usage.rows[0]!.usage).toEqual({
      cachedInputTokens: 300,
      inputTokens: 1200,
      outputTokens: 80,
      reasoningOutputTokens: 0,
      turns: 2,
    });
    await expect(db.query(
      "select public.canonical_phase1c_usage('{\"turns\":-1}'::jsonb)",
    )).rejects.toThrow(/invalid Phase 1C usage evidence/i);
    await expect(db.query(`
      select * from public.complete_phase1c_run_internal(
        'worker.lint', gen_random_uuid(), gen_random_uuid(), 'failed',
        null, null, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
        'lint_probe', 'No matching lease.', false
      )
    `)).rejects.toThrow(/active run lease required/i);
  });
});
