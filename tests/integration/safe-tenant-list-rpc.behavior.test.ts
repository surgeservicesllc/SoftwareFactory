// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationFiles = [
  "20260812000100_control_plane_schema.sql",
  "20260812000200_row_level_security.sql",
  "20260812000300_control_plane_workflows.sql",
  "20260812000400_github_integration.sql",
  "20260812000500_authenticated_onboarding.sql",
  "20260812000700_github_project_linking.sql",
  "20260812000800_fix_github_sync_ambiguity.sql",
  "20260812000900_harden_github_project_and_sync.sql",
  "20260812001000_phase1d_observation_controls.sql",
  "20260812001100_harden_direct_mutation_boundaries.sql",
  "20260812001200_github_change_audit.sql",
  "20260812001300_reconcile_github_repository_grants.sql",
  "20260812001400_sync_linked_project_repository_metadata.sql",
  "20260812001500_recover_draft_pr_completion.sql",
  "20260812001600_guard_github_installation_terminal_state.sql",
  "20260812001700_close_authenticated_control_plane_writes.sql",
  "20260812001800_order_github_repository_events.sql",
  "20260812001900_allow_service_role_sensitive_json_checks.sql",
  "20260812002000_safe_tenant_list_reads.sql",
] as const;

const targetTables = ["agents", "commands", "tasks", "agent_runs", "reports"] as const;
const rpcCases = [
  { field: "name", rpc: "list_agents" },
  { field: "prompt", rpc: "list_commands" },
  { field: "title", rpc: "list_tasks" },
  { field: "task_title", rpc: "list_agent_runs" },
  { field: "title", rpc: "list_reports" },
] as const;

const ownerOneId = "00000000-0000-4000-8000-000000000101";
const viewerOneId = "00000000-0000-4000-8000-000000000102";
const ownerTwoId = "00000000-0000-4000-8000-000000000201";
const organizationOneId = "10000000-0000-4000-8000-000000000001";
const organizationTwoId = "10000000-0000-4000-8000-000000000002";
const projectOneId = "20000000-0000-4000-8000-000000000001";
const projectTwoId = "20000000-0000-4000-8000-000000000002";
const agentOneId = "30000000-0000-4000-8000-000000000001";
const agentTwoId = "30000000-0000-4000-8000-000000000002";
const taskOneId = "40000000-0000-4000-8000-000000000001";
const taskTwoId = "40000000-0000-4000-8000-000000000002";

