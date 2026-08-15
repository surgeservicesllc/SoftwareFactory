// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const grantsMigration =
  "20260812002600_narrow_hosted_service_role_table_grants.sql";
const latestMigration =
  "20260815001000_cross_project_dependencies.sql";

const publicTables = [
  // Sorted alphabetically to match the catalogue query. Keep it sorted when
  // adding tables, and only after confirming RLS and FORCE RLS are enabled.
  // Both carry RLS and FORCE RLS with no policy at all, which is stricter than
  // the rest of this list rather than weaker: no role may read them directly.
  "activity_events",
  "agent_handoffs",
  "agent_runs",
  "agentos_agent_collaborators",
  "agentos_agent_filesystem_grants",
  "agentos_agent_grants",
  "agentos_agent_mcp_grants",
  "agentos_agent_repo_grants",
  "agentos_agent_skill_grants",
  "agentos_automations",
  "agentos_environments",
  "agentos_goal_dod_items",
  "agentos_goal_progress",
  "agentos_goals",
  "agentos_inbox_messages",
  "agentos_mcp_connections",
  "agentos_skills",
  "agentos_task_chain_steps",
  "agentos_task_chains",
  "agentos_task_template_steps",
  "agentos_task_templates",
  "agentos_trigger_deliveries",
  "agentos_triggers",
  "agents",
  "approvals",
  "autonomy_decisions",
  "bot_assignments",
  "bot_roles",
  "bots",
  "claim_acceptable_anchors",
  "claim_anchors",
  "commands",
  "connection_capability_types",
  "connections",
  "deployment_validations",
  "deployments",
  "github_change_requests",
  "github_installations",
  "github_project_handoff_approvals",
  "github_project_handoff_executions",
  "github_protected_change_approvals",
  "github_repositories",
  "github_webhook_deliveries",
  "graph_anchors",
  "graph_artifacts",
  "graph_budgets",
  "graph_edges",
  "graph_events",
  "graph_handoffs",
  "graph_nodes",
  "graph_runs",
  "graph_templates",
  "graph_verifications",
  "graphs",
  "incidents",
  "marketing_features",
  "marketing_logos",
  "marketing_pages",
  "marketing_plan_features",
  "marketing_pricing_plans",
  "marketing_resource_topics",
  "marketing_resources",
  "marketing_stats",
  "marketing_team_members",
  "marketing_testimonials",
  "monitor_observations",
  "newsletter_subscribers",
  "node_contracts",
  "node_run_claims",
  "node_runs",
  "operations_audit_events",
  "operations_events",
  "organization_members",
  "organizations",
  "phase1c_run_artifacts",
  "phase1c_run_events",
  "phase1c_run_validations",
  "phase1c_workers",
  "policies",
  "production_diagnoses",
  "production_monitors",
  "profiles",
  "project_connections",
  "project_health_snapshots",
  "projects",
  "provider_agent_assignments",
  "provider_capacity_limits",
  "provider_connect_sessions",
  "provider_credentials",
  "provider_model_configurations",
  "provider_routing_decisions",
  "provider_run_events",
  "pull_requests",
  "release_freezes",
  "repair_attempts",
  "reports",
  "resource_assignments",
  "resource_breaker_events",
  "resource_breakers",
  "rollback_operations",
  "scheduling_decisions",
  "synthetic_journeys",
  "task_dependencies",
  "task_work_locks",
  "tasks",
  "test_runs",
  "work_locks",
] as const;

const providerIngressTables = new Set([
  "github_change_requests",
  "github_installations",
  "github_repositories",
  "github_webhook_deliveries",
]);

type TablePrivileges = {
  can_delete: boolean;
  can_insert: boolean;
  can_references: boolean;
  can_select: boolean;
  can_trigger: boolean;
  can_truncate: boolean;
  can_update: boolean;
  table_name: string;
};

async function tablePrivileges(db: PGlite) {
  return db.query<TablePrivileges>(`
    select
      class.relname as table_name,
      pg_catalog.has_table_privilege(
        'service_role', class.oid, 'SELECT'
      ) as can_select,
      pg_catalog.has_table_privilege(
        'service_role', class.oid, 'INSERT'
      ) as can_insert,
      pg_catalog.has_table_privilege(
        'service_role', class.oid, 'UPDATE'
      ) as can_update,
      pg_catalog.has_table_privilege(
        'service_role', class.oid, 'DELETE'
      ) as can_delete,
      pg_catalog.has_table_privilege(
        'service_role', class.oid, 'TRUNCATE'
      ) as can_truncate,
      pg_catalog.has_table_privilege(
        'service_role', class.oid, 'REFERENCES'
      ) as can_references,
      pg_catalog.has_table_privilege(
        'service_role', class.oid, 'TRIGGER'
      ) as can_trigger
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relkind in ('r', 'p')
    order by class.relname
  `);
}

