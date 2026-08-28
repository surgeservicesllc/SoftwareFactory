// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000009a1";
const outsiderId = "00000000-0000-4000-8000-0000000009a2";
const organizationId = "10000000-0000-4000-8000-0000000009a1";
const projectId = "40000000-0000-4000-8000-0000000009a1";
const connectionId = "20000000-0000-4000-8000-0000000009a1";
const installationId = "30000000-0000-4000-8000-0000000009a1";
const repositoryId = "50000000-0000-4000-8000-0000000009a1";
const graphId = "60000000-0000-4000-8000-0000000009a1";
const initialGraphId = "60000000-0000-4000-8000-0000000009b1";
const initialNodeId = "62000000-0000-4000-8000-0000000009b1";
const abortGraphId = "60000000-0000-4000-8000-0000000009c1";
const abortGraphRunId = "61000000-0000-4000-8000-0000000009c1";
const abortNodeIds = [
  "62000000-0000-4000-8000-0000000009c1",
  "62000000-0000-4000-8000-0000000009c2",
] as const;
const abortNodeRunIds = [
  "63000000-0000-4000-8000-0000000009c1",
  "63000000-0000-4000-8000-0000000009c2",
] as const;
const startedAbortGraphId = "60000000-0000-4000-8000-0000000009d1";
const startedAbortGraphRunId = "61000000-0000-4000-8000-0000000009d1";
const startedAbortNodeId = "62000000-0000-4000-8000-0000000009d1";
const startedAbortNodeRunId = "63000000-0000-4000-8000-0000000009d1";
const originalGraphRunId = "61000000-0000-4000-8000-0000000009a1";
const decoyGraphRunId = "61000000-0000-4000-8000-0000000009a2";
const decoyBridgeId = "61000000-0000-4000-8000-0000000009a3";
const architectureNodeId = "62000000-0000-4000-8000-0000000009a1";
const implementationNodeId = "62000000-0000-4000-8000-0000000009a2";
const monitorNodeId = "62000000-0000-4000-8000-0000000009a3";
const testNodeId = "62000000-0000-4000-8000-0000000009a4";
const deploymentNodeId = "62000000-0000-4000-8000-0000000009a5";
const architectureNodeRunId = "63000000-0000-4000-8000-0000000009a1";
const architectureArtifactId = "64000000-0000-4000-8000-0000000009a1";
const testArtifactId = "64000000-0000-4000-8000-0000000009a3";
const arbitraryTestArtifactId = "64000000-0000-4000-8000-0000000009a4";
const mismatchedTestArtifactId = "64000000-0000-4000-8000-0000000009a5";
const deploymentArtifactId = "64000000-0000-4000-8000-0000000009a2";
const architectureGateId = "65000000-0000-4000-8000-0000000009a1";
const testGateId = "65000000-0000-4000-8000-0000000009a2";
const deploymentGateId = "65000000-0000-4000-8000-0000000009a3";
const agentId = "70000000-0000-4000-8000-0000000009a1";
const phase1CLeaseToken = "74000000-0000-4000-8000-0000000009a1";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const mergeSha = "c".repeat(40);
const canonicalTemplatePlanSha256 =
  "0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49";
const requiredCheckNames = [
  "Lint, typecheck, test, and build",
  "Browser and accessibility tests 1/3",
  "Browser and accessibility tests 2/3",
  "Browser and accessibility tests 3/3",
] as const;
const requiredCheckNamesJson = JSON.stringify(requiredCheckNames);

function timestampAtOffset(instant: string, offsetMinutes: number): string {
  const shifted = new Date(new Date(instant).getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60).toString().padStart(2, "0");
  const minutes = (absoluteMinutes % 60).toString().padStart(2, "0");
  return `${shifted.toISOString().slice(0, -1)}${sign}${hours}:${minutes}`;
}

function phase1CParameters() {
  return {
    acceptanceCriteria: ["The approved architecture is implemented and verified."],
    agentRole: "architect",
    budget: {
      ciTimeoutMs: 900000,
      maximumDurationMs: 2700000,
      maximumInputTokens: 200000,
      maximumOutputTokens: 50000,
      maximumRepairAttempts: 1,
      maximumTurns: 4,
    },
    commandType: "build_feature",
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
      appId: 900002,
      baseBranch: "main",
      baseSha,
      connectionId,
      externalInstallationId: 900001,
      externalRepositoryId: 900004,
      installationId,
      repositoryId,
    },
    riskAssessment: { requestedRisk: "yellow" },
  };
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function asWorker(db: PGlite) {
  await resetRole(db);
  await db.exec("set role service_role");
}

