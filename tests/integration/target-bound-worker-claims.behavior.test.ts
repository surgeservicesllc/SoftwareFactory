// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260828000200_target_bound_worker_claims.sql",
);
const priorGraphClaimMigrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260827000200_graph_phase1c_release_lineage.sql",
);
const priorPhaseClaimMigrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260815000500_phase2e_breaker_aware_scheduling.sql",
);

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const claimedGraphId = "30000000-0000-4000-8000-000000000001";
const otherGraphId = "30000000-0000-4000-8000-000000000002";
const claimedCommandId = "40000000-0000-4000-8000-000000000001";
const otherCommandId = "40000000-0000-4000-8000-000000000002";
const staleCommandId = "40000000-0000-4000-8000-000000000003";
const productionUrl = "https://softwarefactory.example.test";
const templatePlanSha256 = "a".repeat(64);

function extractFunctionDefinition(source: string, functionName: string) {
  const marker = `create or replace function public.${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing prior function definition: ${functionName}`);
  }
  const remainder = source.slice(start);
  const opening = /\bas\s+(\$[A-Za-z_]*\$)\r?\n/i.exec(remainder);
  if (!opening?.[1] || opening.index === undefined) {
    throw new Error(`missing prior function body delimiter: ${functionName}`);
  }
  const delimiter = opening[1];
  const bodyStart = opening.index + opening[0].length;
  const end = remainder.indexOf(`${delimiter};`, bodyStart);
  if (end < 0) {
    throw new Error(`unterminated prior function definition: ${functionName}`);
  }
  return remainder.slice(0, end + delimiter.length + 1);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
}