async function serviceFunctionPrivileges(db: PGlite) {
  return db.query<{ can_execute: boolean; function_signature: string }>(`
    select
      procedure.oid::regprocedure::text as function_signature,
      pg_catalog.has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ) as can_execute
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
    order by procedure.oid::regprocedure::text
  `);
}

describe("hosted service-role table grants", () => {
  it("removes hosted-like broad grants while preserving provider RPC access", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    try {
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
          select coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::jsonb,
            '{}'::jsonb
          )
        $$;
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
      `);

      const migrationFiles = (await readdir(migrationsDirectory))
        .filter((file) => /^\d+.*\.sql$/.test(file))
        .sort();
      expect(migrationFiles.at(-1)).toBe(latestMigration);

      for (const migrationFile of migrationFiles) {
        if (migrationFile === grantsMigration) continue;
        await db.exec(
          await readFile(resolve(migrationsDirectory, migrationFile), "utf8"),
        );
      }

      await db.exec(`
        grant all privileges on all tables in schema public to service_role;
      `);

      const hostedLikePrivileges = await tablePrivileges(db);
      expect(hostedLikePrivileges.rows.map((row) => row.table_name)).toEqual(
        publicTables,
      );
      expect(hostedLikePrivileges.rows.every((row) => (
        row.can_select &&
        row.can_insert &&
        row.can_update &&
        row.can_delete &&
        row.can_truncate &&
        row.can_references &&
        row.can_trigger
      ))).toBe(true);

      const functionsBefore = await serviceFunctionPrivileges(db);

      await db.exec(
        await readFile(resolve(migrationsDirectory, grantsMigration), "utf8"),
      );

      const narrowedPrivileges = await tablePrivileges(db);
      expect(narrowedPrivileges.rows).toEqual(
        publicTables.map((tableName) => {
          const providerIngress = providerIngressTables.has(tableName);
          return {
            can_delete: false,
            can_insert: providerIngress,
            can_references: false,
            can_select: providerIngress,
            can_trigger: false,
            can_truncate: false,
            can_update: providerIngress,
            table_name: tableName,
          };
        }),
      );

      const functionsAfter = await serviceFunctionPrivileges(db);
      expect(functionsAfter.rows).toEqual(functionsBefore.rows);

      const requiredFunctionPrivileges = await db.query<{
        complete_change: boolean;
        disconnect_connection: boolean;
        fail_change_with_evidence: boolean;
        mark_connection_lost: boolean;
        process_webhook: boolean;
        reconcile_repositories: boolean;
        recover_change: boolean;
        sensitive_json_internal: boolean;
        sensitive_json_wrapper: boolean;
        sensitive_text: boolean;
        sync_installation: boolean;
      }>(`
        select
          pg_catalog.has_function_privilege(
            'service_role',
            'public.sync_github_installation(uuid,uuid,bigint,bigint,text,bigint,text,text,text,text,text,jsonb,text[],timestamptz,timestamptz,jsonb,uuid)',
            'EXECUTE'
          ) as sync_installation,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.complete_github_change_request(uuid,uuid,text,text,text,bigint,integer,text,text)',
            'EXECUTE'
          ) as complete_change,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.fail_github_change_request_with_evidence(uuid,uuid,text,text,text,text)',
            'EXECUTE'
          ) as fail_change_with_evidence,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.recover_github_change_request_with_provider_evidence(uuid,uuid,text,text,text,text,bigint,integer,text,text)',
            'EXECUTE'
          ) as recover_change,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.disconnect_github_connection(uuid,uuid,bigint)',
            'EXECUTE'
          ) as disconnect_connection,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.mark_github_connection_lost(uuid,uuid,text)',
            'EXECUTE'
          ) as mark_connection_lost,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.process_github_webhook_delivery(uuid)',
            'EXECUTE'
          ) as process_webhook,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.reconcile_github_repository_grants(uuid,uuid,jsonb)',
            'EXECUTE'
          ) as reconcile_repositories,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.jsonb_has_sensitive_keys(jsonb)',
            'EXECUTE'
          ) as sensitive_json_wrapper,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.jsonb_has_sensitive_keys_internal(jsonb,integer)',
            'EXECUTE'
          ) as sensitive_json_internal,
          pg_catalog.has_function_privilege(
            'service_role',
            'public.text_has_likely_secret(text)',
            'EXECUTE'
          ) as sensitive_text
      `);
      expect(requiredFunctionPrivileges.rows[0]).toEqual({
        complete_change: true,
        disconnect_connection: true,
        fail_change_with_evidence: true,
        mark_connection_lost: true,
        process_webhook: true,
        reconcile_repositories: true,
        recover_change: true,
        sensitive_json_internal: false,
        sensitive_json_wrapper: true,
        sensitive_text: false,
        sync_installation: true,
      });
    } finally {
      await db.close();
    }
  }, 120_000);
});