type ApplicationRole = "anon" | "authenticated" | "service_role";

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function assumeRole(db: PGlite, role: ApplicationRole, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function listRows(
  db: PGlite,
  rpc: (typeof rpcCases)[number]["rpc"],
  organizationId: string,
  limit: number | null,
) {
  return db.query<Record<string, unknown>>(
    `select * from public.${rpc}($1::uuid, $2::integer)`,
    [organizationId, limit],
  );
}

describe("migration 020 safe tenant-list RPC behavior", () => {
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

    for (const migrationFile of migrationFiles) {
      await db.exec(await source(`supabase/migrations/${migrationFile}`));
    }

    await db.exec(`
      insert into auth.users (id) values
        ('${ownerOneId}'),
        ('${viewerOneId}'),
        ('${ownerTwoId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationOneId}', 'Tenant One', 'tenant-one', '${ownerOneId}'),
        ('${organizationTwoId}', 'Tenant Two', 'tenant-two', '${ownerTwoId}');

      insert into public.organization_members (
        organization_id, user_id, role, created_by
      ) values (
        '${organizationOneId}', '${viewerOneId}', 'viewer', '${ownerOneId}'
      );

      insert into public.projects (
        id, organization_id, name, status, created_by
      ) values
        ('${projectOneId}', '${organizationOneId}', 'Tenant One Project', 'active', '${ownerOneId}'),
        ('${projectTwoId}', '${organizationTwoId}', 'Tenant Two Project', 'active', '${ownerTwoId}');

      insert into public.agents (
        id, organization_id, project_id, name, role, description, status,
        provider, model, current_assignment, capabilities, created_by, created_at
      ) values
        (
          '${agentOneId}', '${organizationOneId}', '${projectOneId}', 'Tenant One Agent 1',
          'qa', repeat('d', 1100), 'idle', 'openai', 'model-one',
          'internal-only assignment', pg_catalog.jsonb_build_array(repeat('c', 9000)),
          '${ownerOneId}', '2026-08-12 00:00:01+00'
        ),
        (
          '${agentTwoId}', '${organizationTwoId}', '${projectTwoId}', 'Tenant Two Agent 1',
          'qa', 'Tenant Two description', 'idle', 'openai', 'model-two',
          'internal-only assignment', '["quality"]'::jsonb,
          '${ownerTwoId}', '2026-08-12 00:00:01+00'
        );

      insert into public.agents (
        organization_id, project_id, name, role, description, status,
        provider, model, current_assignment, capabilities, created_by, created_at
      )
      select
        '${organizationOneId}', '${projectOneId}', 'Tenant One Agent ' || series,
        'qa', repeat('d', 1100), 'idle', 'openai', 'model-one',
        'internal-only assignment', '["quality"]'::jsonb, '${ownerOneId}',
        '2026-08-12 00:00:00+00'::timestamptz + series * interval '1 second'
      from generate_series(2, 105) series;

      insert into public.agents (
        organization_id, project_id, name, role, status, created_by, created_at
      ) values (
        '${organizationTwoId}', '${projectTwoId}', 'Tenant Two Agent 2', 'qa', 'idle',
        '${ownerTwoId}', '2026-08-12 00:00:02+00'
      );

      insert into public.commands (
        organization_id, project_id, submitted_by, prompt, requested_risk,
        status, parameters, idempotency_key, submitted_at
      )
      select
        '${organizationOneId}', '${projectOneId}', '${ownerOneId}',
        'Tenant One command ' || series, 'green', 'submitted',
        '{"internal":"hidden"}'::jsonb, 'tenant-one-' || lpad(series::text, 4, '0'),
        '2026-08-12 00:00:00+00'::timestamptz + series * interval '1 second'
      from generate_series(1, 105) series;

      insert into public.commands (
        organization_id, project_id, submitted_by, prompt, requested_risk,
        status, parameters, idempotency_key, submitted_at
      )
      select
        '${organizationTwoId}', '${projectTwoId}', '${ownerTwoId}',
        'Tenant Two command ' || series, 'green', 'submitted',
        '{"internal":"hidden"}'::jsonb, 'tenant-two-' || lpad(series::text, 4, '0'),
        '2026-08-12 00:00:00+00'::timestamptz + series * interval '1 second'
      from generate_series(1, 2) series;

      insert into public.tasks (
        id, organization_id, project_id, assigned_agent_id, title, description,
        status, risk_level, priority, input, result, created_by, created_at
      ) values
        (
          '${taskOneId}', '${organizationOneId}', '${projectOneId}', '${agentOneId}',
          'Tenant One task 1', 'internal-only description', 'backlog', 'green', 50,
          '{"internal":"hidden"}'::jsonb, '{"internal":"hidden"}'::jsonb,
          '${ownerOneId}', '2026-08-12 00:00:01+00'
        ),
        (
          '${taskTwoId}', '${organizationTwoId}', '${projectTwoId}', '${agentTwoId}',
          'Tenant Two task 1', 'internal-only description', 'backlog', 'green', 50,
          '{"internal":"hidden"}'::jsonb, '{"internal":"hidden"}'::jsonb,
          '${ownerTwoId}', '2026-08-12 00:00:01+00'
        );

      insert into public.tasks (
        organization_id, project_id, assigned_agent_id, title, description,
        status, risk_level, priority, input, result, created_by, created_at
      )
      select
        '${organizationOneId}', '${projectOneId}', '${agentOneId}',
        'Tenant One task ' || series, 'internal-only description', 'backlog',
        'green', 50, '{"internal":"hidden"}'::jsonb, '{"internal":"hidden"}'::jsonb,
        '${ownerOneId}', '2026-08-12 00:00:00+00'::timestamptz + series * interval '1 second'
      from generate_series(2, 105) series;

      insert into public.tasks (
        organization_id, project_id, assigned_agent_id, title, status,
        risk_level, priority, created_by, created_at
      ) values (
        '${organizationTwoId}', '${projectTwoId}', '${agentTwoId}', 'Tenant Two task 2',
        'backlog', 'green', 50, '${ownerTwoId}', '2026-08-12 00:00:02+00'
      );

      insert into public.agent_runs (
        organization_id, project_id, task_id, agent_id, status,
        provider_run_reference, input, output, error_message, created_at
      )
      select
        '${organizationOneId}', '${projectOneId}', '${taskOneId}', '${agentOneId}',
        'queued', 'provider-internal-' || series, '{"internal":"hidden"}'::jsonb,
        '{"internal":"hidden"}'::jsonb, 'internal-only error detail',
        '2026-08-12 00:00:00+00'::timestamptz + series * interval '1 second'
      from generate_series(1, 105) series;

      insert into public.agent_runs (
        organization_id, project_id, task_id, agent_id, status,
        provider_run_reference, input, output, error_message, created_at
      )
      select
        '${organizationTwoId}', '${projectTwoId}', '${taskTwoId}', '${agentTwoId}',
        'queued', 'provider-internal-' || series, '{"internal":"hidden"}'::jsonb,
        '{"internal":"hidden"}'::jsonb, 'internal-only error detail',
        '2026-08-12 00:00:00+00'::timestamptz + series * interval '1 second'
      from generate_series(1, 2) series;

      insert into public.reports (
        organization_id, project_id, generated_by_agent_id, type, status,
        title, summary, content, created_at
      )
      select
        '${organizationOneId}', '${projectOneId}', '${agentOneId}', 'quality', 'draft',
        'Tenant One report ' || series, repeat('s', 1100),
        '{"internal":"hidden"}'::jsonb,
        '2026-08-12 00:00:00+00'::timestamptz + series * interval '1 second'
      from generate_series(1, 105) series;

      insert into public.reports (
        organization_id, project_id, generated_by_agent_id, type, status,
        title, summary, content, created_at
      )
      select
        '${organizationTwoId}', '${projectTwoId}', '${agentTwoId}', 'quality', 'draft',
        'Tenant Two report ' || series, 'Tenant Two summary',
        '{"internal":"hidden"}'::jsonb,
        '2026-08-12 00:00:00+00'::timestamptz + series * interval '1 second'
      from generate_series(1, 2) series;
    `);
  }, 120_000);

  afterEach(async () => {
    await resetRole(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("denies authenticated base-table SELECT on every protected list table", async () => {
    await assumeRole(db, "authenticated", viewerOneId);

    for (const table of targetTables) {
      await expect(db.query(`select id from public.${table} limit 1`))
        .rejects.toMatchObject({ code: "42501" });
    }
  });

  it("grants every safe RPC only to authenticated and denies anon and service role", async () => {
    await resetRole(db);
    for (const { rpc } of rpcCases) {
      const privileges = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        select
          pg_catalog.has_function_privilege(
            'anon', 'public.${rpc}(uuid,integer)', 'EXECUTE'
          ) as anon_execute,
          pg_catalog.has_function_privilege(
            'authenticated', 'public.${rpc}(uuid,integer)', 'EXECUTE'
          ) as authenticated_execute,
          pg_catalog.has_function_privilege(
            'service_role', 'public.${rpc}(uuid,integer)', 'EXECUTE'
          ) as service_execute
      `);
      expect(privileges.rows).toEqual([{
        anon_execute: false,
        authenticated_execute: true,
        service_execute: false,
      }]);
    }

    for (const role of ["anon", "service_role"] as const) {
      await assumeRole(db, role);
      for (const { rpc } of rpcCases) {
        await expect(listRows(db, rpc, organizationOneId, 1))
          .rejects.toMatchObject({ code: "42501" });
      }
    }
  });

  it("lets a viewer use every RPC but returns only the exact requested member tenant", async () => {
    await assumeRole(db, "authenticated", viewerOneId);

    for (const { field, rpc } of rpcCases) {
      const ownRows = await listRows(db, rpc, organizationOneId, 5);
      expect(ownRows.rows).toHaveLength(5);
      expect(ownRows.rows.every((row) => String(row[field]).startsWith("Tenant One"))).toBe(true);

      const crossTenantRows = await listRows(db, rpc, organizationTwoId, 100);
      expect(crossTenantRows.rows).toEqual([]);
    }

    await assumeRole(db, "authenticated", ownerTwoId);
    for (const { field, rpc } of rpcCases) {
      const ownRows = await listRows(db, rpc, organizationTwoId, 100);
      expect(ownRows.rows).toHaveLength(2);
      expect(ownRows.rows.every((row) => String(row[field]).startsWith("Tenant Two"))).toBe(true);

      const crossTenantRows = await listRows(db, rpc, organizationOneId, 100);
      expect(crossTenantRows.rows).toEqual([]);
    }
  });

  it("returns only the reviewed safe columns and bounds large text and JSON values", async () => {
    await assumeRole(db, "authenticated", viewerOneId);

    const expectedColumns = {
      list_agents: [
        "capabilities", "description", "id", "last_run_at", "model", "name",
        "provider", "role", "status",
      ],
      list_agent_runs: [
        "agent_id", "agent_name", "completed_at", "created_at", "id", "started_at",
        "status", "task_id", "task_title",
      ],
      list_commands: [
        "completed_at", "id", "project_id", "project_name", "prompt",
        "requested_risk", "status", "submitted_at",
      ],
      list_reports: [
        "created_at", "id", "period_end", "period_start", "project_id",
        "project_name", "published_at", "status", "summary", "title", "type",
      ],
      list_tasks: [
        "agent_name", "assigned_agent_id", "created_at", "id", "priority",
        "project_id", "project_name", "requires_owner_approval", "risk_level",
        "status", "title",
      ],
    } satisfies Record<(typeof rpcCases)[number]["rpc"], string[]>;

    for (const { rpc } of rpcCases) {
      const result = await listRows(db, rpc, organizationOneId, 1);
      expect(Object.keys(result.rows[0] ?? {}).sort()).toEqual(expectedColumns[rpc]);
    }

    const agents = await listRows(db, "list_agents", organizationOneId, 1);
    expect(String(agents.rows[0]?.description)).toHaveLength(1000);
    expect(agents.rows[0]?.capabilities).toEqual([]);

    const reports = await listRows(db, "list_reports", organizationOneId, 1);
    expect(String(reports.rows[0]?.summary)).toHaveLength(1000);
  });

  it("clamps every RPC to 1..100 rows and treats null as the default 50", async () => {
    await assumeRole(db, "authenticated", viewerOneId);

    for (const { rpc } of rpcCases) {
      expect((await listRows(db, rpc, organizationOneId, 0)).rows).toHaveLength(1);
      expect((await listRows(db, rpc, organizationOneId, 1_000)).rows).toHaveLength(100);
      expect((await listRows(db, rpc, organizationOneId, null)).rows).toHaveLength(50);
    }
  });

  it("keeps ENABLE and FORCE RLS on all five tables after the complete chain", async () => {
    const security = await db.query<{
      policy_count: number;
      relforcerowsecurity: boolean;
      relname: string;
      relrowsecurity: boolean;
    }>(`
      select
        class.relname,
        class.relrowsecurity,
        class.relforcerowsecurity,
        count(policy.oid)::integer as policy_count
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_catalog.pg_policy policy on policy.polrelid = class.oid
      where namespace.nspname = 'public'
        and class.relname = any (array['agents', 'commands', 'tasks', 'agent_runs', 'reports'])
      group by class.relname, class.relrowsecurity, class.relforcerowsecurity
      order by class.relname
    `);

    expect(security.rows).toHaveLength(5);
    for (const table of security.rows) {
      expect(table.relrowsecurity, `${table.relname} should have RLS enabled`).toBe(true);
      expect(table.relforcerowsecurity, `${table.relname} should force RLS`).toBe(true);
      expect(table.policy_count, `${table.relname} should retain a SELECT policy`).toBeGreaterThan(0);
    }
  });

  it("does not mistake BYPASSRLS for service-role table or RPC authorization", async () => {
    await resetRole(db);
    const privileges = await db.query<{
      can_select: boolean;
      table_name: string;
    }>(`
      select table_name,
        pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'SELECT')
          as can_select
      from unnest(array['agents', 'commands', 'tasks', 'agent_runs', 'reports']) table_name
      order by table_name
    `);
    expect(privileges.rows).toHaveLength(5);
    expect(privileges.rows.every((row) => row.can_select === false)).toBe(true);

    await assumeRole(db, "service_role");
    for (const table of targetTables) {
      await expect(db.query(`select id from public.${table} limit 1`))
        .rejects.toMatchObject({ code: "42501" });
    }
  });
});