async function asUser(db: PGlite, userId: string) {
  await resetRole(db);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function overwriteReleaseIntentDigestFixture(
  db: PGlite,
  intentId: string,
  evidenceSha256: string,
) {
  await resetRole(db);
  await db.exec(
    "alter table public.graph_release_gate_approval_intents disable trigger graph_release_gate_intents_immutable",
  );
  try {
    await db.query(
      `update public.graph_release_gate_approval_intents
       set evidence_sha256 = $2
       where id = $1`,
      [intentId, evidenceSha256],
    );
  } finally {
    await db.exec(
      "alter table public.graph_release_gate_approval_intents enable trigger graph_release_gate_intents_immutable",
    );
  }
}

describe("graph to Phase 1C release lineage", { timeout: 240_000 }, () => {
  let db: PGlite;
  let bridgeId: string;
  let commandId: string;
  let taskId: string;
  let agentRunId: string;
  let recordedPullRequestId: string;
  let resumedGraphRunId: string;

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

    for (const file of (await readdir(migrationsRoot)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
      await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
    }

    // This is authoritative fixture data, not an application write. Disabling
    // user triggers avoids asking unrelated command-routing triggers to create
    // a second run while constraints and foreign keys remain enforced.
    await db.exec(`
      set session_replication_role = replica;

      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Lineage Factory', 'lineage-factory', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${ownerId}', 'owner');
      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Lineage Project', 'active',
        'factory/lineage', 'main', '${ownerId}'
      );
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'env://GITHUB_APP', '${ownerId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', 900001, 900002,
        'lineage-app', 900003, 'factory', 'Organization', 'Organization',
        'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id,
        owner_login, name, full_name, default_branch, html_url, private,
        visibility, selected, github_updated_at
      ) values (
        '${repositoryId}', '${organizationId}', '${installationId}', 900004,
        'factory', 'lineage', 'factory/lineage', 'main',
        'https://github.com/factory/lineage', true, 'private', true, now()
      );
      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id,
        is_primary, created_by
      ) values (
        '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}',
        true, '${ownerId}'
      );
      insert into public.agents (id, organization_id, name, role, status, created_by)
      values ('${agentId}', '${organizationId}', 'Builder', 'backend', 'idle', '${ownerId}');

      insert into public.graphs (
        id, organization_id, project_id, goal, topology, risk_level,
        requires_owner_approval, created_by, is_lifecycle, template_key,
        template_version, template_plan_sha256, github_repository_id,
        base_branch, base_sha, required_check_names, required_checks_sha256
      ) values (
        '${graphId}', '${organizationId}', '${projectId}', 'Ship exact lineage',
        'SEQUENTIAL', 'yellow', false, '${ownerId}', true, 'full_lifecycle',
        2, '${canonicalTemplatePlanSha256}', '${repositoryId}', 'main', '${baseSha}',
        '${requiredCheckNamesJson}'::jsonb,
        encode(sha256(convert_to('${requiredCheckNamesJson}'::jsonb::text, 'UTF8')), 'hex')
      );
      insert into public.graph_budgets (organization_id, graph_id)
      values ('${organizationId}', '${graphId}');
      insert into public.graph_nodes (
        id, organization_id, graph_id, node_key, job, executor, capability,
        lifecycle_stage, gate_kind
      ) values
        ('${architectureNodeId}', '${organizationId}', '${graphId}', 'architecture',
         'Design it', 'MODEL', 'architecture', 'ARCHITECTURE', 'HUMAN'),
        ('${implementationNodeId}', '${organizationId}', '${graphId}', 'implement',
         'Observe Phase 1C', 'ANCHOR', 'implementation', 'IMPLEMENTATION', null),
        ('${testNodeId}', '${organizationId}', '${graphId}', 'test',
         'Verify exact-head CI', 'ANCHOR', 'testing', 'TEST', 'HUMAN'),
        ('${deploymentNodeId}', '${organizationId}', '${graphId}', 'deploy',
         'Observe production deployment', 'ANCHOR', 'deployment', 'DEPLOYMENT', 'HUMAN'),
        ('${monitorNodeId}', '${organizationId}', '${graphId}', 'monitor',
         'Probe production', 'ANCHOR', 'synthesis', 'MONITORING', null);
      insert into public.graph_edges (
        organization_id, graph_id, from_node_id, to_node_id, reason, detail
      ) values
        ('${organizationId}', '${graphId}', '${architectureNodeId}',
         '${implementationNodeId}', 'DATA', 'Approved architecture precedes implementation.'),
        ('${organizationId}', '${graphId}', '${implementationNodeId}',
         '${testNodeId}', 'DATA', 'Implementation precedes exact-head verification.'),
        ('${organizationId}', '${graphId}', '${testNodeId}',
         '${deploymentNodeId}', 'DATA', 'Verified merge precedes production observation.'),
        ('${organizationId}', '${graphId}', '${deploymentNodeId}',
         '${monitorNodeId}', 'DATA', 'Observed deployment precedes monitoring.');
      insert into public.graph_runs (
        id, organization_id, graph_id, state, started_at, completed_at, created_by
      ) values (
        '${originalGraphRunId}', '${organizationId}', '${graphId}', 'PARTIAL',
        now() - interval '10 minutes', now() - interval '2 minutes', '${ownerId}'
      );
      insert into public.node_runs (
        id, organization_id, graph_run_id, node_id, state, attempt,
        queued_at, started_at, completed_at
      ) values (
        '${architectureNodeRunId}', '${organizationId}', '${originalGraphRunId}',
        '${architectureNodeId}', 'VERIFYING', 1, now() - interval '9 minutes',
        now() - interval '8 minutes', null
      );
      insert into public.graph_artifacts (
        id, organization_id, graph_run_id, node_run_id, kind, payload, created_at
      ) values (
        '${architectureArtifactId}', '${organizationId}', '${originalGraphRunId}',
        '${architectureNodeRunId}', 'RAW', '{"decision":"approved design"}'::jsonb,
        now() - interval '3 minutes'
      );
      insert into public.graph_gates (
        id, organization_id, graph_id, node_id, stage, kind, state,
        opened_by_run_id, opened_at, decided_at, decided_by
      ) values (
        '${architectureGateId}', '${organizationId}', '${graphId}', '${architectureNodeId}',
        'ARCHITECTURE', 'HUMAN', 'OPEN', '${originalGraphRunId}',
        now() - interval '4 minutes', null, null
      );

      set session_replication_role = origin;
    `);

    await asUser(db, ownerId);
    const created = await db.query<{ id: string }>(
      `select bridge_id as id
       from public.approve_graph_phase1c_architecture_gate($1, $2, 'Architecture reviewed')`,
      [architectureGateId, architectureArtifactId],
    );
    bridgeId = created.rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("forces tenant RLS while keeping bridge and owner-intent writes private", async () => {
    await resetRole(db);
    const flags = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
       where oid in (
         'public.graph_phase1c_bridges'::regclass,
         'public.graph_release_gate_approval_intents'::regclass
       )
       order by relname`,
    );
    expect(flags.rows).toEqual([
      {
        relname: "graph_phase1c_bridges",
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: "graph_release_gate_approval_intents",
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
    ]);

    const grants = await db.query<{
      grantee: string;
      privilege_type: string;
      table_name: string;
    }>(
      `select table_name, grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name in (
           'graph_phase1c_bridges',
           'graph_release_gate_approval_intents'
         )
         and grantee in ('anon', 'authenticated', 'service_role')
       order by table_name, grantee, privilege_type`,
    );
    expect(grants.rows).toEqual([{
      table_name: "graph_phase1c_bridges",
      grantee: "authenticated",
      privilege_type: "SELECT",
    }]);

    await asWorker(db);
    await expect(db.query(
      `update public.graph_phase1c_bridges set updated_at = now() where id = $1`,
      [bridgeId],
    )).rejects.toThrow(/permission denied/i);
  });

  it("keeps queue diagnosis on the exact protocol-v2 repository, policy, and bridge scope", async () => {
    await asUser(db, ownerId);
    await expect(db.query(
      `select * from public.diagnose_graph_queue_as_worker_v2(
         'diagnostic-worker', 'factory/lineage', $1::jsonb, $2, 2
       )`,
      [requiredCheckNamesJson, graphId],
    )).rejects.toThrow(/permission denied/i);

    await asWorker(db);
    await expect(db.query(
      "select * from public.diagnose_graph_queue_as_worker('diagnostic-worker')",
    )).rejects.toThrow(/permission denied/i);
    await expect(db.query(
      `select * from public.diagnose_graph_queue_as_worker_v2(
         'diagnostic-worker', 'factory/lineage', $1::jsonb, $2, 1
       )`,
      [requiredCheckNamesJson, graphId],
    )).rejects.toThrow(/protocol version 2/i);

    const exact = await db.query<{
      id: string;
      phase1c_resume_ready: boolean;
      repository_scope_matches: boolean;
      required_check_policy_matches: boolean;
    }>(
      `select id, repository_scope_matches, required_check_policy_matches,
              phase1c_resume_ready
       from public.diagnose_graph_queue_as_worker_v2(
         'diagnostic-worker', 'factory/lineage', $1::jsonb, $2, 2
       )`,
      [requiredCheckNamesJson, graphId],
    );
    expect(exact.rows).toEqual([{
      id: graphId,
      phase1c_resume_ready: false,
      repository_scope_matches: true,
      required_check_policy_matches: true,
    }]);

    const wrongPolicy = await db.query<{
      required_check_policy_matches: boolean;
    }>(
      `select required_check_policy_matches
       from public.diagnose_graph_queue_as_worker_v2(
         'diagnostic-worker', 'factory/lineage', '["Different CI"]'::jsonb, $1, 2
       )`,
      [graphId],
    );
    expect(wrongPolicy.rows).toEqual([{ required_check_policy_matches: false }]);

    await resetRole(db);
    await db.query("update public.connections set status = 'error' where id = $1", [connectionId]);
    try {
      await asWorker(db);
      const inactive = await db.query<{ repository_scope_matches: boolean }>(
        `select repository_scope_matches
         from public.diagnose_graph_queue_as_worker_v2(
           'diagnostic-worker', 'factory/lineage', $1::jsonb, $2, 2
         )`,
        [requiredCheckNamesJson, graphId],
      );
      expect(inactive.rows).toEqual([]);
    } finally {
      await resetRole(db);
      await db.query("update public.connections set status = 'connected' where id = $1", [connectionId]);
    }
  });

  it("enforces the 160-character and no-pipe required-check policy in SQL", async () => {
    await resetRole(db);
    const boundary = "x".repeat(160);
    const result = await db.query<{ accepted: boolean; oversized: boolean; pipe: boolean }>(
      `select
         public.graph_required_check_policy_is_safe($1::jsonb) as accepted,
         public.graph_required_check_policy_is_safe($2::jsonb) as oversized,
         public.graph_required_check_policy_is_safe($3::jsonb) as pipe`,
      [JSON.stringify([boundary]), JSON.stringify([`${boundary}x`]), JSON.stringify(["CI|shadow"])],
    );
    expect(result.rows).toEqual([{ accepted: true, oversized: false, pipe: false }]);
  });

  it("keeps artifact payloads immutable without breaking parent cleanup semantics", async () => {
    await resetRole(db);
    const trigger = await db.query<{ definition: string; enabled: string }>(
      `select pg_get_triggerdef(trigger_catalog.oid) as definition,
              trigger_catalog.tgenabled as enabled
       from pg_trigger trigger_catalog
       where trigger_catalog.tgrelid = 'public.graph_artifacts'::regclass
         and trigger_catalog.tgname = 'graph_artifacts_update_immutable'
         and not trigger_catalog.tgisinternal`,
    );
    expect(trigger.rows).toHaveLength(1);
    expect(trigger.rows[0].enabled).toBe("O");
    expect(trigger.rows[0].definition).toMatch(/before update on public\.graph_artifacts/i);
    expect(trigger.rows[0].definition).not.toMatch(/delete/i);

    const privileges = await db.query<{
      can_delete: boolean;
      can_select: boolean;
      can_update: boolean;
      role_name: string;
    }>(
      `select role_name,
              has_table_privilege(role_name, 'public.graph_artifacts', 'SELECT') as can_select,
              has_table_privilege(role_name, 'public.graph_artifacts', 'UPDATE') as can_update,
              has_table_privilege(role_name, 'public.graph_artifacts', 'DELETE') as can_delete
       from unnest(array['anon', 'authenticated', 'service_role']) role_name
       order by role_name`,
    );
    expect(privileges.rows).toEqual([
      { role_name: "anon", can_select: false, can_update: false, can_delete: false },
      { role_name: "authenticated", can_select: true, can_update: false, can_delete: false },
      { role_name: "service_role", can_select: false, can_update: false, can_delete: false },
    ]);

    const before = await db.query<{ payload: unknown }>(
      "select payload from public.graph_artifacts where id = $1",
      [architectureArtifactId],
    );
    await expect(db.query(
      `update public.graph_artifacts
       set payload = jsonb_build_object('rewritten', true)
       where id = $1`,
      [architectureArtifactId],
    )).rejects.toThrow(/immutable audit evidence/i);
    expect((await db.query<{ payload: unknown }>(
      "select payload from public.graph_artifacts where id = $1",
      [architectureArtifactId],
    )).rows).toEqual(before.rows);

    await asUser(db, ownerId);
    await expect(db.query(
      "delete from public.graph_artifacts where id = $1",
      [architectureArtifactId],
    )).rejects.toThrow(/permission denied/i);
    await asWorker(db);
    await expect(db.query(
      "delete from public.graph_artifacts where id = $1",
      [architectureArtifactId],
    )).rejects.toThrow(/permission denied/i);

    // The schema owner can still perform established parent cascades, while
    // evidence named by a durable approval/bridge identity remains protected.
    await resetRole(db);
    await expect(db.query(
      "delete from public.graph_artifacts where id = $1",
      [architectureArtifactId],
    )).rejects.toThrow(/foreign key constraint/i);
  });

  it("denies the worker every superseded or private release mutator", async () => {
    await resetRole(db);
    const privileges = await db.query<{ routine: string; allowed: boolean }>(
      `select procedure.proname as routine,
              bool_or(has_function_privilege('service_role', procedure.oid, 'EXECUTE')) as allowed
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname in (
           'create_graph_phase1c_bridge_as_worker',
           'create_graph_phase1c_bridge_for_approved_gate',
           'attach_graph_phase1c_command_for_approved_gate',
           'bind_graph_phase1c_run_as_worker',
           'record_graph_phase1c_github_merge_as_worker',
           'record_graph_phase1c_github_deployment_as_worker',
           'approve_full_lifecycle_gate_internal',
           'complete_phase1c_run',
           'complete_graph_run_as_worker'
         )
       group by procedure.proname
       order by procedure.proname`,
    );
    expect(privileges.rows.map((row) => row.routine)).toEqual([
      "approve_full_lifecycle_gate_internal",
      "attach_graph_phase1c_command_for_approved_gate",
      "bind_graph_phase1c_run_as_worker",
      "complete_graph_run_as_worker",
      "complete_phase1c_run",
      "create_graph_phase1c_bridge_as_worker",
      "create_graph_phase1c_bridge_for_approved_gate",
      "record_graph_phase1c_github_deployment_as_worker",
      "record_graph_phase1c_github_merge_as_worker",
    ]);
    expect(privileges.rows.every((row) => !row.allowed)).toBe(true);

    const publicPrivileges = await db.query<{
      authenticated: boolean;
      routine: string;
      service_role: boolean;
    }>(
      `select procedure.proname as routine,
              bool_or(has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
                as authenticated,
              bool_or(has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
                as service_role
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname in (
           'submit_and_attach_graph_phase1c_command',
           'request_graph_release_gate_approval',
           'approve_graph_phase1c_test_gate_as_worker',
           'approve_graph_phase1c_deployment_gate_as_worker'
         )
       group by procedure.proname
       order by procedure.proname`,
    );
    expect(publicPrivileges.rows).toEqual([
      {
        authenticated: false,
        routine: "approve_graph_phase1c_deployment_gate_as_worker",
        service_role: true,
      },
      {
        authenticated: false,
        routine: "approve_graph_phase1c_test_gate_as_worker",
        service_role: true,
      },
      {
        authenticated: true,
        routine: "request_graph_release_gate_approval",
        service_role: false,
      },
      {
        authenticated: true,
        routine: "submit_and_attach_graph_phase1c_command",
        service_role: false,
      },
    ]);

    await asWorker(db);
    await expect(db.query(
      `select * from public.create_graph_phase1c_bridge_for_approved_gate(
         $1, 'full_lifecycle', 2, $2, 'main', $3
       )`,
      [architectureGateId, repositoryId, baseSha],
    )).rejects.toThrow(/permission denied/i);
  });

  it("shows the bridge only to tenant members", async () => {
    await asUser(db, ownerId);
    expect((await db.query(
      `select id from public.graph_phase1c_bridges where id = $1`, [bridgeId],
    )).rows).toHaveLength(1);

    await asUser(db, outsiderId);
    expect((await db.query(
      `select id from public.graph_phase1c_bridges where id = $1`, [bridgeId],
    )).rows).toHaveLength(0);

    await expect(db.query(
      `select bridge_id from public.approve_graph_phase1c_architecture_gate(
         $1, $2, 'Architecture reviewed'
       )`,
      [architectureGateId, architectureArtifactId],
    )).rejects.toThrow(/owner access is required/i);
  });

  it("rejects secret-shaped reasons through generic and architecture gate boundaries", async () => {
    await resetRole(db);
    const beforeGate = await db.query<{ reason: string | null; state: string }>(
      "select state::text, reason from public.graph_gates where id = $1",
      [architectureGateId],
    );
    const beforeEvents = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.activity_events
       where entity_type = 'graph_gate' and entity_id = $1`,
      [architectureGateId],
    );
    const secretReason = `reviewed with sk-${"a".repeat(28)}`;

    await asUser(db, ownerId);
    await expect(db.query(
      "select public.decide_node_gate($1, false, $2)",
      [architectureGateId, secretReason],
    )).rejects.toThrow(/reason is invalid or sensitive/i);
    await expect(db.query(
      `select bridge_id
       from public.approve_graph_phase1c_architecture_gate($1, $2, $3)`,
      [architectureGateId, architectureArtifactId, secretReason],
    )).rejects.toThrow(/reason is invalid or sensitive/i);

    await resetRole(db);
    expect((await db.query<{ reason: string | null; state: string }>(
      "select state::text, reason from public.graph_gates where id = $1",
      [architectureGateId],
    )).rows).toEqual(beforeGate.rows);
    expect((await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.activity_events
       where entity_type = 'graph_gate' and entity_id = $1`,
      [architectureGateId],
    )).rows).toEqual(beforeEvents.rows);
  });

  it("makes the approved-gate owner doorway idempotent", async () => {
    await asUser(db, ownerId);
    const replay = await db.query<{ bridge_id: string; graph_run_id: string }>(
      `select bridge_id, graph_run_id
       from public.approve_graph_phase1c_architecture_gate(
         $1, $2, 'Architecture reviewed'
       )`,
      [architectureGateId, architectureArtifactId],
    );
    expect(replay.rows[0]).toEqual({ bridge_id: bridgeId, graph_run_id: originalGraphRunId });
  });

  it("claims a new full lifecycle v2 graph before an architecture bridge exists", async () => {
    await resetRole(db);
    await db.exec(`
      insert into public.graphs (
        id, organization_id, project_id, goal, topology, risk_level,
        requires_owner_approval, created_by, is_lifecycle, template_key,
        template_version, template_plan_sha256, github_repository_id,
        base_branch, base_sha, required_check_names, required_checks_sha256
      ) values (
        '${initialGraphId}', '${organizationId}', '${projectId}',
        'Start the first exact lifecycle run', 'SEQUENTIAL', 'green', false,
        '${ownerId}', true, 'full_lifecycle', 2, '${canonicalTemplatePlanSha256}',
        '${repositoryId}', 'main', '${baseSha}', '${requiredCheckNamesJson}'::jsonb,
        encode(sha256(convert_to('${requiredCheckNamesJson}'::jsonb::text, 'UTF8')), 'hex')
      );
      insert into public.graph_budgets (organization_id, graph_id)
      values ('${organizationId}', '${initialGraphId}');
      insert into public.graph_nodes (
        id, organization_id, graph_id, node_key, job, executor, capability,
        lifecycle_stage, gate_kind
      ) values (
        '${initialNodeId}', '${organizationId}', '${initialGraphId}', 'requirements',
        'Capture requirements', 'MODEL', 'requirements', 'GOAL', null
      );
    `);

    await asWorker(db);
    const mismatched = await db.query<{ claim: unknown }>(
      `select public.claim_planned_graph_v2(
         'initial-lineage-worker', array['MODEL','ANCHOR'], 'factory/lineage',
         '["Different repository policy"]'::jsonb, 2
       ) as claim`,
    );
    expect(mismatched.rows[0].claim).toBeNull();
    await expect(db.query(
      `select public.claim_planned_graph_v2(
         'initial-lineage-worker', array['MODEL','ANCHOR'], 'factory/lineage',
         null::jsonb, 2
       )`,
    )).rejects.toThrow(/exact repository and required-check policy/i);
    await resetRole(db);
    expect((await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graph_runs where graph_id = $1",
      [initialGraphId],
    )).rows[0].count).toBe(0);

    // The id-bound repository and synchronized project metadata form one
    // active binding. Corrupting the denormalized text must fail closed rather
    // than letting the later claim projection fall through to null.
    await resetRole(db);
    await db.exec("set session_replication_role = replica");
    await db.query(
      "update public.projects set github_repository = 'stale/wrong-repository' where id = $1",
      [projectId],
    );
    await db.exec("set session_replication_role = origin");

    await asWorker(db);
    expect((await db.query<{ claim: unknown }>(
      `select public.claim_planned_graph_v2(
         'initial-lineage-worker', array['MODEL','ANCHOR'], 'factory/lineage',
         $1::jsonb, 2
       ) as claim`,
      [requiredCheckNamesJson],
    )).rows[0].claim).toBeNull();

    await resetRole(db);
    await db.exec("set session_replication_role = replica");
    await db.query(
      "update public.projects set github_repository = 'factory/lineage' where id = $1",
      [projectId],
    );
    await db.exec("set session_replication_role = origin");
    await asWorker(db);
    const result = await db.query<{ claim: Record<string, unknown> }>(
      `select public.claim_planned_graph_v2(
         'initial-lineage-worker', array['MODEL','ANCHOR'], 'factory/lineage',
         $1::jsonb, 2
       ) as claim`,
      [requiredCheckNamesJson],
    );
    expect(result.rows[0].claim).toMatchObject({
      graph_id: initialGraphId,
      template_key: "full_lifecycle",
      template_version: 2,
      project_name: "Lineage Project",
      project_repository: "factory/lineage",
      project_default_branch: "main",
      required_check_names: requiredCheckNames,
      phase1c_state: null,
    });
    expect(result.rows[0].claim.required_checks_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rows[0].claim.graph_run_id).toEqual(expect.any(String));
  });

  it("atomically aborts only an unstarted claim and replays exact evidence once", async () => {
    const reason = "The returned claim could not be compiled safely.";
    await resetRole(db);
    await db.exec(`
      insert into public.graphs (
        id, organization_id, project_id, goal, topology, risk_level,
        requires_owner_approval, created_by
      ) values
        ('${abortGraphId}', '${organizationId}', '${projectId}',
         'Contain an unusable claim', 'SEQUENTIAL', 'green', true, '${ownerId}'),
        ('${startedAbortGraphId}', '${organizationId}', '${projectId}',
         'Do not kill started execution', 'SEQUENTIAL', 'green', true, '${ownerId}');
      insert into public.graph_budgets (organization_id, graph_id) values
        ('${organizationId}', '${abortGraphId}'),
        ('${organizationId}', '${startedAbortGraphId}');
      insert into public.graph_nodes (
        id, organization_id, graph_id, node_key, job, executor, capability
      ) values
        ('${abortNodeIds[0]}', '${organizationId}', '${abortGraphId}',
         'first', 'First unstarted node', 'MODEL', 'analysis'),
        ('${abortNodeIds[1]}', '${organizationId}', '${abortGraphId}',
         'second', 'Second unstarted node', 'MODEL', 'analysis'),
        ('${startedAbortNodeId}', '${organizationId}', '${startedAbortGraphId}',
         'started', 'Already started node', 'MODEL', 'analysis');
      insert into public.graph_runs (
        id, organization_id, graph_id, state, started_at, created_by
      ) values
        ('${abortGraphRunId}', '${organizationId}', '${abortGraphId}',
         'RUNNING', now(), '${ownerId}'),
        ('${startedAbortGraphRunId}', '${organizationId}', '${startedAbortGraphId}',
         'RUNNING', now(), '${ownerId}');
      insert into public.node_runs (
        id, organization_id, graph_run_id, node_id, state, queued_at, started_at
      ) values
        ('${abortNodeRunIds[0]}', '${organizationId}', '${abortGraphRunId}',
         '${abortNodeIds[0]}', 'PENDING', now(), null),
        ('${abortNodeRunIds[1]}', '${organizationId}', '${abortGraphRunId}',
         '${abortNodeIds[1]}', 'PENDING', now(), null),
        ('${startedAbortNodeRunId}', '${organizationId}', '${startedAbortGraphRunId}',
         '${startedAbortNodeId}', 'RUNNING', now(), now());
    `);

    await asUser(db, ownerId);
    await expect(db.query(
      "select public.abort_graph_run_as_worker('projection-worker', $1, 'FAILED', $2)",
      [abortGraphRunId, reason],
    )).rejects.toThrow(/permission denied/i);

    await asWorker(db);
    await db.query(
      "select public.abort_graph_run_as_worker('projection-worker', $1, 'FAILED', $2)",
      [abortGraphRunId, reason],
    );
    await resetRole(db);
    const firstParent = await db.query<{
      closure_note: string | null;
      completed_at: string;
      had_partial_input: boolean;
      state: string;
    }>(
      `select closure_note, completed_at::text, had_partial_input, state::text
       from public.graph_runs where id = $1`,
      [abortGraphRunId],
    );
    expect(firstParent.rows[0]).toMatchObject({
      closure_note: reason,
      had_partial_input: true,
      state: "FAILED",
    });
    expect(firstParent.rows[0].completed_at).toEqual(expect.any(String));
    expect((await db.query<{
      blocked_reason: string;
      completed: boolean;
      state: string;
    }>(
      `select blocked_reason, completed_at is not null as completed, state::text
       from public.node_runs where graph_run_id = $1 order by id`,
      [abortGraphRunId],
    )).rows).toEqual([
      { blocked_reason: reason, completed: true, state: "CANCELLED" },
      { blocked_reason: reason, completed: true, state: "CANCELLED" },
    ]);
    const firstEvents = await db.query<{ count: number; event_type: string }>(
      `select event_type, count(*)::integer as count
       from public.graph_events where graph_run_id = $1
       group by event_type order by event_type`,
      [abortGraphRunId],
    );
    expect(firstEvents.rows).toEqual([
      { event_type: "node_cancelled", count: 2 },
      { event_type: "run_abort_requested", count: 1 },
      { event_type: "run_failed", count: 1 },
    ]);

    await asWorker(db);
    await db.query(
      "select public.abort_graph_run_as_worker('projection-worker', $1, 'FAILED', $2)",
      [abortGraphRunId, reason],
    );
    await expect(db.query(
      "select public.abort_graph_run_as_worker('projection-worker', $1, 'FAILED', $2)",
      [abortGraphRunId, "A different abort reason."],
    )).rejects.toThrow(/abort replay does not match durable evidence/i);
    await resetRole(db);
    expect((await db.query(
      "select closure_note, completed_at::text, had_partial_input, state::text from public.graph_runs where id = $1",
      [abortGraphRunId],
    )).rows).toEqual(firstParent.rows);
    expect((await db.query(
      `select event_type, count(*)::integer as count
       from public.graph_events where graph_run_id = $1
       group by event_type order by event_type`,
      [abortGraphRunId],
    )).rows).toEqual(firstEvents.rows);

    await asWorker(db);
    await expect(db.query(
      "select public.abort_graph_run_as_worker('projection-worker', $1, 'FAILED', $2)",
      [startedAbortGraphRunId, reason],
    )).rejects.toThrow(/unstarted all-PENDING child set/i);
    await resetRole(db);
    expect((await db.query<{ child_state: string; parent_state: string }>(
      `select node_run.state::text as child_state, run.state::text as parent_state
       from public.graph_runs run
       join public.node_runs node_run on node_run.graph_run_id = run.id
       where run.id = $1`,
      [startedAbortGraphRunId],
    )).rows).toEqual([{ child_state: "RUNNING", parent_state: "RUNNING" }]);
    expect((await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graph_events where graph_run_id = $1",
      [startedAbortGraphRunId],
    )).rows[0].count).toBe(0);
  });

  it("holds an approved full lifecycle architecture until exact PR evidence exists", async () => {
    await asWorker(db);
    const held = await db.query<{ claim: unknown }>(
      `select public.claim_planned_graph_v2(
         'lineage-worker', array['MODEL','ANCHOR'], 'factory/lineage', $1::jsonb, 2
       ) as claim`,
      [requiredCheckNamesJson],
    );
    expect(held.rows[0].claim).toBeNull();

    await asUser(db, ownerId);
    await expect(db.query(
      `select public.attach_graph_phase1c_command_for_approved_gate($1, $2, $3)`,
      [
        bridgeId,
        "71000000-0000-4000-8000-0000000009a1",
        "72000000-0000-4000-8000-0000000009a1",
      ],
    )).rejects.toThrow(/permission denied/i);

    const submission = await db.query<{
      bridge_id: string;
      command_id: string;
      command_state: string;
      task_id: string;
      task_state: string;
      was_created: boolean;
    }>(
      `select bridge_id, command_id, command_state::text, task_id,
              task_state::text, was_created
       from public.submit_and_attach_graph_phase1c_command($1, $2::jsonb)`,
      [bridgeId, JSON.stringify(phase1CParameters())],
    );
    expect(submission.rows[0]).toMatchObject({
      bridge_id: bridgeId,
      command_state: "queued",
      task_state: "queued",
      was_created: true,
    });
    commandId = submission.rows[0].command_id;
    taskId = submission.rows[0].task_id;

    const replay = await db.query<{ command_id: string; task_id: string; was_created: boolean }>(
      `select command_id, task_id, was_created
       from public.submit_and_attach_graph_phase1c_command($1, $2::jsonb)`,
      [bridgeId, JSON.stringify(phase1CParameters())],
    );
    expect(replay.rows[0]).toEqual({ command_id: commandId, task_id: taskId, was_created: false });

    await resetRole(db);
    const persisted = await db.query<{
      agent_run_id: string;
      architecture_intent_sha256: string;
      parameters: Record<string, unknown>;
      prompt: string;
    }>(
      `select run.id as agent_run_id, bridge.architecture_intent_sha256,
              command.parameters, command.prompt
       from public.graph_phase1c_bridges bridge
       join public.commands command on command.id = bridge.command_id
       join public.agent_runs run on run.command_id = command.id
       where bridge.id = $1`,
      [bridgeId],
    );
    agentRunId = persisted.rows[0].agent_run_id;
    expect(persisted.rows[0].parameters).not.toHaveProperty("graphContext");
    expect(persisted.rows[0].prompt).toContain(
      `Architecture intent SHA-256: ${persisted.rows[0].architecture_intent_sha256}`,
    );

    await db.exec(`
      set session_replication_role = replica;
      update public.commands
      set status = 'running'
      where id = '${commandId}';
      update public.tasks
      set status = 'in_progress'
      where id = '${taskId}';
      update public.agent_runs
      set status = 'running',
          attempt_number = 1,
          lease_worker_id = 'phase1c-lineage-worker',
          lease_token = '${phase1CLeaseToken}',
          lease_expires_at = now() + interval '10 minutes',
          started_at = now() - interval '8 minutes'
      where id = '${agentRunId}';
      insert into public.phase1c_run_validations (
        organization_id, run_id, attempt_number, validation_round, name,
        command, status, duration_ms, output_summary
      ) values
        ('${organizationId}', '${agentRunId}', 1, 1, 'lint', 'npm run lint', 'failed', 100, 'old round'),
        ('${organizationId}', '${agentRunId}', 1, 2, 'diff-check', 'git diff --check', 'passed', 90, 'clean'),
        ('${organizationId}', '${agentRunId}', 1, 2, 'lint', 'npm run lint', 'passed', 110, 'passed'),
        ('${organizationId}', '${agentRunId}', 1, 2, 'test', 'npm test', 'passed', 220, 'passed');
      set session_replication_role = origin;
    `);

    await asWorker(db);
    await db.query(
      `select public.bind_graph_phase1c_run_by_command_as_worker($1, $2, $3)`,
      [commandId, taskId, agentRunId],
    );
    await db.query(
      `select public.record_phase1c_run_artifact(
         'phase1c-lineage-worker', $1, $2, 'branch', 'factory/exact-lineage', null, '{}'::jsonb
       )`,
      [agentRunId, phase1CLeaseToken],
    );
    await db.query(
      `select public.record_phase1c_run_artifact(
         'phase1c-lineage-worker', $1, $2, 'commit', $3, null, '{}'::jsonb
       )`,
      [agentRunId, phase1CLeaseToken, headSha],
    );
    await db.query(
      `select public.record_phase1c_run_artifact(
         'phase1c-lineage-worker', $1, $2, 'pull_request',
         'https://github.com/factory/lineage/pull/42', 42,
         jsonb_build_object('commitSha', $3::text)
       )`,
      [agentRunId, phase1CLeaseToken, headSha],
    );
    await db.query(
      `select * from public.complete_phase1c_run_with_graph_bridge_as_worker(
         'phase1c-lineage-worker', $1, $2, 'succeeded', 'Exact lineage complete.',
         null, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, false
       )`,
      [agentRunId, phase1CLeaseToken],
    );
    await db.query(
      `select * from public.complete_phase1c_run_with_graph_bridge_as_worker(
         'phase1c-lineage-worker', $1, $2, 'succeeded', 'Exact lineage complete.',
         null, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, false
       )`,
      [agentRunId, phase1CLeaseToken],
    );

    await resetRole(db);
    const pullIdentity = await db.query<{ pull_request_id: string }>(
      `select pull_request_id from public.graph_phase1c_bridges where id = $1`,
      [bridgeId],
    );
    recordedPullRequestId = pullIdentity.rows[0].pull_request_id;

    await asWorker(db);
    const result = await db.query<{ claim: Record<string, unknown> }>(
      `select public.claim_planned_graph_v2(
         'lineage-worker', array['MODEL','ANCHOR'], 'factory/lineage', $1::jsonb, 2
       ) as claim`,
      [requiredCheckNamesJson],
    );
    const claim = result.rows[0].claim;
    resumedGraphRunId = claim.graph_run_id as string;
    expect(claim).toMatchObject({
      template_key: "full_lifecycle",
      template_version: 2,
      base_branch: "main",
      base_sha: baseSha,
      required_check_names: requiredCheckNames,
      phase1c_state: "PULL_REQUEST_RECORDED",
      phase1c_head_sha: headSha,
      pull_request_number: 42,
      pull_request_url: "https://github.com/factory/lineage/pull/42",
      merge_commit_sha: null,
      deployment_id: null,
      deployment_url: null,
    });
    expect(claim.validation_evidence).toEqual({
      agent_run_id: agentRunId,
      head_sha: headSha,
      validation_round: 2,
      validations: [
        { name: "diff-check", status: "passed", duration_ms: 90 },
        { name: "lint", status: "passed", duration_ms: 110 },
        { name: "test", status: "passed", duration_ms: 220 },
      ],
    });
  });

  it("advances every identity once with time-zone-independent intent consumption and replay", async () => {
    await resetRole(db);
    await db.exec(`
      set session_replication_role = replica;
      update public.graph_runs
      set state = 'PARTIAL', completed_at = now() - interval '2 minutes'
      where id = '${resumedGraphRunId}';
      update public.node_runs
      set state = 'VERIFYING',
          started_at = coalesce(started_at, now() - interval '2 minutes'),
          completed_at = null
      where graph_run_id = '${resumedGraphRunId}'
        and node_id in ('${testNodeId}', '${deploymentNodeId}');
      insert into public.graph_gates (
        id, organization_id, graph_id, node_id, stage, kind, state,
        opened_by_run_id, opened_at
      ) values
        ('${testGateId}', '${organizationId}', '${graphId}', '${testNodeId}',
         'TEST', 'HUMAN', 'OPEN', '${resumedGraphRunId}', now() - interval '90 seconds'),
        ('${deploymentGateId}', '${organizationId}', '${graphId}', '${deploymentNodeId}',
         'DEPLOYMENT', 'HUMAN', 'OPEN', '${resumedGraphRunId}', now() - interval '60 seconds');
      insert into public.graph_artifacts (
        id, organization_id, graph_run_id, node_run_id, kind, payload, created_at
      )
      select '${testArtifactId}', '${organizationId}', '${resumedGraphRunId}',
        node_run.id, 'ANCHOR', jsonb_build_object(
          'observation', 'ci_check_runs',
          'sha', '${headSha}',
          'repository', 'factory/lineage',
          'total', 4,
          'checks', jsonb_build_array(
            jsonb_build_object(
              'name', 'Lint, typecheck, test, and build',
              'conclusion', 'success',
              'url', 'https://github.com/factory/lineage/actions/runs/900041'
            ),
            jsonb_build_object(
              'name', 'Browser and accessibility tests 1/3',
              'conclusion', 'success',
              'url', 'https://github.com/factory/lineage/actions/runs/900042'
            ),
            jsonb_build_object(
              'name', 'Browser and accessibility tests 2/3',
              'conclusion', 'success',
              'url', 'https://github.com/factory/lineage/actions/runs/900043'
            ),
            jsonb_build_object(
              'name', 'Browser and accessibility tests 3/3',
              'conclusion', 'success',
              'url', 'https://github.com/factory/lineage/actions/runs/900044'
            )
          ),
          'failing', jsonb_build_array(),
          'observedAt', to_char(
            (now() - interval '105 seconds') at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'latencyMs', 42
        ), now() - interval '100 seconds'
      from public.node_runs node_run
      where node_run.graph_run_id = '${resumedGraphRunId}'
        and node_run.node_id = '${testNodeId}';
      insert into public.graph_artifacts (
        id, organization_id, graph_run_id, node_run_id, kind, payload
      )
      select '${deploymentArtifactId}', '${organizationId}', '${resumedGraphRunId}',
        node_run.id, 'ANCHOR', jsonb_build_object(
          'observation', 'github_production_deployment',
          'deploymentId', '900042',
          'repository', 'factory/lineage',
          'sha', '${mergeSha}',
          'ref', 'main',
          'environment', 'Production',
          'state', 'success',
          'environmentUrl', 'https://lineage.example.test'
        )
      from public.node_runs node_run
      where node_run.graph_run_id = '${resumedGraphRunId}'
        and node_run.node_id = '${deploymentNodeId}';
      set session_replication_role = origin;
    `);

    await resetRole(db);
    for (const [duplicateId, payload] of [
      [arbitraryTestArtifactId, { observation: "claimed_ci_success", result: "green" }],
      [mismatchedTestArtifactId, {
        observation: "ci_check_runs",
        sha: "d".repeat(40),
        repository: "factory/lineage",
        total: 1,
        checks: [{ name: "CI", conclusion: "success", url: "https://github.com/factory/lineage/actions/runs/900043" }],
        failing: [],
        observedAt: new Date().toISOString(),
        latencyMs: 12,
      }],
    ] as const) {
      await expect(db.query(
        `insert into public.graph_artifacts (
           id, organization_id, graph_run_id, node_run_id, kind, payload
         )
         select $1, $2, $3, node_run.id, 'ANCHOR', $4::jsonb
         from public.node_runs node_run
         where node_run.graph_run_id = $3 and node_run.node_id = $5`,
        [duplicateId, organizationId, resumedGraphRunId, JSON.stringify(payload), testNodeId],
      )).rejects.toThrow(/duplicate key|graph_artifacts_one_product_per_node_kind/i);
    }
    expect((await db.query<{ count: number }>(
      `select count(*)::integer as count from public.graph_artifacts
       where graph_run_id = $1 and node_run_id = (
         select id from public.node_runs where graph_run_id = $1 and node_id = $2
       ) and kind = 'ANCHOR'`,
      [resumedGraphRunId, testNodeId],
    )).rows[0].count).toBe(1);

    await asUser(db, ownerId);
    await db.exec("set time zone 'America/New_York'");
    expect((await db.query<{ timezone: string }>(
      "select current_setting('TimeZone') as timezone",
    )).rows[0].timezone).toBe("America/New_York");
    const testIntent = await db.query<{ consume_nonce: string; intent_id: string }>(
      `select intent_id, consume_nonce
       from public.request_graph_release_gate_approval($1, $2, $3, $4)`,
      [testGateId, bridgeId, testArtifactId, "Exact-head CI passed"],
    );

    await resetRole(db);
    const testIntentEvidence = await db.query<{
      evidence_sha256: string;
      has_exact_digest: boolean;
    }>(
      `select evidence_sha256,
              evidence_sha256 ~ '^[0-9a-f]{64}$' as has_exact_digest
       from public.graph_release_gate_approval_intents
       where id = $1`,
      [testIntent.rows[0].intent_id],
    );
    expect(testIntentEvidence.rows[0].has_exact_digest).toBe(true);
    expect(testIntentEvidence.rows[0].evidence_sha256).toHaveLength(64);
    const testIntentActivityBefore = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.activity_events
       where entity_type = 'graph_release_gate_approval_intent'
         and entity_id = $1`,
      [testIntent.rows[0].intent_id],
    );

    const intentTrigger = await db.query<{ enabled: string }>(
      `select tgenabled as enabled
       from pg_trigger
       where tgrelid = 'public.graph_release_gate_approval_intents'::regclass
         and tgname = 'graph_release_gate_intents_immutable'
         and not tgisinternal`,
    );
    expect(intentTrigger.rows).toEqual([{ enabled: "O" }]);

    const pullRequestTiming = await db.query<{ created_at: string }>(
      `select created_at::text from public.pull_requests where id = $1`,
      [recordedPullRequestId],
    );
    const mergedAt = new Date(Math.max(
      Date.now(),
      new Date(pullRequestTiming.rows[0].created_at).getTime() + 1,
    )).toISOString();

    await overwriteReleaseIntentDigestFixture(
      db,
      testIntent.rows[0].intent_id,
      "0".repeat(64),
    );
    await asWorker(db);
    await expect(db.query(
      `select * from public.approve_graph_phase1c_test_gate_as_worker(
         $1, $2, 42, $3, 'factory/exact-lineage', 'main', $4,
         $5::timestamptz
       )`,
      [testIntent.rows[0].intent_id, testIntent.rows[0].consume_nonce,
        headSha, mergeSha, mergedAt],
    )).rejects.toThrow(/TEST approval artifact digest no longer matches the owner intent/i);
    await resetRole(db);
    const rejectedTestConsumption = await db.query<{
      activity_count: number;
      bridge_state: string;
      gate_state: string;
      intent_state: string;
      merge_commit_sha: string | null;
    }>(
      `select gate.state::text as gate_state,
              intent.state as intent_state,
              bridge.state as bridge_state,
              bridge.merge_commit_sha,
              (select count(*)::integer from public.activity_events event
                where event.entity_type = 'graph_release_gate_approval_intent'
                  and event.entity_id = intent.id) as activity_count
       from public.graph_release_gate_approval_intents intent
       join public.graph_gates gate on gate.id = intent.gate_id
       join public.graph_phase1c_bridges bridge on bridge.id = intent.bridge_id
       where intent.id = $1`,
      [testIntent.rows[0].intent_id],
    );
    expect(rejectedTestConsumption.rows[0]).toEqual({
      activity_count: testIntentActivityBefore.rows[0].count,
      bridge_state: "PULL_REQUEST_RECORDED",
      gate_state: "OPEN",
      intent_state: "PENDING",
      merge_commit_sha: null,
    });
    await overwriteReleaseIntentDigestFixture(
      db,
      testIntent.rows[0].intent_id,
      testIntentEvidence.rows[0].evidence_sha256,
    );

    await asWorker(db);
    await db.exec("set time zone 'UTC'");
    const approvedTest = await db.query<{
      bridge_id: string;
      gate_state: string;
      head_sha: string;
      merge_commit_sha: string;
    }>(
      `select bridge_id, gate_state::text, head_sha, merge_commit_sha
       from public.approve_graph_phase1c_test_gate_as_worker(
         $1, $2, 42, $3, 'factory/exact-lineage', 'main', $4,
         $5::timestamptz
       )`,
      [testIntent.rows[0].intent_id, testIntent.rows[0].consume_nonce,
        headSha, mergeSha, mergedAt],
    );
    expect(approvedTest.rows[0]).toEqual({
      bridge_id: bridgeId,
      gate_state: "APPROVED",
      head_sha: headSha,
      merge_commit_sha: mergeSha,
    });
    await db.exec("set time zone 'Asia/Tokyo'");
    const mergedAtTokyo = timestampAtOffset(mergedAt, 9 * 60);
    const testReplay = await db.query<{ bridge_id: string; merge_commit_sha: string }>(
      `select bridge_id, merge_commit_sha
       from public.approve_graph_phase1c_test_gate_as_worker(
         $1, $2, 42, $3, 'factory/exact-lineage', 'main', $4,
         $5::timestamptz
       )`,
      [testIntent.rows[0].intent_id, testIntent.rows[0].consume_nonce,
        headSha, mergeSha, mergedAtTokyo],
    );
    expect(testReplay.rows[0]).toEqual({ bridge_id: bridgeId, merge_commit_sha: mergeSha });
    await expect(db.query(
      `select * from public.approve_graph_phase1c_test_gate_as_worker(
         $1, $2, 42, $3, 'factory/exact-lineage', 'main', $4,
         $5::timestamptz
       )`,
      [testIntent.rows[0].intent_id, testIntent.rows[0].consume_nonce,
        headSha, "d".repeat(40), mergedAtTokyo],
    )).rejects.toThrow(/consumed TEST approval does not match exact replay evidence/i);

    await asUser(db, ownerId);
    await db.exec("set time zone 'America/New_York'");
    const deploymentIntent = await db.query<{ consume_nonce: string; intent_id: string }>(
      `select intent_id, consume_nonce
       from public.request_graph_release_gate_approval($1, $2, $3, $4)`,
      [deploymentGateId, bridgeId, deploymentArtifactId, "Production deployment accepted"],
    );

    const deploymentStartedAt = new Date(new Date(mergedAt).getTime() + 1).toISOString();
    const deploymentCompletedAt = new Date(new Date(mergedAt).getTime() + 2).toISOString();
    await resetRole(db);
    const deploymentIntentEvidence = await db.query<{
      evidence_sha256: string;
      has_exact_digest: boolean;
    }>(
      `select evidence_sha256,
              evidence_sha256 ~ '^[0-9a-f]{64}$' as has_exact_digest
       from public.graph_release_gate_approval_intents
       where id = $1`,
      [deploymentIntent.rows[0].intent_id],
    );
    expect(deploymentIntentEvidence.rows[0].has_exact_digest).toBe(true);
    expect(deploymentIntentEvidence.rows[0].evidence_sha256).toHaveLength(64);
    const deploymentIntentActivityBefore = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.activity_events
       where entity_type = 'graph_release_gate_approval_intent'
         and entity_id = $1`,
      [deploymentIntent.rows[0].intent_id],
    );

    await overwriteReleaseIntentDigestFixture(
      db,
      deploymentIntent.rows[0].intent_id,
      "f".repeat(64),
    );
    await asWorker(db);
    await expect(db.query(
      `select deployment_id
       from public.approve_graph_phase1c_deployment_gate_as_worker(
         $1, $2, $3, 900042, 'Production', $4, 'success',
         'https://lineage.example.test', $5::timestamptz, $6::timestamptz
       )`,
      [deploymentIntent.rows[0].intent_id, deploymentIntent.rows[0].consume_nonce,
        repositoryId, mergeSha, deploymentStartedAt, deploymentCompletedAt],
    )).rejects.toThrow(/DEPLOYMENT approval artifact digest no longer matches the owner intent/i);
    await resetRole(db);
    const rejectedDeploymentConsumption = await db.query<{
      activity_count: number;
      bridge_state: string;
      deployment_id: string | null;
      gate_state: string;
      intent_state: string;
    }>(
      `select gate.state::text as gate_state,
              intent.state as intent_state,
              bridge.state as bridge_state,
              bridge.deployment_id,
              (select count(*)::integer from public.activity_events event
                where event.entity_type = 'graph_release_gate_approval_intent'
                  and event.entity_id = intent.id) as activity_count
       from public.graph_release_gate_approval_intents intent
       join public.graph_gates gate on gate.id = intent.gate_id
       join public.graph_phase1c_bridges bridge on bridge.id = intent.bridge_id
       where intent.id = $1`,
      [deploymentIntent.rows[0].intent_id],
    );
    expect(rejectedDeploymentConsumption.rows[0]).toEqual({
      activity_count: deploymentIntentActivityBefore.rows[0].count,
      bridge_state: "MERGE_RECORDED",
      deployment_id: null,
      gate_state: "OPEN",
      intent_state: "PENDING",
    });
    await overwriteReleaseIntentDigestFixture(
      db,
      deploymentIntent.rows[0].intent_id,
      deploymentIntentEvidence.rows[0].evidence_sha256,
    );

    await asWorker(db);
    await db.exec("set time zone 'UTC'");
    const recordedDeployment = await db.query<{ deployment_id: string }>(
      `select deployment_id
       from public.approve_graph_phase1c_deployment_gate_as_worker(
         $1, $2, $3, 900042, 'Production', $4, 'success',
         'https://lineage.example.test', $5::timestamptz, $6::timestamptz
       )`,
      [deploymentIntent.rows[0].intent_id, deploymentIntent.rows[0].consume_nonce,
        repositoryId, mergeSha, deploymentStartedAt, deploymentCompletedAt],
    );
    const recordedDeploymentId = recordedDeployment.rows[0].deployment_id;
    await db.exec("set time zone 'America/Los_Angeles'");
    const deploymentStartedAtPacific = timestampAtOffset(deploymentStartedAt, -7 * 60);
    const deploymentCompletedAtPacific = timestampAtOffset(deploymentCompletedAt, -7 * 60);
    const deploymentReplay = await db.query<{ deployment_id: string }>(
      `select deployment_id
       from public.approve_graph_phase1c_deployment_gate_as_worker(
         $1, $2, $3, 900042, 'Production', $4, 'success',
         'https://lineage.example.test', $5::timestamptz, $6::timestamptz
       )`,
      [deploymentIntent.rows[0].intent_id, deploymentIntent.rows[0].consume_nonce,
        repositoryId, mergeSha, deploymentStartedAtPacific, deploymentCompletedAtPacific],
    );
    expect(deploymentReplay.rows[0].deployment_id).toBe(recordedDeploymentId);
    await expect(db.query(
      `select deployment_id
       from public.approve_graph_phase1c_deployment_gate_as_worker(
         $1, $2, $3, 900042, 'Production', $4, 'success',
         'https://lineage.example.test/changed', $5::timestamptz, $6::timestamptz
       )`,
      [deploymentIntent.rows[0].intent_id, deploymentIntent.rows[0].consume_nonce,
        repositoryId, mergeSha, deploymentStartedAtPacific, deploymentCompletedAtPacific],
    )).rejects.toThrow(/consumed DEPLOYMENT approval does not match exact replay evidence/i);
    await db.exec("set time zone 'UTC'");

    await resetRole(db);
    const consumedIntents = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.graph_release_gate_approval_intents
       where id in ($1, $2) and state = 'CONSUMED' and consumed_at is not null`,
      [testIntent.rows[0].intent_id, deploymentIntent.rows[0].intent_id],
    );
    expect(consumedIntents.rows[0].count).toBe(2);

    // A newer bridge on the same graph must never steal this resumed run's
    // terminal evidence. The run's write-once phase1c_bridge_id is decisive.
    await resetRole(db);
    await db.query(
      `insert into public.graph_runs (
         id, organization_id, graph_id, state, started_at, completed_at, created_by
       ) values ($1, $2, $3, 'PARTIAL', now() - interval '2 minutes', now(), $4)`,
      [decoyGraphRunId, organizationId, graphId, ownerId],
    );
    await db.query(
      `insert into public.graph_phase1c_bridges (
         id, organization_id, project_id, graph_id, graph_run_id,
         implementation_node_id, architecture_gate_id,
         architecture_artifact_id, architecture_intent_sha256, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [decoyBridgeId, organizationId, projectId, graphId, decoyGraphRunId,
        implementationNodeId, architectureGateId, architectureArtifactId,
        "d".repeat(64), ownerId],
    );
    const exactRunBridge = await db.query<{ phase1c_bridge_id: string }>(
      `select phase1c_bridge_id from public.graph_runs where id = $1`,
      [resumedGraphRunId],
    );
    expect(exactRunBridge.rows[0].phase1c_bridge_id).toBe(bridgeId);
    await expect(db.query(
      `update public.graph_runs set phase1c_bridge_id = $2 where id = $1`,
      [decoyGraphRunId, decoyBridgeId],
    )).rejects.toThrow(/write-once/i);

    const monitorObservedAt = new Date(
      new Date(deploymentCompletedAt).getTime() + 1,
    ).toISOString();
    await db.exec(`
      set session_replication_role = replica;
      update public.graph_runs
      set state = 'RUNNING', completed_at = null
      where id = '${resumedGraphRunId}';
      update public.node_runs
      set state = 'COMPLETED', started_at = coalesce(started_at, now() - interval '1 minute'),
          completed_at = coalesce(completed_at, now() - interval '5 seconds')
      where graph_run_id = '${resumedGraphRunId}';
      insert into public.graph_artifacts (
        organization_id, graph_run_id, node_run_id, kind, payload
      )
      select '${organizationId}', '${resumedGraphRunId}', node_run.id, 'ANCHOR',
        jsonb_build_object(
          'observation', 'production_http_probe',
          'deploymentId', '${recordedDeploymentId}',
          'url', 'https://lineage.example.test',
          'status', 200,
          'healthy', true,
          'postDeployValidation', 'inconclusive',
          'observationWindowComplete', false,
          'observedAt', '${monitorObservedAt}',
          'latencyMs', 42
        )
      from public.node_runs node_run
      where node_run.graph_run_id = '${resumedGraphRunId}'
        and node_run.node_id = '${monitorNodeId}';
      set session_replication_role = origin;
    `);

    await asWorker(db);
    await db.query(
      `select (public.complete_graph_run_with_phase1c_bridge_as_worker(
         'lineage-worker', $1, 'COMPLETED', false, 0, 0, null
       )).id`,
      [resumedGraphRunId],
    );
    // Lost-response retry is exact-idempotent and creates no second evidence.
    await db.query(
      `select (public.complete_graph_run_with_phase1c_bridge_as_worker(
         'lineage-worker', $1, 'COMPLETED', false, 0, 0, null
       )).id`,
      [resumedGraphRunId],
    );

    await resetRole(db);
    const bridge = await db.query<{ state: string; merge_commit_sha: string }>(
      `select state, merge_commit_sha from public.graph_phase1c_bridges where id = $1`,
      [bridgeId],
    );
    expect(bridge.rows[0]).toEqual({ state: "MONITORING_RECORDED", merge_commit_sha: mergeSha });
    const pullRequest = await db.query<{ merge_commit_sha: string; status: string }>(
      `select merge_commit_sha, status::text as status
       from public.pull_requests where id = $1`,
      [recordedPullRequestId],
    );
    expect(pullRequest.rows[0]).toEqual({ merge_commit_sha: mergeSha, status: "merged" });

    const events = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.activity_events
       where entity_type = 'graph_phase1c_bridge' and entity_id = $1`,
      [bridgeId],
    );
    expect(events.rows[0].count).toBe(7);
    const terminalEvidence = await db.query<{
      monitor_count: number;
      observation_count: number;
      validation_count: number;
      any_enabled: boolean;
      bridge_validation_id: string | null;
      monitor_provider: string;
      validation_state: string;
      correlations_match: boolean;
    }>(
      `select
         (select count(*)::integer from public.production_monitors
          where target_reference = 'graph_phase1c_bridge:' || $1::uuid::text) as monitor_count,
         (select count(*)::integer from public.monitor_observations
          where deployment_id = $2::uuid) as observation_count,
         (select count(*)::integer from public.deployment_validations
          where deployment_id = $2::uuid) as validation_count,
         coalesce((select bool_or(enabled) from public.production_monitors
          where target_reference = 'graph_phase1c_bridge:' || $1::uuid::text), false) as any_enabled,
         (select deployment_validation_id from public.graph_phase1c_bridges
          where id = $1::uuid) as bridge_validation_id,
         (select provider from public.production_monitors
          where target_reference = 'graph_phase1c_bridge:' || $1::uuid::text) as monitor_provider,
         (select state::text from public.deployment_validations
          where deployment_id = $2::uuid) as validation_state,
         (select observation.correlation_id = validation.correlation_id
          from public.monitor_observations observation
          join public.deployment_validations validation
            on validation.deployment_id = observation.deployment_id
          where observation.deployment_id = $2::uuid) as correlations_match`,
      [bridgeId, recordedDeploymentId],
    );
    expect(terminalEvidence.rows[0]).toEqual({
      monitor_count: 1,
      observation_count: 1,
      validation_count: 1,
      any_enabled: false,
      bridge_validation_id: null,
      monitor_provider: "http",
      validation_state: "inconclusive",
      correlations_match: true,
    });

    await asWorker(db);
    await expect(db.query(
      `select (public.complete_graph_run_with_phase1c_bridge_as_worker(
         'lineage-worker', $1, 'COMPLETED', false, 1, 0, null
       )).id`,
      [resumedGraphRunId],
    )).rejects.toThrow(/exact completion replay/i);
    await resetRole(db);

    await expect(db.query(
      `update public.graph_phase1c_bridges set state = 'GRAPH_READY' where id = $1`,
      [bridgeId],
    )).rejects.toThrow(/exactly one step|write-once/i);
    await expect(db.query(
      `update public.graphs set base_sha = $2 where id = $1`,
      [graphId, "d".repeat(40)],
    )).rejects.toThrow(/write-once/i);
    await expect(db.query(
      `update public.activity_events set description = 'changed'
       where entity_type = 'graph_phase1c_bridge' and entity_id = $1`,
      [bridgeId],
    )).rejects.toThrow(/append-only/i);
  });

  it("refuses evidence-free approval through the generic gate RPC", async () => {
    await asUser(db, ownerId);
    await expect(db.query(
      `select (public.decide_node_gate($1, true, 'Bypass exact evidence')).state`,
      [testGateId],
    )).rejects.toThrow(/full lifecycle release gates require evidence-bound approval/i);
  });

  it("creates and identifies full_lifecycle v2 atomically at launch", async () => {
    const template = findTemplate("full_lifecycle");
    const built = buildLaunchPlan(template!, budgetForTemplate(template!, DEFAULT_GRAPH_BUDGET));
    if (!built.ok) throw new Error(built.errors.join("; "));

    // Reconstruct the exact pre-post-deploy plan so the forward migration
    // proves it replaced one digest instead of widening template admission.
    const legacyNodes = JSON.parse(JSON.stringify(built.plan.nodes)) as Array<{
      job: string;
      node_key: string;
      output_schema: {
        $schema?: string;
        anyOf?: unknown[];
        properties?: Record<string, unknown>;
      };
    }>;
    const legacyDeploy = legacyNodes.find((node) => node.node_key === "deploy");
    const legacyMonitor = legacyNodes.find((node) => node.node_key === "monitor");
    if (!legacyDeploy?.output_schema.properties || !legacyMonitor?.output_schema.anyOf?.[1]) {
      throw new Error("current lifecycle schemas cannot reconstruct the prior canonical plan");
    }
    delete legacyDeploy.output_schema.properties.providerRef;
    legacyMonitor.job =
      "Probe the exact deployment URL recorded on this graph's bridge, tied to its deployment identity, and report what the running system returned.";
    legacyMonitor.output_schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...(legacyMonitor.output_schema.anyOf[1] as Record<string, unknown>),
    };
    const legacyCanonicalPlan = {
      topology: built.plan.topology,
      topologyReasons: built.plan.topologyReasons,
      riskLevel: built.plan.riskLevel,
      requiresOwnerApproval: built.plan.requiresOwnerApproval,
      nodes: legacyNodes,
      edges: built.plan.edges,
      budget: built.plan.budget,
    };
    await resetRole(db);
    const legacyDigest = await db.query<{ digest: string }>(
      `select encode(sha256(convert_to($1::jsonb::text, 'UTF8')), 'hex') as digest`,
      [JSON.stringify(legacyCanonicalPlan)],
    );
    expect(legacyDigest.rows[0].digest).toBe(
      "ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09",
    );

    await resetRole(db);
    const beforeLaunch = (await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graphs",
    )).rows[0].count;

    await asUser(db, ownerId);
    await expect(db.query(
      `select public.create_graph_from_plan_with_release_identity_as_server(
         $1, $2, $3, $4, $5::public.graph_topology, $6::jsonb,
         $7::public.risk_level, $8, $9::jsonb, $10::jsonb, $11::jsonb,
         'full_lifecycle', 2, $12, 'main', $13, $14::jsonb
       )`,
      [
        organizationId,
        ownerId,
        projectId,
        built.plan.goal,
        built.plan.topology,
        JSON.stringify(built.plan.topologyReasons),
        built.plan.riskLevel,
        built.plan.requiresOwnerApproval,
        JSON.stringify(built.plan.nodes),
        JSON.stringify(built.plan.edges),
        JSON.stringify(built.plan.budget),
        repositoryId,
        baseSha,
        requiredCheckNamesJson,
      ],
    )).rejects.toThrow(/permission denied/i);
    await resetRole(db);
    expect((await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graphs",
    )).rows[0].count).toBe(beforeLaunch);

    await asWorker(db);
    await expect(db.query(
      `select public.create_graph_from_plan_with_release_identity_as_server(
         $1, $2, $3, $4, $5::public.graph_topology, $6::jsonb,
         $7::public.risk_level, $8, $9::jsonb, $10::jsonb, $11::jsonb,
         'full_lifecycle', 2, $12, 'main', $13, $14::jsonb
       ) as graph_id`,
      [
        organizationId,
        ownerId,
        projectId,
        built.plan.goal,
        built.plan.topology,
        JSON.stringify(built.plan.topologyReasons),
        built.plan.riskLevel,
        built.plan.requiresOwnerApproval,
        JSON.stringify(legacyNodes),
        JSON.stringify(built.plan.edges),
        JSON.stringify(built.plan.budget),
        repositoryId,
        baseSha,
        requiredCheckNamesJson,
      ],
    )).rejects.toThrow(/canonical digest/i);

    await expect(db.query(
      `select public.create_graph_from_plan_with_release_identity_as_server(
         $1, $2, $3, $4, $5::public.graph_topology, $6::jsonb,
         $7::public.risk_level, $8, $9::jsonb, $10::jsonb, $11::jsonb,
         'full_lifecycle_plus', 2, $12, 'main', $13, $14::jsonb
       ) as graph_id`,
      [
        organizationId,
        ownerId,
        projectId,
        built.plan.goal,
        built.plan.topology,
        JSON.stringify(built.plan.topologyReasons),
        built.plan.riskLevel,
        built.plan.requiresOwnerApproval,
        JSON.stringify(built.plan.nodes),
        JSON.stringify(built.plan.edges),
        JSON.stringify(built.plan.budget),
        repositoryId,
        baseSha,
        requiredCheckNamesJson,
      ],
    )).rejects.toThrow(/exact built-in full_lifecycle v2 launch identity/i);

    await expect(db.query(
      `select public.create_graph_from_plan_with_release_identity_as_server(
         $1, $2, $3, $4, $5::public.graph_topology, $6::jsonb,
         $7::public.risk_level, $8, $9::jsonb, $10::jsonb, $11::jsonb,
         'full_lifecycle', 2, $12, 'main', $13, null::jsonb
       )`,
      [
        organizationId,
        ownerId,
        projectId,
        built.plan.goal,
        built.plan.topology,
        JSON.stringify(built.plan.topologyReasons),
        built.plan.riskLevel,
        built.plan.requiresOwnerApproval,
        JSON.stringify(built.plan.nodes),
        JSON.stringify(built.plan.edges),
        JSON.stringify(built.plan.budget),
        repositoryId,
        baseSha,
      ],
    )).rejects.toThrow(/exact repository-owned required-check policy is required/i);
    await resetRole(db);
    expect((await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graphs",
    )).rows[0].count).toBe(beforeLaunch);

    await asWorker(db);
    const mutatedNodes = built.plan.nodes.map((node) => ({ ...node }));
    mutatedNodes[0] = { ...mutatedNodes[0], job: `${mutatedNodes[0].job} (mutated)` };
    await expect(db.query(
      `select public.create_graph_from_plan_with_release_identity_as_server(
         $1, $2, $3, $4, $5::public.graph_topology, $6::jsonb,
         $7::public.risk_level, $8, $9::jsonb, $10::jsonb, $11::jsonb,
         'full_lifecycle', 2, $12, 'main', $13, $14::jsonb
       ) as graph_id`,
      [
        organizationId,
        ownerId,
        projectId,
        built.plan.goal,
        built.plan.topology,
        JSON.stringify(built.plan.topologyReasons),
        built.plan.riskLevel,
        built.plan.requiresOwnerApproval,
        JSON.stringify(mutatedNodes),
        JSON.stringify(built.plan.edges),
        JSON.stringify(built.plan.budget),
        repositoryId,
        baseSha,
        requiredCheckNamesJson,
      ],
    )).rejects.toThrow(/canonical digest/i);

    const launched = await db.query<{ graph_id: string }>(
      `select public.create_graph_from_plan_with_release_identity_as_server(
         $1, $2, $3, $4, $5::public.graph_topology, $6::jsonb,
         $7::public.risk_level, $8, $9::jsonb, $10::jsonb, $11::jsonb,
         'full_lifecycle', 2, $12, 'main', $13, $14::jsonb
       ) as graph_id`,
      [
        organizationId,
        ownerId,
        projectId,
        built.plan.goal,
        built.plan.topology,
        JSON.stringify(built.plan.topologyReasons),
        built.plan.riskLevel,
        built.plan.requiresOwnerApproval,
        JSON.stringify(built.plan.nodes),
        JSON.stringify(built.plan.edges),
        JSON.stringify(built.plan.budget),
        repositoryId,
        baseSha,
        requiredCheckNamesJson,
      ],
    );

    await resetRole(db);
    const identity = await db.query<{
      base_branch: string;
      base_sha: string;
      github_repository_id: string;
      required_check_names: string[];
      required_checks_sha256: string;
      template_key: string;
      template_plan_sha256: string;
      template_version: number;
    }>(
      `select template_key, template_version, template_plan_sha256,
               github_repository_id, base_branch, base_sha,
               required_check_names, required_checks_sha256
       from public.graphs where id = $1`,
      [launched.rows[0].graph_id],
    );
    expect(identity.rows[0]).toEqual({
      template_key: "full_lifecycle",
      template_version: 2,
      template_plan_sha256: canonicalTemplatePlanSha256,
      github_repository_id: repositoryId,
      base_branch: "main",
      base_sha: baseSha,
      required_check_names: requiredCheckNames,
      required_checks_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const audit = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.activity_events
       where entity_type = 'graph' and entity_id = $1
         and metadata ->> 'template_key' = 'full_lifecycle'`,
      [launched.rows[0].graph_id],
    );
    expect(audit.rows[0].count).toBe(1);
  });
});