describe("target-bound worker claims", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists public;
      create type public.risk_level as enum ('green', 'yellow', 'red');

      create table public.projects (
        id uuid primary key,
        organization_id uuid not null,
        production_url text
      );
      create table public.graphs (
        id uuid primary key,
        organization_id uuid not null,
        project_id uuid not null
      );
      create table public.claim_effects (
        kind text not null,
        claimed_id uuid not null
      );

      insert into public.projects (id, organization_id, production_url)
      values ('${projectId}', '${organizationId}', '${productionUrl}');
      insert into public.graphs (id, organization_id, project_id) values
        ('${claimedGraphId}', '${organizationId}', '${projectId}'),
        ('${otherGraphId}', '${organizationId}', '${projectId}');

      create function public.claim_planned_graph_v2(
        p_worker_id text,
        p_supported_executors text[],
        p_repository_full_name text,
        p_required_check_names jsonb,
        p_protocol_version integer
      ) returns jsonb
      language plpgsql security definer set search_path = pg_catalog as $$
      begin
        insert into public.claim_effects (kind, claimed_id)
        values ('graph', '${claimedGraphId}');
        return pg_catalog.jsonb_build_object(
          'graph_id', '${claimedGraphId}',
          'organization_id', '${organizationId}',
          'project_id', '${projectId}',
          'template_plan_sha256', '${templatePlanSha256}',
          'deployment_url', 'https://protected-deployment.example.test'
        );
      end;
      $$;

      create function public.claim_phase1c_run(
        p_worker_id text,
        p_provider text,
        p_model text,
        p_lease_seconds integer
      ) returns setof record
      language plpgsql security definer set search_path = pg_catalog as $$
      begin
        return;
      end;
      $$;

      create function public.claim_phase1c_run_v2(
        p_worker_id text,
        p_provider text,
        p_model text,
        p_lease_seconds integer,
        p_protocol_version integer
      ) returns table (
        run_id uuid, organization_id uuid, project_id uuid, task_id uuid,
        command_id uuid, agent_id uuid, prompt text, command_type text,
        requested_risk public.risk_level, acceptance_criteria jsonb, plan jsonb,
        connection_id uuid, repository_id uuid, internal_installation_id uuid,
        external_installation_id bigint, app_id bigint, external_repository_id bigint,
        repository_full_name text, base_branch text, base_sha text,
        lease_token uuid, lease_expires_at timestamptz, attempt_number integer,
        cancellation_requested boolean, logical_agent_role text, provider text, model text,
        maximum_duration_ms integer, maximum_turns integer, maximum_input_tokens integer,
        maximum_output_tokens integer, maximum_repair_attempts integer, ci_timeout_ms integer,
        owner_approval_id uuid, owner_approval_expires_at timestamptz,
        recovery_head_branch text, recovery_head_sha text,
        recovery_pull_request_number integer, recovery_pull_request_url text,
        recovery_provider_run_reference text, recovery_usage jsonb
      ) language plpgsql security definer set search_path = pg_catalog as $$
      begin
        insert into public.claim_effects (kind, claimed_id)
        values ('phase1c', '${claimedCommandId}');
        return query select
          '50000000-0000-4000-8000-000000000001'::uuid,
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '50000000-0000-4000-8000-000000000002'::uuid,
          '${claimedCommandId}'::uuid,
          '50000000-0000-4000-8000-000000000003'::uuid,
          'Demo Data canary'::text,
          'build_feature'::text,
          'yellow'::public.risk_level,
          '[]'::jsonb,
          '{}'::jsonb,
          '50000000-0000-4000-8000-000000000004'::uuid,
          '50000000-0000-4000-8000-000000000005'::uuid,
          '50000000-0000-4000-8000-000000000006'::uuid,
          1::bigint, 2::bigint, 3::bigint,
          'factory/repository'::text,
          'main'::text,
          repeat('a', 40)::text,
          '50000000-0000-4000-8000-000000000007'::uuid,
          now() + interval '2 minutes',
          1,
          false,
          'architect'::text,
          p_provider,
          p_model,
          60000, 1, 1000, 500, 0, 30000,
          null::uuid, null::timestamptz,
          null::text, null::text, null::integer, null::text,
          null::text, '{}'::jsonb;
      end;
      $$;

      revoke all on function public.claim_planned_graph_v2(
        text, text[], text, jsonb, integer
      ) from public, anon, authenticated, service_role;
      grant execute on function public.claim_planned_graph_v2(
        text, text[], text, jsonb, integer
      ) to service_role;
      revoke all on function public.claim_phase1c_run_v2(
        text, text, text, integer, integer
      ) from public, anon, authenticated, service_role;
      grant execute on function public.claim_phase1c_run_v2(
        text, text, text, integer, integer
      ) to service_role;
      revoke all on function public.claim_phase1c_run(
        text, text, text, integer
      ) from public, anon, authenticated, service_role;
    `);
    // This focused harness supplies small selector doubles below. Disabling
    // body validation only while the forward migration is parsed avoids
    // recreating the entire production schema; signatures, ACLs and the
    // target-wrapper transaction remain real PostgreSQL behavior.
    await db.exec("set check_function_bodies = off");
    const [migration, priorGraphMigration, priorPhaseMigration] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(priorGraphClaimMigrationPath, "utf8"),
      readFile(priorPhaseClaimMigrationPath, "utf8"),
    ]);
    await db.exec(extractFunctionDefinition(
      priorGraphMigration,
      "claim_planned_graph_internal",
    ));
    await db.exec(extractFunctionDefinition(
      priorPhaseMigration,
      "claim_phase1c_run_budget_internal",
    ));
    await db.exec(`
      revoke all on function public.claim_planned_graph_internal(
        text, text[], text, jsonb
      ) from public, anon, authenticated, service_role;
      revoke all on function public.claim_phase1c_run_budget_internal(
        text, text, text, integer
      ) from public, anon, authenticated, service_role;
    `);
    await db.exec(migration);
    await db.exec("set check_function_bodies = on");
    await db.exec(`
      create or replace function public.claim_planned_graph_target_internal(
        p_worker_id text,
        p_supported_executors text[],
        p_repository_full_name text,
        p_required_check_names jsonb,
        p_target_graph_id uuid
      ) returns jsonb
      language plpgsql security definer set search_path = pg_catalog as $$
      declare
        selected_graph_id uuid := coalesce(
          p_target_graph_id,
          '${claimedGraphId}'::uuid
        );
      begin
        insert into public.claim_effects (kind, claimed_id)
        values ('graph', selected_graph_id);
        return pg_catalog.jsonb_build_object(
          'graph_id', selected_graph_id,
          'organization_id', '${organizationId}',
          'project_id', '${projectId}',
          'template_plan_sha256', '${templatePlanSha256}',
          'deployment_url', 'https://protected-deployment.example.test'
        );
      end;
      $$;

      create or replace function public.claim_phase1c_run_target_internal(
        p_worker_id text,
        p_provider text,
        p_model text,
        p_lease_seconds integer,
        p_target_command_id uuid
      ) returns table (
        run_id uuid, organization_id uuid, project_id uuid, task_id uuid,
        command_id uuid, agent_id uuid, prompt text, command_type text,
        requested_risk public.risk_level, acceptance_criteria jsonb, plan jsonb,
        connection_id uuid, repository_id uuid, internal_installation_id uuid,
        external_installation_id bigint, app_id bigint, external_repository_id bigint,
        repository_full_name text, base_branch text, base_sha text,
        lease_token uuid, lease_expires_at timestamptz, attempt_number integer,
        cancellation_requested boolean, logical_agent_role text, provider text, model text,
        maximum_duration_ms integer, maximum_turns integer, maximum_input_tokens integer,
        maximum_output_tokens integer, maximum_repair_attempts integer, ci_timeout_ms integer,
        owner_approval_id uuid, owner_approval_expires_at timestamptz,
        recovery_head_branch text, recovery_head_sha text,
        recovery_pull_request_number integer, recovery_pull_request_url text,
        recovery_provider_run_reference text, recovery_usage jsonb
      ) language plpgsql security definer set search_path = pg_catalog as $$
      begin
        if p_target_command_id = '${staleCommandId}'::uuid then
          insert into public.claim_effects (kind, claimed_id)
          values ('cleanup', p_target_command_id);
          return;
        end if;
        insert into public.claim_effects (kind, claimed_id)
        values ('phase1c', p_target_command_id);
        return query select
          '50000000-0000-4000-8000-000000000001'::uuid,
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '50000000-0000-4000-8000-000000000002'::uuid,
          p_target_command_id,
          '50000000-0000-4000-8000-000000000003'::uuid,
          'Demo Data canary'::text,
          'build_feature'::text,
          'yellow'::public.risk_level,
          '[]'::jsonb,
          '{}'::jsonb,
          '50000000-0000-4000-8000-000000000004'::uuid,
          '50000000-0000-4000-8000-000000000005'::uuid,
          '50000000-0000-4000-8000-000000000006'::uuid,
          1::bigint, 2::bigint, 3::bigint,
          'factory/repository'::text,
          'main'::text,
          repeat('a', 40)::text,
          '50000000-0000-4000-8000-000000000007'::uuid,
          now() + interval '2 minutes',
          1,
          false,
          'architect'::text,
          p_provider,
          p_model,
          60000, 1, 1000, 500, 0, 30000,
          null::uuid, null::timestamptz,
          null::text, null::text, null::integer, null::text,
          null::text, '{}'::jsonb;
      end;
      $$;
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("selects the requested graph even when another eligible graph exists", async () => {
    await db.exec("set role service_role");
    const result = await db.query<{ claim: Record<string, unknown> }>(
      `select public.claim_planned_graph_by_id_v2(
         'worker', array['MODEL'], 'factory/repository', '["CI"]'::jsonb, $1, 2
       ) as claim`,
      [otherGraphId],
    );
    expect(result.rows[0].claim.graph_id).toBe(otherGraphId);
    expect(result.rows[0].claim.template_plan_sha256).toBe(templatePlanSha256);
    await resetRole(db);
    expect((await db.query<{ claimed_id: string }>(
      "select claimed_id from public.claim_effects where kind = 'graph'",
    )).rows).toEqual([{ claimed_id: otherGraphId }]);
  });

  it("returns only the exact graph and keeps public and deployment URLs distinct", async () => {
    await db.exec("set role service_role");
    const result = await db.query<{ claim: Record<string, unknown> }>(
      `select public.claim_planned_graph_by_id_v2(
         'worker', array['MODEL'], 'factory/repository', '["CI"]'::jsonb, $1, 2
       ) as claim`,
      [claimedGraphId],
    );
    expect(result.rows[0].claim).toMatchObject({
      graph_id: claimedGraphId,
      project_production_url: productionUrl,
      template_plan_sha256: templatePlanSha256,
      deployment_url: "https://protected-deployment.example.test",
    });
    await resetRole(db);
    expect((await db.query<{ claimed_id: string }>(
      "select claimed_id from public.claim_effects where kind = 'graph' order by claimed_id",
    )).rows).toEqual([
      { claimed_id: claimedGraphId },
      { claimed_id: otherGraphId },
    ]);
  });

  it("keeps the template digest in the global graph claim compatibility path", async () => {
    await resetRole(db);
    const result = await db.query<{ claim: Record<string, unknown> }>(`
      select public.claim_planned_graph_internal(
        'worker', array['MODEL'], 'factory/repository', '["CI"]'::jsonb
      ) as claim
    `);
    expect(result.rows[0].claim).toMatchObject({
      graph_id: claimedGraphId,
      template_plan_sha256: templatePlanSha256,
    });
  });

  it("selects the requested Phase 1C command without touching a neighboring command", async () => {
    await db.exec("set role service_role");
    const result = await db.query<{ command_id: string }>(
      `select * from public.claim_phase1c_run_by_command_v2(
         'worker', 'openai', 'gpt-5.3-codex', 120, $1, 2
       )`,
      [otherCommandId],
    );
    expect(result.rows[0].command_id).toBe(otherCommandId);
    await resetRole(db);
    expect((await db.query<{ claimed_id: string }>(
      "select claimed_id from public.claim_effects where kind = 'phase1c'",
    )).rows).toEqual([{ claimed_id: otherCommandId }]);
  });

  it("returns the exact command and exposes neither target RPC to a tenant role", async () => {
    await db.exec("set role service_role");
    const result = await db.query<{ command_id: string }>(
      `select command_id from public.claim_phase1c_run_by_command_v2(
         'worker', 'openai', 'gpt-5.3-codex', 120, $1, 2
       )`,
      [claimedCommandId],
    );
    expect(result.rows).toEqual([{ command_id: claimedCommandId }]);

    await resetRole(db);
    await db.exec("set role authenticated");
    await expect(db.query(
      `select public.claim_planned_graph_by_id_v2(
         'worker', array['MODEL'], 'factory/repository', '["CI"]'::jsonb, $1, 2
       )`,
      [claimedGraphId],
    )).rejects.toThrow(/permission denied/i);
    await expect(db.query(
      `select * from public.claim_phase1c_run_by_command_v2(
         'worker', 'openai', 'gpt-5.3-codex', 120, $1, 2
       )`,
      [claimedCommandId],
    )).rejects.toThrow(/permission denied/i);
  });

  it("commits stale-target cleanup and returns empty without claiming a neighbor", async () => {
    await resetRole(db);
    const before = await db.query<{ count: string }>(
      "select count(*)::text as count from public.claim_effects where kind = 'phase1c'",
    );

    await db.exec("set role service_role");
    const result = await db.query<{ command_id: string }>(
      `select command_id from public.claim_phase1c_run_by_command_v2(
         'worker', 'openai', 'gpt-5.3-codex', 120, $1, 2
       )`,
      [staleCommandId],
    );
    expect(result.rows).toEqual([]);

    await resetRole(db);
    expect((await db.query<{ kind: string; claimed_id: string }>(
      "select kind, claimed_id from public.claim_effects where claimed_id = $1",
      [staleCommandId],
    )).rows).toEqual([{ kind: "cleanup", claimed_id: staleCommandId }]);
    const after = await db.query<{ count: string }>(
      "select count(*)::text as count from public.claim_effects where kind = 'phase1c'",
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("pins target and legacy claim owner, security, search path, and ACL", async () => {
    await resetRole(db);
    for (const signature of [
      "public.claim_planned_graph_target_internal(text,text[],text,jsonb,uuid)",
      "public.claim_planned_graph_internal(text,text[],text,jsonb)",
      "public.claim_phase1c_run_target_budget_internal(text,text,text,integer,uuid)",
      "public.claim_phase1c_run_budget_internal(text,text,text,integer)",
      "public.claim_phase1c_run_target_internal(text,text,text,integer,uuid)",
      "public.claim_phase1c_run(text,text,text,integer)",
    ]) {
      const result = await db.query<{
        authenticated_execute: boolean;
        owner_name: string;
        pinned_search_path: boolean;
        security_definer: boolean;
        service_execute: boolean;
      }>(`
        select
          routine.prosecdef as security_definer,
          routine.proconfig = array['search_path=pg_catalog']::text[] as pinned_search_path,
          pg_catalog.pg_get_userbyid(routine.proowner) as owner_name,
          pg_catalog.has_function_privilege(
            'authenticated', routine.oid, 'EXECUTE'
          ) as authenticated_execute,
          pg_catalog.has_function_privilege(
            'service_role', routine.oid, 'EXECUTE'
          ) as service_execute
        from pg_catalog.pg_proc routine
        where routine.oid = pg_catalog.to_regprocedure($1)
      `, [signature]);
      expect(result.rows[0]).toEqual({
        authenticated_execute: false,
        owner_name: "postgres",
        pinned_search_path: true,
        security_definer: true,
        service_execute: false,
      });
    }

    for (const signature of [
      "public.claim_planned_graph_by_id_v2(text,text[],text,jsonb,uuid,integer)",
      "public.claim_phase1c_run_by_command_v2(text,text,text,integer,uuid,integer)",
      "public.claim_planned_graph_v2(text,text[],text,jsonb,integer)",
      "public.claim_phase1c_run_v2(text,text,text,integer,integer)",
    ]) {
      const result = await db.query<{
        authenticated_execute: boolean;
        owner_name: string;
        pinned_search_path: boolean;
        security_definer: boolean;
        service_execute: boolean;
      }>(`
        select
          routine.prosecdef as security_definer,
          routine.proconfig = array['search_path=pg_catalog']::text[] as pinned_search_path,
          pg_catalog.pg_get_userbyid(routine.proowner) as owner_name,
          pg_catalog.has_function_privilege(
            'authenticated', routine.oid, 'EXECUTE'
          ) as authenticated_execute,
          pg_catalog.has_function_privilege(
            'service_role', routine.oid, 'EXECUTE'
          ) as service_execute
        from pg_catalog.pg_proc routine
        where routine.oid = pg_catalog.to_regprocedure($1)
      `, [signature]);
      expect(result.rows[0]).toEqual({
        authenticated_execute: false,
        owner_name: "postgres",
        pinned_search_path: true,
        security_definer: true,
        service_execute: true,
      });
    }
  });
});
