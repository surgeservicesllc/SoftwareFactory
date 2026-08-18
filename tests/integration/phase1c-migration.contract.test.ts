// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260818000100_removable_accounts_keep_usage_evidence.sql";
const ownerId = "00000000-0000-4000-8000-000000000101";
const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const connectionId = "30000000-0000-4000-8000-000000000001";
const installationId = "40000000-0000-4000-8000-000000000001";
const repositoryId = "50000000-0000-4000-8000-000000000001";
const unrelatedOwnerId = "00000000-0000-4000-8000-000000000201";
const unrelatedOrganizationId = "10000000-0000-4000-8000-000000000002";
const unrelatedProjectId = "20000000-0000-4000-8000-000000000002";
const reportId = "60000000-0000-4000-8000-000000000001";

type ApplicationRole = "anon" | "authenticated" | "service_role";

async function database() {
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
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  const migrations = (await readdir(migrationsRoot))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  expect(migrations.at(-1)).toBe(latestMigration);
  for (const migration of migrations) {
    await db.exec(await readFile(resolve(migrationsRoot, migration), "utf8"));
  }
  return db;
}

async function seedExecutableProject(db: PGlite) {
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}');
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'SoftwareFactory', 'phase1c-migration-contract', '${ownerId}');
    insert into public.projects (
      id, organization_id, name, status, github_repository, default_branch, created_by
    ) values (
      '${projectId}', '${organizationId}', 'SoftwareFactory', 'active',
      'surgeservicesllc/SoftwareFactory', 'main', '${ownerId}'
    );
    insert into public.connections (
      id, organization_id, name, provider, status, external_account_label,
      secret_reference, created_by
    ) values (
      '${connectionId}', '${organizationId}', 'GitHub App', 'github', 'connected',
      'surgeservicesllc', 'env://GITHUB_APP', '${ownerId}'
    );
    insert into public.github_installations (
      id, organization_id, connection_id, external_installation_id, app_id,
      app_slug, account_id, account_login, account_type, target_type,
      repository_selection, status, installed_at, created_by
    ) values (
      '${installationId}', '${organizationId}', '${connectionId}', 153445938, 4573846,
      'softwarefactory', 839271, 'surgeservicesllc', 'Organization', 'Organization',
      'selected', 'active', now(), '${ownerId}'
    );
    insert into public.github_repositories (
      id, organization_id, installation_id, external_repository_id, owner_login,
      name, full_name, default_branch, html_url, private, visibility, selected,
      github_updated_at
    ) values (
      '${repositoryId}', '${organizationId}', '${installationId}', 99887766,
      'surgeservicesllc', 'SoftwareFactory', 'surgeservicesllc/SoftwareFactory',
      'main', 'https://github.com/surgeservicesllc/SoftwareFactory', true, 'private', true, now()
    );
    insert into public.project_connections (
      organization_id, project_id, connection_id, github_repository_id, is_primary, created_by
    ) values (
      '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}', true, '${ownerId}'
    );
  `);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.exec("set role authenticated");
}

async function seedUnrelatedTenant(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec(`
    insert into auth.users (id) values ('${unrelatedOwnerId}');
    insert into public.organizations (id, name, slug, created_by)
    values (
      '${unrelatedOrganizationId}', 'Unrelated Factory',
      'phase1c-unrelated-tenant', '${unrelatedOwnerId}'
    );
    insert into public.projects (id, organization_id, name, status, created_by)
    values (
      '${unrelatedProjectId}', '${unrelatedOrganizationId}',
      'Unrelated Project', 'active', '${unrelatedOwnerId}'
    );
  `);
}

async function assumeRole(db: PGlite, role: ApplicationRole, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

function parameters(commandType: string, role: string) {
  return {
    acceptanceCriteria: ["The requested outcome is verified."],
    agentRole: role,
    budget: {
      ciTimeoutMs: 900000,
      maximumDurationMs: 2700000,
      maximumInputTokens: 200000,
      maximumOutputTokens: 50000,
      maximumRepairAttempts: 1,
      maximumTurns: 4,
    },
    commandType,
    dependencyTaskIds: [] as string[],
    executionMode: "manual",
    model: "gpt-5.3-codex",
    plan: {
      requiresDraftPullRequest: true,
      stages: [
        "inspect", "implement", "validate", "policy_scan", "commit",
        "draft_pull_request", "ci", "report",
      ],
      workflow: "codex_draft_pr",
    },
    provider: "openai",
    repositoryBinding: {
      appId: 4573846,
      baseBranch: "main",
      baseSha: "a".repeat(40),
      connectionId,
      externalInstallationId: 153445938,
      externalRepositoryId: 99887766,
      installationId,
      repositoryId,
    },
    riskAssessment: { requestedRisk: "green" },
  };
}

async function registerWorker(db: PGlite, workerId: string) {
  await db.exec("reset role");
  await db.exec("set role service_role");
  await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
    workerId, "1.0.0", JSON.stringify({ providers: ["openai"] }),
  ]);
}

async function claimRun(db: PGlite, workerId: string) {
  return db.query<{
    attempt_number: number;
    command_id: string;
    lease_token: string;
    maximum_duration_ms: number;
    maximum_input_tokens: number;
    maximum_output_tokens: number;
    maximum_turns: number;
    recovery_head_branch: string | null;
    recovery_head_sha: string | null;
    recovery_provider_run_reference: string | null;
    recovery_pull_request_number: number | null;
    recovery_pull_request_url: string | null;
    recovery_usage: Record<string, unknown>;
    run_id: string;
    task_id: string;
  }>("select * from public.claim_phase1c_run($1,$2,$3,$4)", [
    workerId, "openai", "gpt-5.3-codex", 120,
  ]);
}

async function submitAudit(db: PGlite, key: string, prompt = "Audit the dashboard behavior.") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.exec("set role authenticated");
  return db.query<{ command_id: string; task_id: string }>(
    "select command_id, task_id from public.submit_command($1,$2,$3,$4::jsonb,$5)",
    [projectId, prompt, "green", JSON.stringify(parameters("audit", "qa")), key],
  );
}

const browserFunctions = [
  "submit_command(uuid,text,risk_level,jsonb,text)",
  "resolve_phase1c_command_target(uuid,uuid)",
  "get_phase1c_worker_status(uuid)",
  "get_agent_run_detail(uuid,uuid)",
  "get_task_detail(uuid,uuid)",
  "get_agent_detail(uuid,uuid)",
  "get_report_detail(uuid,uuid)",
  "request_phase1c_run_cancellation(uuid,uuid,text)",
  "retry_phase1c_run(uuid,uuid,text)",
  "record_phase1c_dispatch_outcome(uuid,uuid,text,text)",
  "list_agents(uuid,integer)",
  "list_tasks(uuid,integer)",
  // Gained p_include_archived in 20260817000700, with a default, so the
  // two-argument call sites are unchanged and simply stop seeing archived runs.
  "list_agent_runs(uuid,integer,boolean)",
  "list_reports(uuid,integer)",
  "ensure_default_agents(uuid)",
  "get_provider_agent_assignment(uuid,uuid)",
  "list_provider_run_metrics(uuid,integer)",
] as const;

const durableExecutionTables = [
  { assignment: "created_at = created_at", name: "task_dependencies" },
  { assignment: "updated_at = updated_at", name: "phase1c_workers" },
  { assignment: "message = message", name: "phase1c_run_events" },
  { assignment: "reference = reference", name: "phase1c_run_artifacts" },
  { assignment: "output_summary = output_summary", name: "phase1c_run_validations" },
] as const;

async function expectDirectTableDenial(db: PGlite) {
  for (const table of durableExecutionTables) {
    await expect(
      db.query(`select * from public.${table.name} limit 1`),
      `${table.name} SELECT`,
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`insert into public.${table.name} default values`),
      `${table.name} INSERT`,
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`update public.${table.name} set ${table.assignment}`),
      `${table.name} UPDATE`,
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`delete from public.${table.name}`),
      `${table.name} DELETE`,
    ).rejects.toThrow(/permission denied/i);
  }
}

const workerFunctions = [
  "register_phase1c_worker(text,text,jsonb)",
  "heartbeat_phase1c_worker(text,uuid)",
  "finish_phase1c_worker(text,text)",
  "claim_phase1c_run(text,text,text,integer)",
  "heartbeat_phase1c_run(text,uuid,uuid,integer)",
  "append_phase1c_run_event(text,uuid,uuid,text,text,jsonb)",
  "record_phase1c_validation(text,uuid,uuid,integer,text,text,text,integer,text)",
  "record_phase1c_run_artifact(text,uuid,uuid,text,text,integer,jsonb)",
  "complete_phase1c_run(text,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,text,text,boolean)",
] as const;

/*
 * Every test here applies the whole migration chain to a fresh PGlite
 * instance, which takes seconds on its own and longer when the rest of the
 * suite is running in parallel. Most of these inherited the 5s default and so
 * failed intermittently in a full run -- a different test each time -- while
 * passing in isolation. The work is genuinely slow, so the budget is raised
 * rather than the assertions weakened.
 */
describe("Phase 1C migration contract", { timeout: 120_000 }, () => {
  it("applies the full chain with split enum and execution migrations", async () => {
    const db = await database();
    try {
      const enums = await db.query<{ role: string }>(`
        select unnest(enum_range(null::public.agent_role))::text as role
      `);
      expect(enums.rows.map((row) => row.role)).toEqual(expect.arrayContaining([
        "architect", "performance",
      ]));

      const tables = await db.query<{ table_name: string }>(`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'phase1c_%'
        order by table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "phase1c_run_artifacts",
        "phase1c_run_events",
        "phase1c_run_validations",
        "phase1c_workers",
      ]);
    } finally {
      await db.close();
    }
  }, 15_000);

  it("exposes only safe browser RPCs and service-role worker mutations", async () => {
    const db = await database();
    try {
      for (const signature of browserFunctions) {
        const privilege = await db.query<{ allowed: boolean }>(`
          select has_function_privilege('authenticated', 'public.${signature}', 'EXECUTE')
            and not has_function_privilege('anon', 'public.${signature}', 'EXECUTE')
            and not has_function_privilege('service_role', 'public.${signature}', 'EXECUTE')
            and not has_function_privilege('public', 'public.${signature}', 'EXECUTE') as allowed
        `);
        expect(privilege.rows[0]?.allowed, signature).toBe(true);
      }
      for (const signature of workerFunctions) {
        const privilege = await db.query<{ allowed: boolean }>(`
          select has_function_privilege('service_role', 'public.${signature}', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.${signature}', 'EXECUTE')
            and not has_function_privilege('anon', 'public.${signature}', 'EXECUTE')
            and not has_function_privilege('public', 'public.${signature}', 'EXECUTE') as allowed
        `);
        expect(privilege.rows[0]?.allowed, signature).toBe(true);
      }
      const internal = await db.query<{ closed: boolean }>(`
        select not has_function_privilege(
          'authenticated',
          'public.submit_command_phase1a_internal(uuid,text,risk_level,jsonb,text)',
          'EXECUTE'
        ) and not has_function_privilege(
          'service_role',
          'public.submit_command_phase1a_internal(uuid,text,risk_level,jsonb,text)',
          'EXECUTE'
        ) as closed
      `);
      expect(internal.rows[0]?.closed).toBe(true);

      const runDetailCatalog = await db.query<{
        function_config: string;
        identity_arguments: string;
        prosecdef: boolean;
        provolatile: string;
        result_type: string;
      }>(`
        select
          pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
          pg_catalog.pg_get_function_result(procedure.oid) as result_type,
          coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '') as function_config,
          procedure.prosecdef,
          procedure.provolatile
        from pg_catalog.pg_proc procedure
        where procedure.oid = 'public.get_agent_run_detail(uuid,uuid)'::regprocedure
      `);
      expect(runDetailCatalog.rows).toEqual([{
        function_config: "search_path=pg_catalog",
        identity_arguments: "p_organization_id uuid, p_run_id uuid",
        prosecdef: true,
        provolatile: "s",
        result_type: "TABLE(detail jsonb)",
      }]);
    } finally {
      await db.close();
    }
  });

  it("forces RLS and denies direct table grants on durable execution evidence", async () => {
    const db = await database();
    try {
      const state = await db.query<{
        relforcerowsecurity: boolean;
        relrowsecurity: boolean;
        table_name: string;
      }>(`
        select class.relname as table_name, class.relrowsecurity, class.relforcerowsecurity
        from pg_class class join pg_namespace namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'public'
          and class.relname in (
            'task_dependencies', 'phase1c_workers', 'phase1c_run_events',
            'phase1c_run_artifacts', 'phase1c_run_validations'
          ) order by class.relname
      `);
      expect(state.rows).toHaveLength(5);
      expect(state.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
      for (const row of state.rows) {
        const grants = await db.query<{ closed: boolean }>(`
          select not has_table_privilege('authenticated', 'public.${row.table_name}', 'SELECT,INSERT,UPDATE,DELETE')
            and not has_table_privilege('service_role', 'public.${row.table_name}', 'SELECT,INSERT,UPDATE,DELETE')
            as closed
        `);
        expect(grants.rows[0]?.closed, row.table_name).toBe(true);
      }
    } finally {
      await db.close();
    }
  });

  it("denies unrelated and anonymous callers across Phase 1C RPCs and direct tables", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await seedUnrelatedTenant(db);
      const submission = await submitAudit(db, "phase1c-tenant-denial");
      const taskId = submission.rows[0]!.task_id;

      await db.exec("reset role");
      const execution = await db.query<{ agent_id: string; run_id: string }>(`
        select run.agent_id, run.id as run_id
        from public.agent_runs run
        where run.command_id = $1
      `, [submission.rows[0]!.command_id]);
      const { agent_id: agentId, run_id: runId } = execution.rows[0]!;
      await db.query(`
        insert into public.reports (
          id, organization_id, project_id, generated_by_agent_id,
          type, status, title, summary, content
        ) values ($1,$2,$3,$4,'quality','draft',$5,$6,$7::jsonb)
      `, [
        reportId,
        organizationId,
        projectId,
        agentId,
        "Phase 1C tenant boundary report",
        "Bounded evidence for the caller's organization.",
        JSON.stringify({ findings: [], runIds: [runId], sections: [] }),
      ]);

      await assumeRole(db, "service_role");
      const worker = await db.query<{ worker_id: string }>(
        "select worker_id from public.register_phase1c_worker($1,$2,$3::jsonb)",
        ["worker.tenant-boundary", "1.0.0", JSON.stringify({ providers: ["openai"] })],
      );
      expect(worker.rows[0]?.worker_id).toBe("worker.tenant-boundary");

      const readInvocations = [
        { name: "list_agents", sql: "select * from public.list_agents($1,$2)", values: [organizationId, 100] },
        { name: "list_tasks", sql: "select * from public.list_tasks($1,$2)", values: [organizationId, 100] },
        { name: "list_agent_runs", sql: "select * from public.list_agent_runs($1,$2)", values: [organizationId, 100] },
        { name: "list_reports", sql: "select * from public.list_reports($1,$2)", values: [organizationId, 100] },
        { name: "get_agent_run_detail", sql: "select * from public.get_agent_run_detail($1,$2)", values: [organizationId, runId] },
        { name: "get_task_detail", sql: "select * from public.get_task_detail($1,$2)", values: [organizationId, taskId] },
        { name: "get_agent_detail", sql: "select * from public.get_agent_detail($1,$2)", values: [organizationId, agentId] },
        { name: "get_report_detail", sql: "select * from public.get_report_detail($1,$2)", values: [organizationId, reportId] },
        {
          name: "get_provider_agent_assignment",
          sql: "select * from public.get_provider_agent_assignment($1,$2)",
          values: [organizationId, agentId],
        },
        {
          name: "list_provider_run_metrics",
          sql: "select * from public.list_provider_run_metrics($1,$2)",
          values: [organizationId, 50],
        },
      ] as const;

      await assumeRole(db, "authenticated", ownerId);
      for (const invocation of readInvocations) {
        const visible = await db.query(invocation.sql, [...invocation.values]);
        expect(visible.rows.length, `${invocation.name} owner control`).toBeGreaterThan(0);
      }
      const visibleWorkerStatus = await db.query<{ detail: Record<string, unknown> | null }>(
        "select detail from public.get_phase1c_worker_status($1)",
        [organizationId],
      );
      expect(visibleWorkerStatus.rows[0]?.detail).not.toBeNull();

      const runDetail = await db.query<{
        detail: {
          routing: {
            candidates: unknown[];
            policyVersion: string;
            reasons: Array<{ code: string; detail: string; provider: string | null }>;
            source: string;
          };
        };
      }>("select detail from public.get_agent_run_detail($1,$2)", [organizationId, runId]);
      expect(runDetail.rows[0]?.detail.routing).toEqual({
        candidates: [],
        policyVersion: "phase1c-fixed-policy-v1",
        reasons: [
          {
            code: "PHASE1C_FIXED_PROVIDER_MODEL",
            detail: "Phase 1C server policy fixed this run to openai / gpt-5.3-codex.",
            provider: "openai",
          },
          {
            code: "LOGICAL_AGENT_ROLE_BOUND",
            detail: "Logical agent role qa was bound separately from provider identity.",
            provider: null,
          },
        ],
        source: "PHASE1C_FIXED_POLICY",
      });

      await assumeRole(db, "authenticated", unrelatedOwnerId);
      for (const invocation of readInvocations) {
        const hidden = await db.query(invocation.sql, [...invocation.values]);
        expect(hidden.rows, `${invocation.name} unrelated tenant`).toEqual([]);
      }
      const hiddenWorkerStatus = await db.query<{ detail: Record<string, unknown> | null }>(
        "select detail from public.get_phase1c_worker_status($1)",
        [organizationId],
      );
      expect(hiddenWorkerStatus.rows).toEqual([{ detail: null }]);

      const crossTenantMutations = [
        {
          name: "submit_command",
          sql: "select * from public.submit_command($1,$2,$3,$4::jsonb,$5)",
          values: [
            projectId,
            "Audit the dashboard behavior.",
            "green",
            JSON.stringify(parameters("audit", "qa")),
            "phase1c-cross-tenant-submit",
          ],
        },
        {
          name: "resolve_phase1c_command_target",
          sql: "select * from public.resolve_phase1c_command_target($1,$2)",
          values: [organizationId, projectId],
        },
        {
          name: "request_phase1c_run_cancellation",
          sql: "select * from public.request_phase1c_run_cancellation($1,$2,$3)",
          values: [organizationId, runId, "Unrelated tenant cancellation request."],
        },
        {
          name: "retry_phase1c_run",
          sql: "select * from public.retry_phase1c_run($1,$2,$3)",
          values: [organizationId, runId, "Unrelated tenant retry request."],
        },
        {
          name: "record_phase1c_dispatch_outcome",
          sql: "select * from public.record_phase1c_dispatch_outcome($1,$2,$3,$4)",
          values: [organizationId, submission.rows[0]!.command_id, "requested", null],
        },
        {
          name: "ensure_default_agents",
          sql: "select * from public.ensure_default_agents($1)",
          values: [organizationId],
        },
      ] as const;
      for (const invocation of crossTenantMutations) {
        await expect(
          db.query(invocation.sql, [...invocation.values]),
          `${invocation.name} unrelated tenant`,
        ).rejects.toThrow(/access|owner|administrator/i);
      }

      const anonymousInvocations = [
        ...readInvocations,
        ...crossTenantMutations,
        {
          name: "get_phase1c_worker_status",
          sql: "select * from public.get_phase1c_worker_status($1)",
          values: [organizationId],
        },
      ] as const;
      await assumeRole(db, "anon");
      for (const invocation of anonymousInvocations) {
        await expect(
          db.query(invocation.sql, [...invocation.values]),
          `${invocation.name} anonymous`,
        ).rejects.toThrow(/permission denied/i);
      }
      await expect(db.query(
        "select * from public.register_phase1c_worker($1,$2,$3::jsonb)",
        ["worker.anonymous", "1.0.0", "{}"],
      )).rejects.toThrow(/permission denied/i);
      await expectDirectTableDenial(db);

      await assumeRole(db, "authenticated", ownerId);
      await expect(db.query(
        "select * from public.register_phase1c_worker($1,$2,$3::jsonb)",
        ["worker.authenticated", "1.0.0", "{}"],
      )).rejects.toThrow(/permission denied/i);
      await expectDirectTableDenial(db);

      await assumeRole(db, "service_role");
      await expect(
        db.query("select * from public.list_agents($1,$2)", [organizationId, 50]),
      ).rejects.toThrow(/permission denied/i);
      await expectDirectTableDenial(db);

      await db.exec("reset role");
      const persistedWorker = await db.query<{ count: string }>(`
        select count(*)::text as count from public.phase1c_workers
        where worker_id = 'worker.tenant-boundary'
      `);
      expect(persistedWorker.rows[0]?.count).toBe("1");
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  }, 120_000);

  it("classifies direct RPC calls authoritatively and never queues RED work", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      const yellow = await db.query<{
        command_id: string;
        command_state: string;
        requires_owner_approval: boolean;
        task_id: string;
        task_state: string;
      }>("select * from public.submit_command($1,$2,$3,$4::jsonb,$5)", [
        projectId,
        "Build a new dashboard feature.",
        "green",
        JSON.stringify(parameters("build_feature", "architect")),
        "phase1c-yellow-contract",
      ]);
      expect(yellow.rows[0]).toMatchObject({
        command_state: "queued",
        requires_owner_approval: false,
        task_state: "queued",
      });
      await db.exec("reset role");
      const yellowEvidence = await db.query<{ requested_risk: string; run_count: number }>(`
        select command.requested_risk::text,
          (select count(*)::integer from public.agent_runs run where run.command_id = command.id) as run_count
        from public.commands command where command.id = $1
      `, [yellow.rows[0]!.command_id]);
      expect(yellowEvidence.rows[0]).toEqual({ requested_risk: "yellow", run_count: 1 });

      await db.exec("set role authenticated");
      const red = await db.query<{
        command_id: string;
        command_state: string;
        requires_owner_approval: boolean;
        task_id: string;
        task_state: string;
      }>("select * from public.submit_command($1,$2,$3,$4::jsonb,$5)", [
        projectId,
        "Rotate the service role secret.",
        "green",
        JSON.stringify(parameters("audit", "qa")),
        "phase1c-red-contract",
      ]);
      expect(red.rows[0]).toMatchObject({
        command_state: "awaiting_approval",
        requires_owner_approval: true,
        task_state: "awaiting_approval",
      });
      await db.exec("reset role");
      const redEvidence = await db.query<{ requested_risk: string; run_count: number }>(`
        select command.requested_risk::text,
          (select count(*)::integer from public.agent_runs run where run.command_id = command.id) as run_count
        from public.commands command where command.id = $1
      `, [red.rows[0]!.command_id]);
      expect(redEvidence.rows[0]).toEqual({ requested_risk: "red", run_count: 0 });

      const approval = await db.query<{ id: string }>(`
        select id from public.approvals where command_id = $1
      `, [red.rows[0]!.command_id]);
      await db.exec("set role authenticated");
      await db.query("select * from public.decide_approval($1,'approved',$2)", [
        approval.rows[0]!.id,
        "Owner reviewed the request; Phase 1C must still remain blocked.",
      ]);
      await db.exec("reset role");
      const afterApproval = await db.query<{
        command_state: string;
        run_count: number;
        task_state: string;
      }>(`
        select command.status::text as command_state, task.status::text as task_state,
          (select count(*)::integer from public.agent_runs run where run.command_id = command.id) as run_count
        from public.commands command join public.tasks task on task.command_id = command.id
        where command.id = $1
      `, [red.rows[0]!.command_id]);
      expect(afterApproval.rows[0]).toEqual({
        command_state: "awaiting_approval",
        run_count: 0,
        task_state: "awaiting_approval",
      });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a browser-supplied execution model, budget, or role", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      const invalid = parameters("audit", "qa");
      invalid.model = "unapproved-model";
      await expect(db.query(
        "select * from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [projectId, "Audit the UI.", "green", JSON.stringify(invalid), "phase1c-invalid-model"],
      )).rejects.toThrow(/execution configuration is not supported/i);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("makes validation and artifact retries exact-idempotent and closes ephemeral workers", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await db.query("select * from public.submit_command($1,$2,$3,$4::jsonb,$5)", [
        projectId,
        "Audit the dashboard behavior.",
        "green",
        JSON.stringify(parameters("audit", "qa")),
        "phase1c-evidence-replay",
      ]);
      await db.exec("reset role");
      await db.exec("set role service_role");
      await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
        "worker.contract", "1.0.0", JSON.stringify({ providers: ["openai"] }),
      ]);
      const claim = await db.query<{ lease_token: string; run_id: string }>(
        "select run_id, lease_token from public.claim_phase1c_run($1,$2,$3,$4)",
        ["worker.contract", "openai", "gpt-5.3-codex", 120],
      );
      const run = claim.rows[0]!;

      const firstValidation = await db.query<{ id: string }>(`
        select public.record_phase1c_validation($1,$2,$3,$4,$5,$6,$7,$8,$9) as id
      `, ["worker.contract", run.run_id, run.lease_token, 1, "diff-check", "git diff --check", "passed", 12, "clean"]);
      const replayValidation = await db.query<{ id: string }>(`
        select public.record_phase1c_validation($1,$2,$3,$4,$5,$6,$7,$8,$9) as id
      `, ["worker.contract", run.run_id, run.lease_token, 1, "diff-check", "git diff --check", "passed", 12, "clean"]);
      expect(replayValidation.rows[0]!.id).toBe(firstValidation.rows[0]!.id);
      await expect(db.query(
        "select public.record_phase1c_validation($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        ["worker.contract", run.run_id, run.lease_token, 1, "diff-check", "git diff --check", "failed", 12, "not clean"],
      )).rejects.toThrow(/replay conflicts/i);

      const firstArtifact = await db.query<{ id: string }>(`
        select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb) as id
      `, ["worker.contract", run.run_id, run.lease_token, "branch", "factory/contract", null, JSON.stringify({ protected: false })]);
      const replayArtifact = await db.query<{ id: string }>(`
        select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb) as id
      `, ["worker.contract", run.run_id, run.lease_token, "branch", "factory/contract", null, JSON.stringify({ protected: false })]);
      expect(replayArtifact.rows[0]!.id).toBe(firstArtifact.rows[0]!.id);
      await expect(db.query(
        "select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)",
        ["worker.contract", run.run_id, run.lease_token, "branch", "factory/contract", null, JSON.stringify({ protected: true })],
      )).rejects.toThrow(/replay conflicts/i);

      const commitSha = "c".repeat(40);
      await db.query(
        "select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)",
        ["worker.contract", run.run_id, run.lease_token, "commit", commitSha, null, "{}"],
      );
      await expect(db.query(
        "select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)",
        ["worker.contract", run.run_id, run.lease_token, "pull_request",
          "https://github.com/another/repository/pull/12", 12, JSON.stringify({ commitSha })],
      )).rejects.toThrow(/invalid or incoherent pull request artifact/i);
      await expect(db.query(
        "select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)",
        ["worker.contract", run.run_id, run.lease_token, "pull_request",
          "https://github.com/surgeservicesllc/SoftwareFactory/pull/13", 12, JSON.stringify({ commitSha })],
      )).rejects.toThrow(/invalid or incoherent pull request artifact/i);
      await expect(db.query(
        "select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)",
        ["worker.contract", run.run_id, run.lease_token, "pull_request_head", commitSha, 12,
          JSON.stringify({ pullRequestUrl: "https://github.com/surgeservicesllc/SoftwareFactory/pull/13" })],
      )).rejects.toThrow(/invalid or incoherent pull request head artifact/i);

      await db.query("select * from public.finish_phase1c_worker($1,$2)", [
        "worker.contract", "idle",
      ]);
      await db.exec("reset role");
      await db.exec("set role authenticated");
      const status = await db.query<{ detail: { activeWorkers: number; availableWorkers: number; connectionStatus: string } }>(
        "select * from public.get_phase1c_worker_status($1)", [organizationId],
      );
      expect(status.rows[0]!.detail).toMatchObject({
        activeWorkers: 0, availableWorkers: 1, connectionStatus: "connected",
      });
      await db.exec("reset role");
      await db.exec("set role service_role");
      await db.query("select * from public.finish_phase1c_worker($1,$2)", [
        "worker.contract", "disabled",
      ]);
      await db.exec("reset role");
      await db.exec("set role authenticated");
      const disabled = await db.query<{ detail: { availableWorkers: number; connectionStatus: string } }>(
        "select * from public.get_phase1c_worker_status($1)", [organizationId],
      );
      expect(disabled.rows[0]!.detail).toMatchObject({ availableWorkers: 0, connectionStatus: "not_connected" });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("persists the complete provider-neutral roster for existing and future organizations", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await db.exec("reset role");
      const roster = await db.query<{
        model: string | null;
        name: string;
        provider: string | null;
        role: string;
      }>(`
        select name, role::text, provider, model from public.agents
        where organization_id = $1 order by array_position(
          array['orchestrator','product','architect','frontend','backend','database',
            'qa','security','performance','release','ceo_reporter'], role::text
        )
      `, [organizationId]);
      expect(roster.rows.map((agent) => agent.name)).toEqual([
        "Orchestrator", "Product", "Architect", "Frontend", "Backend", "Database",
        "QA", "Security", "Performance", "Release", "CEO Reporter",
      ]);
      expect(roster.rows).toHaveLength(11);
      expect(roster.rows.every((agent) => agent.provider === null && agent.model === null)).toBe(true);

      const futureUser = "00000000-0000-4000-8000-000000000202";
      const futureOrganization = "10000000-0000-4000-8000-000000000002";
      await db.exec(`
        insert into auth.users (id) values ('${futureUser}');
        insert into public.organizations (id, name, slug, created_by)
        values ('${futureOrganization}', 'Future Factory', 'future-factory-roster', '${futureUser}');
      `);
      const futureCount = await db.query<{ count: number }>(`
        select count(*)::integer as count from public.agents
        where organization_id = $1 and project_id is null and provider is null and model is null
      `, [futureOrganization]);
      expect(futureCount.rows[0]!.count).toBe(11);

      const initializerAcl = await db.query<{ closed: boolean }>(`
        select not has_function_privilege('authenticated',
          'public.initialize_standard_logical_agent_roster(uuid,uuid)', 'EXECUTE')
          and not has_function_privilege('service_role',
          'public.initialize_standard_logical_agent_roster(uuid,uuid)', 'EXECUTE')
          and not has_function_privilege('public',
          'public.initialize_standard_logical_agent_roster(uuid,uuid)', 'EXECUTE') as closed
      `);
      expect(initializerAcl.rows[0]!.closed).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("assigns work to the neutral role while keeping provider and model on the run", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      const submission = await db.query<{ task_id: string }>(
        "select task_id from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [
          projectId,
          "Build a new dashboard feature.",
          "green",
          JSON.stringify(parameters("build_feature", "architect")),
          "phase1c-neutral-agent",
        ],
      );
      await db.exec("reset role");
      const binding = await db.query<{
        agent_model: string | null;
        agent_provider: string | null;
        agent_role: string;
        run_model: string;
        run_provider: string;
      }>(`
        select agent.role::text as agent_role, agent.provider as agent_provider,
          agent.model as agent_model, run.provider as run_provider, run.model as run_model
        from public.tasks task join public.agents agent on agent.id = task.assigned_agent_id
        join public.agent_runs run on run.task_id = task.id where task.id = $1
      `, [submission.rows[0]!.task_id]);
      expect(binding.rows[0]).toEqual({
        agent_model: null,
        agent_provider: null,
        agent_role: "architect",
        run_model: "gpt-5.3-codex",
        run_provider: "openai",
      });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("maps other work to Orchestrator and never creates a custom provider identity", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      const submission = await db.query<{ task_id: string }>(
        "select task_id from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [
          projectId,
          "Review general engineering configuration.",
          "green",
          JSON.stringify(parameters("other", "custom")),
          "phase1c-other-orchestrator",
        ],
      );
      await db.exec("reset role");
      const agent = await db.query<{ name: string; provider: string | null; role: string }>(`
        select agent.name, agent.role::text, agent.provider from public.tasks task
        join public.agents agent on agent.id = task.assigned_agent_id where task.id = $1
      `, [submission.rows[0]!.task_id]);
      expect(agent.rows[0]).toEqual({ name: "Orchestrator", provider: null, role: "orchestrator" });
      const customCount = await db.query<{ count: number }>(`
        select count(*)::integer as count from public.agents
        where organization_id = $1 and role = 'custom'::public.agent_role
      `, [organizationId]);
      expect(customCount.rows[0]!.count).toBe(0);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("allows only the organization owner to submit commands directly", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await db.exec("reset role");
      const adminId = "00000000-0000-4000-8000-000000000102";
      const memberId = "00000000-0000-4000-8000-000000000103";
      await db.exec(`
        insert into auth.users (id) values ('${adminId}'), ('${memberId}');
        insert into public.organization_members (organization_id, user_id, role, created_by) values
          ('${organizationId}', '${adminId}', 'admin', '${ownerId}'),
          ('${organizationId}', '${memberId}', 'member', '${ownerId}');
      `);
      for (const actorId of [adminId, memberId]) {
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId]);
        await db.exec("set role authenticated");
        await expect(db.query(
          "select * from public.submit_command($1,$2,$3,$4::jsonb,$5)",
          [projectId, "Audit the UI.", "green", JSON.stringify(parameters("audit", "qa")), `owner-only-${actorId.slice(-3)}`],
        )).rejects.toThrow(/only an organization owner/i);
        await db.exec("reset role");
      }
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      await db.exec("set role authenticated");
      const ownerResult = await db.query<{ task_state: string }>(
        "select task_state from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [projectId, "Audit the UI.", "green", JSON.stringify(parameters("audit", "qa")), "owner-only-accepted"],
      );
      expect(ownerResult.rows[0]!.task_state).toBe("queued");
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it.each([
    "Change auth behavior.",
    "Change the session cookie behavior.",
    "Update RBAC permissions.",
    "Drop table audit_history.",
    "Truncate production data.",
    "Transfer domain ownership.",
    "Change how money is processed.",
  ])("raises a direct authenticated RPC containing %s to RED", async (prompt) => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      const result = await db.query<{
        command_id: string;
        command_state: string;
        requires_owner_approval: boolean;
        task_state: string;
      }>("select * from public.submit_command($1,$2,$3,$4::jsonb,$5)", [
        projectId,
        prompt,
        "green",
        JSON.stringify(parameters("audit", "qa")),
        `classification-${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      ]);
      expect(result.rows[0]).toMatchObject({
        command_state: "awaiting_approval",
        requires_owner_approval: true,
        task_state: "awaiting_approval",
      });
      await db.exec("reset role");
      const persisted = await db.query<{ requested_risk: string; runs: number }>(`
        select command.requested_risk::text,
          (select count(*)::integer from public.agent_runs run where run.command_id = command.id) as runs
        from public.commands command where command.id = $1
      `, [result.rows[0]!.command_id]);
      expect(persisted.rows[0]).toEqual({ requested_risk: "red", runs: 0 });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("classifies acceptance criteria as part of the authoritative risk floor", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      const riskyCriteria = parameters("audit", "qa");
      riskyCriteria.acceptanceCriteria = ["Change auth behavior and verify the result."];
      const result = await db.query<{ command_id: string; command_state: string }>(
        "select command_id, command_state from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [projectId, "Review the current behavior.", "green", JSON.stringify(riskyCriteria), "risk-in-criteria"],
      );
      expect(result.rows[0]!.command_state).toBe("awaiting_approval");
      await db.exec("reset role");
      const evidence = await db.query<{ risk: string; runs: number }>(`
        select requested_risk::text as risk,
          (select count(*)::integer from public.agent_runs run where run.command_id = command.id) as runs
        from public.commands command where command.id = $1
      `, [result.rows[0]!.command_id]);
      expect(evidence.rows[0]).toEqual({ risk: "red", runs: 0 });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects unrecognized command parameter keys at the database boundary", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      const invalid = { ...parameters("audit", "qa"), untrustedOverride: true };
      await expect(db.query(
        "select * from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [projectId, "Audit the UI.", "green", JSON.stringify(invalid), "unknown-parameter"],
      )).rejects.toThrow(/invalid or unsupported Phase 1C command parameters/i);
      const oversized = parameters("audit", "qa");
      oversized.riskAssessment = {
        requestedRisk: "green",
        evidence: "x".repeat(70_000),
      } as typeof oversized.riskAssessment;
      await expect(db.query(
        "select * from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [projectId, "Audit the UI.", "green", JSON.stringify(oversized), "oversized-parameter"],
      )).rejects.toThrow(/invalid or unsupported Phase 1C command parameters/i);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it.each([
    { label: "non-string", criteria: [1] },
    { label: "too-short", criteria: ["x"] },
    { label: "too-long", criteria: ["x".repeat(501)] },
    { label: "secret-like", criteria: ["Bearer abcdefghijklmnopqrstuvwxyz123456"] },
  ])("rejects malformed $label acceptance criteria before any run is queued", async ({ criteria, label }) => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      const invalid = parameters("audit", "qa");
      invalid.acceptanceCriteria = criteria as string[];
      await expect(db.query(
        "select * from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [projectId, "Audit the UI.", "green", JSON.stringify(invalid), `invalid-criteria-${label}`],
      )).rejects.toThrow(/invalid (or unsupported )?Phase 1C command (plan|parameters)|sensitive/i);
      await db.exec("reset role");
      const counts = await db.query<{ commands: number; runs: number }>(`
        select (select count(*)::integer from public.commands) as commands,
          (select count(*)::integer from public.agent_runs) as runs
      `);
      expect(counts.rows[0]).toEqual({ commands: 0, runs: 0 });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("persists canonical dependencies, repairs exact replays, and claims only after prerequisites complete", async () => {
    const db = await database();
    const prerequisiteIds = [
      "71000000-0000-4000-8000-000000000001",
      "71000000-0000-4000-8000-000000000002",
    ];
    const workerId = "worker.dependencies";
    try {
      await seedExecutableProject(db);
      await db.exec("reset role");
      await db.query(`
        insert into public.tasks (
          id, organization_id, project_id, title, status, risk_level, created_by
        ) values
          ($1, $3, $4, 'First prerequisite', 'backlog', 'green', $5),
          ($2, $3, $4, 'Second prerequisite', 'backlog', 'green', $5)
      `, [prerequisiteIds[0], prerequisiteIds[1], organizationId, projectId, ownerId]);

      await assumeRole(db, "authenticated", ownerId);
      const submittedParameters = parameters("audit", "qa");
      submittedParameters.acceptanceCriteria = [];
      submittedParameters.dependencyTaskIds = prerequisiteIds;
      const first = await db.query<{
        task_id: string;
        was_created: boolean;
      }>("select task_id, was_created from public.submit_command($1,$2,$3,$4::jsonb,$5)", [
        projectId,
        "Audit the dependent workflow.",
        "green",
        JSON.stringify(submittedParameters),
        "phase1c-dependency-contract",
      ]);
      expect(first.rows[0]!.was_created).toBe(true);

      await db.exec("reset role");
      const persisted = await db.query<{
        acceptance_criteria: string[];
        created_by: string;
        dependency_id: string;
      }>(`
        select dependency.depends_on_task_id::text as dependency_id,
          dependency.created_by::text,
          command.acceptance_criteria
        from public.task_dependencies dependency
        join public.tasks task on task.id = dependency.task_id
        join public.commands command on command.id = task.command_id
        where dependency.task_id = $1
        order by dependency.depends_on_task_id
      `, [first.rows[0]!.task_id]);
      expect(persisted.rows).toEqual(prerequisiteIds.map((dependencyId) => ({
        acceptance_criteria: [
          "The audit findings are documented with cited evidence and prioritized follow-up.",
        ],
        created_by: ownerId,
        dependency_id: dependencyId,
      })));

      await db.query(`delete from public.task_dependencies
        where task_id = $1 and depends_on_task_id = $2`, [
        first.rows[0]!.task_id, prerequisiteIds[1],
      ]);
      const unorderedWithDuplicate = [prerequisiteIds[1], prerequisiteIds[0], prerequisiteIds[1]];
      const canonicalReplayIds = [...new Set(unorderedWithDuplicate)].sort();
      expect(canonicalReplayIds).toEqual(prerequisiteIds);
      const replayParameters = parameters("audit", "qa");
      replayParameters.acceptanceCriteria = [];
      replayParameters.dependencyTaskIds = canonicalReplayIds;
      await assumeRole(db, "authenticated", ownerId);
      const replay = await db.query<{ task_id: string; was_created: boolean }>(
        "select task_id, was_created from public.submit_command($1,$2,$3,$4::jsonb,$5)",
        [projectId, "Audit the dependent workflow.", "green", JSON.stringify(replayParameters),
          "phase1c-dependency-contract"],
      );
      expect(replay.rows[0]).toEqual({ task_id: first.rows[0]!.task_id, was_created: false });

      await registerWorker(db, workerId);
      expect((await claimRun(db, workerId)).rows).toHaveLength(0);
      await db.exec("reset role");
      const repaired = await db.query<{ dependency_ids: string[] }>(`
        select array_agg(depends_on_task_id::text order by depends_on_task_id) as dependency_ids
        from public.task_dependencies where task_id = $1
      `, [first.rows[0]!.task_id]);
      expect(repaired.rows[0]!.dependency_ids).toEqual(prerequisiteIds);

      await db.query(`update public.tasks set status = 'completed', completed_at = now()
        where id = any($1::uuid[])`, [prerequisiteIds]);
      await registerWorker(db, workerId);
      const claimed = await claimRun(db, workerId);
      expect(claimed.rows).toHaveLength(1);
      expect(claimed.rows[0]!.task_id).toBe(first.rows[0]!.task_id);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("reports neutral provider status as unavailable and serializes work by logical agent", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "serialize-qa-one");
      await submitAudit(db, "serialize-qa-two");
      await registerWorker(db, "worker.qa.one");
      const first = await claimRun(db, "worker.qa.one");
      expect(first.rows).toHaveLength(1);
      await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
        "worker.qa.two", "1.0.0", JSON.stringify({ providers: ["openai"] }),
      ]);
      const second = await claimRun(db, "worker.qa.two");
      expect(second.rows).toHaveLength(0);

      await db.exec("reset role");
      await db.exec("set role authenticated");
      const listed = await db.query<{
        id: string;
        provider_connection_status: string | null;
      }>("select id, provider_connection_status from public.list_agents($1,$2) where role = 'qa'", [
        organizationId, 100,
      ]);
      expect(listed.rows[0]!.provider_connection_status).toBeNull();
      const detail = await db.query<{ detail: { providerConnectionStatus: string | null } }>(
        "select * from public.get_agent_detail($1,$2)", [organizationId, listed.rows[0]!.id],
      );
      expect(detail.rows[0]!.detail.providerConnectionStatus).toBeNull();
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects legacy pull-request evidence outside the authorized repository", async () => {
    const db = await database();
    const workerId = "worker.legacy-pr";
    const branch = "factory/legacy-pr-evidence";
    const commitSha = "f".repeat(40);
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "legacy-pr-evidence-contract");
      await registerWorker(db, workerId);
      const run = (await claimRun(db, workerId)).rows[0]!;
      await db.query("select public.record_phase1c_validation($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
        workerId, run.run_id, run.lease_token, 1, "diff-check", "git diff --check", "passed", 5, "clean",
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, run.run_id, run.lease_token, "branch", branch, null, "{}",
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, run.run_id, run.lease_token, "commit", commitSha, null, "{}",
      ]);
      // Simulate a pre-030 artifact that bypassed the newer canonical URL guard.
      await db.exec("reset role");
      await db.query(`insert into public.phase1c_run_artifacts (
        organization_id, run_id, attempt_number, artifact_type, reference, external_number, metadata
      ) values ($1,$2,1,'pull_request',$3,42,$4::jsonb)`, [
        organizationId, run.run_id, "https://github.com/another/repository/pull/42",
        JSON.stringify({ commitSha }),
      ]);
      await db.exec("set role service_role");
      await expect(db.query(
        "select * from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)",
        [workerId, run.run_id, run.lease_token, "succeeded", "Invalid evidence must not succeed.",
          null, "{}", "[]", JSON.stringify([{ name: "CI", status: "completed", conclusion: "success" }]),
          null, null, false],
      )).rejects.toThrow(/authorized repository/i);
      await db.exec("reset role");
      const state = await db.query<{ pull_count: number; status: string }>(`
        select run.status::text as status,
          (select count(*)::integer from public.pull_requests pull where pull.agent_run_id = run.id) as pull_count
        from public.agent_runs run where run.id = $1
      `, [run.run_id]);
      expect(state.rows[0]).toEqual({ pull_count: 0, status: "running" });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("recovers a coherent draft PR, preserves provider evidence, and publishes structured reports", async () => {
    const db = await database();
    const workerId = "worker.recovery";
    const headBranch = "factory/recovery-contract";
    const headSha = "b".repeat(40);
    const pullUrl = "https://github.com/surgeservicesllc/SoftwareFactory/pull/77";
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "recover-draft-contract");
      await registerWorker(db, workerId);
      const firstClaim = await claimRun(db, workerId);
      const first = firstClaim.rows[0]!;
      await db.query("select public.record_phase1c_validation($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
        workerId, first.run_id, first.lease_token, 1, "diff-check", "git diff --check", "passed", 8, "clean",
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, first.run_id, first.lease_token, "branch", headBranch, null, JSON.stringify({ protected: false }),
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, first.run_id, first.lease_token, "commit", headSha, null, JSON.stringify({ branch: headBranch }),
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, first.run_id, first.lease_token, "pull_request", pullUrl, 77,
        JSON.stringify({ commitSha: headSha }),
      ]);
      await db.query("select * from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)", [
        workerId, first.run_id, first.lease_token, "failed", "CI temporarily unavailable.",
        "provider-run-77", JSON.stringify({ inputTokens: 1200, outputTokens: 200 }),
        JSON.stringify(["app/page.tsx"]), JSON.stringify([{ name: "ci", status: "failed" }]),
        "ci_unavailable", "The provider check timed out.", true,
      ]);
      await db.exec("reset role");
      const failedEvidence = await db.query<{
        report_outcome: string;
        pull_status: string;
      }>(`
        select pull.status::text as pull_status, report.content ->> 'outcome' as report_outcome
        from public.pull_requests pull cross join lateral (
          select content from public.reports report
          where report.organization_id = pull.organization_id
            and report.content -> 'runIds' @> jsonb_build_array(pull.agent_run_id)
          order by report.created_at desc limit 1
        ) report where pull.agent_run_id = $1
      `, [first.run_id]);
      expect(failedEvidence.rows[0]).toEqual({ pull_status: "draft", report_outcome: "failed" });

      await db.exec("set role authenticated");
      await db.query("select * from public.retry_phase1c_run($1,$2,$3)", [
        organizationId, first.run_id, "Retry the transient CI provider timeout.",
      ]);
      await db.exec("reset role");
      await db.exec("set role service_role");
      await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
        workerId, "1.0.0", JSON.stringify({ providers: ["openai"] }),
      ]);
      const recoveryClaim = await claimRun(db, workerId);
      expect(recoveryClaim.rows[0]).toMatchObject({
        attempt_number: 2,
        recovery_head_branch: headBranch,
        recovery_head_sha: headSha,
        recovery_provider_run_reference: "provider-run-77",
        recovery_pull_request_number: 77,
        recovery_pull_request_url: pullUrl,
        recovery_usage: { inputTokens: 1200, outputTokens: 200 },
      });
      const recovery = recoveryClaim.rows[0]!;
      await db.query("select * from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)", [
        workerId, recovery.run_id, recovery.lease_token, "succeeded", "Recovered draft passed CI.",
        "provider-run-77", JSON.stringify({ inputTokens: 1200, outputTokens: 200 }),
        JSON.stringify(["app/page.tsx"]), JSON.stringify([{ name: "ci", status: "passed" }]),
        null, null, false,
      ]);
      await db.exec("reset role");
      const finalEvidence = await db.query<{
        decisions: unknown[];
        outcome: string;
        pull_count: number;
        report_id: string;
        validation_count: number;
      }>(`
        select report.id as report_id, report.content ->> 'outcome' as outcome,
          jsonb_array_length(report.content -> 'validations') as validation_count,
          jsonb_array_length(report.content -> 'pullRequests') as pull_count,
          report.content -> 'decisions' as decisions
        from public.reports report
        where report.content -> 'runIds' @> jsonb_build_array($1::uuid)
        order by report.created_at desc limit 1
      `, [first.run_id]);
      expect(finalEvidence.rows[0]).toMatchObject({
        outcome: "succeeded", pull_count: 1,
      });
      expect(finalEvidence.rows[0]!.validation_count).toBeGreaterThan(0);
      expect(finalEvidence.rows[0]!.decisions).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: "Bounded retry requested", status: "recorded" }),
      ]));
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      await db.exec("set role authenticated");
      const reportDetail = await db.query<{ detail: Record<string, unknown> }>(
        "select * from public.get_report_detail($1,$2)",
        [organizationId, finalEvidence.rows[0]!.report_id],
      );
      expect(reportDetail.rows[0]!.detail).toMatchObject({
        changedFiles: ["app/page.tsx"],
        checks: [expect.objectContaining({ name: "ci", status: "passed" })],
        security: expect.objectContaining({ risk: "green" }),
        validations: expect.arrayContaining([expect.objectContaining({ name: "diff-check", status: "passed" })]),
      });
      await db.exec("reset role");
      const activity = await db.query<{ agent_completed: number; pull_created: number }>(`
        select count(*) filter (where event_type = 'agent.completed' and entity_id = $2)::integer
            as agent_completed,
          count(*) filter (where event_type = 'pull_request.created')::integer as pull_created
        from public.activity_events where organization_id = $1
      `, [organizationId, first.run_id]);
      expect(activity.rows[0]!.agent_completed).toBe(1);
      expect(activity.rows[0]!.pull_created).toBe(1);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("carries cumulative usage into remaining retry budgets and rejects exhausted retries and claims", async () => {
    const db = await database();
    const workerId = "worker.cumulative-budget";
    const partialUsage = {
      cachedInputTokens: 1_000,
      inputTokens: 120_000,
      outputTokens: 30_000,
      reasoningOutputTokens: 500,
      turns: 2,
    };
    const exhaustedUsage = {
      cachedInputTokens: 1_500,
      inputTokens: 130_000,
      outputTokens: 31_000,
      reasoningOutputTokens: 750,
      turns: 4,
    };
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "cumulative-budget-contract");
      await registerWorker(db, workerId);
      const first = (await claimRun(db, workerId)).rows[0]!;
      await db.query(
        "select * from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)",
        [workerId, first.run_id, first.lease_token, "failed", "Provider failed before commit evidence.",
          null, JSON.stringify(partialUsage), "[]", "[]", "provider_timeout",
          "The provider timed out before a commit was created.", true],
      );

      await assumeRole(db, "authenticated", ownerId);
      await db.query("select * from public.retry_phase1c_run($1,$2,$3)", [
        organizationId, first.run_id, "Retry within the remaining cumulative provider budget.",
      ]);
      await registerWorker(db, workerId);
      const second = (await claimRun(db, workerId)).rows[0]!;
      expect(second).toMatchObject({
        attempt_number: 2,
        maximum_input_tokens: 80_000,
        maximum_output_tokens: 20_000,
        maximum_turns: 2,
        recovery_head_branch: null,
        recovery_head_sha: null,
        recovery_provider_run_reference: null,
        recovery_pull_request_number: null,
        recovery_pull_request_url: null,
        recovery_usage: partialUsage,
      });

      await db.query(
        "select * from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)",
        [workerId, second.run_id, second.lease_token, "failed", "Cumulative turn budget exhausted.",
          null, JSON.stringify(exhaustedUsage), "[]", "[]", "provider_timeout",
          "The provider exhausted the configured cumulative turn budget.", true],
      );
      await assumeRole(db, "authenticated", ownerId);
      await expect(db.query("select * from public.retry_phase1c_run($1,$2,$3)", [
        organizationId, second.run_id, "This retry must be rejected as exhausted.",
      ])).rejects.toThrow(/not eligible for a bounded retry/i);

      await db.exec("reset role");
      const exhausted = await db.query<{ retryable: boolean; usage: Record<string, number> }>(`
        select retryable, usage from public.agent_runs where id = $1
      `, [second.run_id]);
      expect(exhausted.rows[0]).toEqual({ retryable: false, usage: exhaustedUsage });

      // Simulate a corrupted queue transition to prove claim independently
      // rejects persisted usage that has consumed any configured total.
      await db.query(`update public.agent_runs set status = 'queued', retryable = true,
        attempt_number = 1, lease_worker_id = null, lease_token = null,
        lease_expires_at = null, completed_at = null where id = $1`, [second.run_id]);
      await db.query(`update public.tasks set status = 'queued', started_at = null,
        completed_at = null where id = $1`, [second.task_id]);
      await db.query("update public.commands set status = 'queued', completed_at = null where id = $1", [
        second.command_id,
      ]);
      await registerWorker(db, "worker.exhausted-claim");
      await expect(claimRun(db, "worker.exhausted-claim")).rejects.toThrow(/run budget is exhausted/i);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("exposes coherent branch-only recovery with a nullable PR pair and rejects partial evidence", async () => {
    const db = await database();
    const workerId = "worker.branch-recovery";
    const headBranch = "factory/branch-only-contract";
    const headSha = "c".repeat(40);
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "branch-only-recovery");
      await registerWorker(db, workerId);
      const first = (await claimRun(db, workerId)).rows[0]!;
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, first.run_id, first.lease_token, "branch", headBranch, null, "{}",
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, first.run_id, first.lease_token, "commit", headSha, null, "{}",
      ]);
      await db.query("select * from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)", [
        workerId, first.run_id, first.lease_token, "failed", "Push completed before PR creation failed.",
        "provider-run-branch", "{}", "[]", "[]", "provider_timeout", "PR creation timed out.", true,
      ]);
      await db.exec("reset role");
      await db.exec("set role authenticated");
      await db.query("select * from public.retry_phase1c_run($1,$2,$3)", [
        organizationId, first.run_id, "Recover the exact pushed factory branch.",
      ]);
      await db.exec("reset role");
      await db.exec("set role service_role");
      await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
        workerId, "1.0.0", JSON.stringify({ providers: ["openai"] }),
      ]);
      const recovery = (await claimRun(db, workerId)).rows[0]!;
      expect(recovery).toMatchObject({
        recovery_head_branch: headBranch,
        recovery_head_sha: headSha,
        recovery_provider_run_reference: "provider-run-branch",
        recovery_pull_request_number: null,
        recovery_pull_request_url: null,
      });

      await db.exec("reset role");
      await db.exec(`
        update public.agent_runs set status = 'failed', retryable = true, max_attempts = 3,
          lease_worker_id = null, lease_token = null, lease_expires_at = null
        where id = '${first.run_id}';
        insert into public.phase1c_run_artifacts (
          organization_id, run_id, attempt_number, artifact_type, reference, metadata
        ) values (
          '${organizationId}', '${first.run_id}', 2, 'branch', 'factory/conflicting-branch', '{}'::jsonb
        );
      `);
      await db.exec("set role authenticated");
      await expect(db.query("select * from public.retry_phase1c_run($1,$2,$3)", [
        organizationId, first.run_id, "Reject incomplete branch recovery evidence.",
      ])).rejects.toThrow(/partial or inconsistent/i);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("completes against the exact repaired PR head while preserving both commits", async () => {
    const db = await database();
    const workerId = "worker.ci-repair";
    const branch = "factory/ci-repair-contract";
    const firstSha = "d".repeat(40);
    const repairedSha = "e".repeat(40);
    const pullUrl = "https://github.com/surgeservicesllc/SoftwareFactory/pull/88";
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "ci-repair-contract");
      await registerWorker(db, workerId);
      const run = (await claimRun(db, workerId)).rows[0]!;
      for (const round of [1, 2]) {
        await db.query("select public.record_phase1c_validation($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
          workerId, run.run_id, run.lease_token, round, "diff-check", "git diff --check", "passed", 8, "clean",
        ]);
      }
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, run.run_id, run.lease_token, "branch", branch, null, JSON.stringify({ localPrepared: true }),
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, run.run_id, run.lease_token, "commit", firstSha, null, "{}",
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, run.run_id, run.lease_token, "pull_request", pullUrl, 88,
        JSON.stringify({ commitSha: firstSha }),
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, run.run_id, run.lease_token, "commit", repairedSha, null,
        JSON.stringify({ repairAttempt: 1 }),
      ]);
      await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        workerId, run.run_id, run.lease_token, "pull_request_head", repairedSha, 88,
        JSON.stringify({ pullRequestUrl: pullUrl, repairAttempt: 1 }),
      ]);
      const completion = await db.query<{ status: string }>(
        "select status from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)",
        [workerId, run.run_id, run.lease_token, "succeeded", "Repair passed stable CI.",
          "provider-repair", "{}", JSON.stringify(["src/change.ts"]),
          JSON.stringify([{ name: "CI", status: "completed", conclusion: "success" }]), null, null, false],
      );
      expect(completion.rows[0]!.status).toBe("succeeded");
      await db.exec("reset role");
      const evidence = await db.query<{ commit_count: number; head_sha: string; head_transition_count: number }>(`
        select run.head_sha,
          count(*) filter (where artifact.artifact_type = 'commit')::integer as commit_count,
          count(*) filter (where artifact.artifact_type = 'pull_request_head')::integer as head_transition_count
        from public.agent_runs run join public.phase1c_run_artifacts artifact on artifact.run_id = run.id
        where run.id = $1 group by run.id
      `, [run.run_id]);
      expect(evidence.rows[0]).toEqual({ commit_count: 2, head_sha: repairedSha, head_transition_count: 1 });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("returns only the remaining durable duration when a stale lease is recovered", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "remaining-deadline-contract");
      await registerWorker(db, "worker.remaining.one");
      const first = (await claimRun(db, "worker.remaining.one")).rows[0]!;
      await db.exec("reset role");
      await db.query(`update public.agent_runs set started_at = now() - interval '40 minutes',
        lease_expires_at = now() - interval '1 minute' where id = $1`, [first.run_id]);
      await registerWorker(db, "worker.remaining.two");
      const recovered = (await claimRun(db, "worker.remaining.two")).rows[0]!;
      expect(recovered.attempt_number).toBe(2);
      expect(recovered.maximum_duration_ms).toBeGreaterThan(250_000);
      expect(recovered.maximum_duration_ms).toBeLessThanOrEqual(300_000);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("reaps a stale run that has exhausted its bounded attempts", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "stale-exhausted-contract");
      await registerWorker(db, "worker.stale.one");
      const run = (await claimRun(db, "worker.stale.one")).rows[0]!;
      await db.exec("reset role");
      await db.query(`update public.agent_runs set attempt_number = max_attempts,
        lease_expires_at = now() - interval '1 minute' where id = $1`, [run.run_id]);
      await db.exec("set role service_role");
      await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
        "worker.stale.two", "1.0.0", JSON.stringify({ providers: ["openai"] }),
      ]);
      expect((await claimRun(db, "worker.stale.two")).rows).toHaveLength(0);
      await db.exec("reset role");
      const state = await db.query<{
        command_status: string;
        error_code: string;
        report_outcome: string;
        run_status: string;
        task_status: string;
      }>(`
        select run.status::text as run_status, run.error_code,
          task.status::text as task_status, command.status::text as command_status,
          (select report.content ->> 'outcome' from public.reports report
            where report.content -> 'runIds' @> jsonb_build_array(run.id)
            order by report.created_at desc limit 1) as report_outcome
        from public.agent_runs run join public.tasks task on task.id = run.task_id
        join public.commands command on command.id = run.command_id where run.id = $1
      `, [run.run_id]);
      expect(state.rows[0]).toEqual({
        command_status: "failed", error_code: "lease_attempts_exhausted",
        report_outcome: "failed", run_status: "failed", task_status: "failed",
      });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("terminalizes a stale run at its durable deadline before another worker can claim it", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "stale-deadline-contract");
      await registerWorker(db, "worker.deadline.one");
      const run = (await claimRun(db, "worker.deadline.one")).rows[0]!;
      await db.exec("reset role");
      await db.query(`update public.agent_runs set attempt_number = 1,
        started_at = now() - interval '46 minutes',
        lease_expires_at = now() - interval '1 minute' where id = $1`, [run.run_id]);
      await db.exec("set role service_role");
      await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
        "worker.deadline.two", "1.0.0", JSON.stringify({ providers: ["openai"] }),
      ]);
      expect((await claimRun(db, "worker.deadline.two")).rows).toHaveLength(0);
      await db.exec("reset role");
      const state = await db.query<{
        attempt_number: number;
        command_status: string;
        error_code: string;
        report_error_code: string;
        report_outcome: string;
        retryable: boolean;
        run_status: string;
        task_status: string;
      }>(`
        select run.status::text as run_status, run.error_code, run.retryable,
          run.attempt_number, task.status::text as task_status,
          command.status::text as command_status,
          (select report.content ->> 'outcome' from public.reports report
            where report.content -> 'runIds' @> jsonb_build_array(run.id)
            order by report.created_at desc limit 1) as report_outcome,
          (select report.content -> 'security' ->> 'errorCode' from public.reports report
            where report.content -> 'runIds' @> jsonb_build_array(run.id)
            order by report.created_at desc limit 1) as report_error_code
        from public.agent_runs run join public.tasks task on task.id = run.task_id
        join public.commands command on command.id = run.command_id where run.id = $1
      `, [run.run_id]);
      expect(state.rows[0]).toEqual({
        attempt_number: 1,
        command_status: "failed",
        error_code: "timed_out",
        report_error_code: "timed_out",
        report_outcome: "failed",
        retryable: false,
        run_status: "failed",
        task_status: "failed",
      });
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("turns a completion race into cancellation and exposes bounded report evidence", async () => {
    const db = await database();
    const workerId = "worker.cancellation";
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "cancellation-race-contract");
      await registerWorker(db, workerId);
      const run = (await claimRun(db, workerId)).rows[0]!;
      await db.exec("reset role");
      await db.exec("set role authenticated");
      await db.query("select * from public.request_phase1c_run_cancellation($1,$2,$3)", [
        organizationId, run.run_id, "Owner stopped this run before publication.",
      ]);
      await db.exec("reset role");
      await db.exec("set role service_role");
      const completion = await db.query<{ status: string }>(
        "select status from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)",
        [workerId, run.run_id, run.lease_token, "succeeded", "This must not become success.",
          "provider-run-cancel", "{}", "[]", JSON.stringify([{ name: "ci", status: "passed" }]),
          null, null, false],
      );
      expect(completion.rows[0]!.status).toBe("cancelled");
      await db.exec("reset role");
      const evidence = await db.query<{
        command_status: string;
        decisions: unknown[];
        outcome: string;
        run_status: string;
        task_status: string;
      }>(`
        select run.status::text as run_status, task.status::text as task_status,
          command.status::text as command_status, report.content ->> 'outcome' as outcome,
          report.content -> 'decisions' as decisions
        from public.agent_runs run join public.tasks task on task.id = run.task_id
        join public.commands command on command.id = run.command_id
        join lateral (select content from public.reports report
          where report.content -> 'runIds' @> jsonb_build_array(run.id)
          order by report.created_at desc limit 1) report on true
        where run.id = $1
      `, [run.run_id]);
      expect(evidence.rows[0]).toMatchObject({
        command_status: "cancelled", outcome: "cancelled",
        run_status: "cancelled", task_status: "cancelled",
      });
      expect(evidence.rows[0]!.decisions).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: "Cancellation requested", status: "recorded" }),
      ]));
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("enforces the persisted maximum duration at the terminal database boundary", async () => {
    const db = await database();
    const workerId = "worker.deadline";
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "deadline-contract");
      await registerWorker(db, workerId);
      const run = (await claimRun(db, workerId)).rows[0]!;
      await db.exec("reset role");
      await db.query("update public.agent_runs set started_at = now() - interval '46 minutes' where id = $1", [run.run_id]);
      await db.exec("set role service_role");
      await expect(db.query("select * from public.heartbeat_phase1c_run($1,$2,$3,$4)", [
        workerId, run.run_id, run.lease_token, 120,
      ])).rejects.toThrow(/deadline is missing or expired/i);
      await expect(db.query(
        "select public.record_phase1c_validation($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [workerId, run.run_id, run.lease_token, 1, "diff-check", "git diff --check", "passed", 1, "clean"],
      )).rejects.toThrow(/active run lease required/i);
      await expect(db.query(
        "select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)",
        [workerId, run.run_id, run.lease_token, "branch", "factory/too-late", null, "{}"],
      )).rejects.toThrow(/active run lease required/i);
      const completion = await db.query<{ status: string }>(
        "select status from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)",
        [workerId, run.run_id, run.lease_token, "succeeded", "Late success must be rejected.",
          null, "{}", "[]", "[]", null, null, false],
      );
      expect(completion.rows[0]!.status).toBe("failed");
      await db.exec("reset role");
      const state = await db.query<{ error_code: string; retryable: boolean }>(
        "select error_code, retryable from public.agent_runs where id = $1", [run.run_id],
      );
      expect(state.rows[0]).toEqual({ error_code: "timed_out", retryable: false });
      await db.exec("set role authenticated");
      await expect(db.query("select * from public.retry_phase1c_run($1,$2,$3)", [
        organizationId, run.run_id, "Do not restart work after its durable deadline.",
      ])).rejects.toThrow(/not eligible for a bounded retry/i);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });

  it("cancels queued work terminally with immutable decision and report evidence", async () => {
    const db = await database();
    try {
      await seedExecutableProject(db);
      await submitAudit(db, "queued-cancellation-contract");
      await db.exec("reset role");
      const run = await db.query<{ id: string }>("select id from public.agent_runs limit 1");
      await db.exec("set role authenticated");
      const cancelled = await db.query<{ status: string }>(
        "select status from public.request_phase1c_run_cancellation($1,$2,$3)",
        [organizationId, run.rows[0]!.id, "Owner cancelled before worker execution."],
      );
      expect(cancelled.rows[0]!.status).toBe("cancelled");
      await db.exec("reset role");
      const evidence = await db.query<{ decisions: unknown[]; outcome: string; terminal_events: number }>(`
        select report.content ->> 'outcome' as outcome,
          report.content -> 'decisions' as decisions,
          (select count(*)::integer from public.phase1c_run_events event
            where event.run_id = $1 and event.event_type in ('cancellation_requested','cancelled'))
            as terminal_events
        from public.reports report
        where report.content -> 'runIds' @> jsonb_build_array($1::uuid)
        order by report.created_at desc limit 1
      `, [run.rows[0]!.id]);
      expect(evidence.rows[0]).toMatchObject({ outcome: "cancelled", terminal_events: 2 });
      expect(evidence.rows[0]!.decisions).toEqual([
        expect.objectContaining({ title: "Cancellation requested", status: "recorded" }),
      ]);
    } finally {
      await db.exec("reset role").catch(() => undefined);
      await db.close();
    }
  });
});
