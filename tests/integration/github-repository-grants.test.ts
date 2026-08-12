// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

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
];

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

describe("GitHub repository-grant reconciliation", () => {
  it("applies 001-013 and reconciles only the exact active tenant installation", async () => {
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
          select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
        $$;
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin;
      `);

      for (const migrationFile of migrationFiles) {
        await db.exec(await source(`supabase/migrations/${migrationFile}`));
      }

      const privileges = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        select
          has_function_privilege(
            'anon',
            'public.reconcile_github_repository_grants(uuid,uuid,jsonb)',
            'EXECUTE'
          ) as anon_execute,
          has_function_privilege(
            'authenticated',
            'public.reconcile_github_repository_grants(uuid,uuid,jsonb)',
            'EXECUTE'
          ) as authenticated_execute,
          has_function_privilege(
            'service_role',
            'public.reconcile_github_repository_grants(uuid,uuid,jsonb)',
            'EXECUTE'
          ) as service_execute
      `);
      expect(privileges.rows[0]).toEqual({
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
      });

      const rls = await db.query<{
        relforcerowsecurity: boolean;
        relname: string;
        relrowsecurity: boolean;
      }>(`
        select class.relname, class.relrowsecurity, class.relforcerowsecurity
        from pg_catalog.pg_class class
        join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'public'
          and class.relkind = 'r'
        order by class.relname
      `);
      expect(rls.rows.length).toBeGreaterThan(0);
      expect(rls.rows.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);

      const ownerOneId = "00000000-0000-4000-8000-000000000101";
      const ownerTwoId = "00000000-0000-4000-8000-000000000102";
      await db.exec(`
        insert into auth.users (id) values ('${ownerOneId}'), ('${ownerTwoId}');
        insert into public.organizations (id, name, slug, created_by) values
          ('10000000-0000-4000-8000-000000000001', 'Factory One', 'factory-one', '${ownerOneId}'),
          ('10000000-0000-4000-8000-000000000002', 'Factory Two', 'factory-two', '${ownerTwoId}');
        insert into public.connections (
          id, organization_id, name, provider, status, external_account_label,
          secret_reference, created_by
        ) values
          (
            '20000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'Factory One GitHub', 'github', 'connected', 'factory-one',
            'env://GITHUB_APP', '${ownerOneId}'
          ),
          (
            '20000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000002',
            'Factory Two GitHub', 'github', 'connected', 'factory-two',
            'env://GITHUB_APP', '${ownerTwoId}'
          );
        insert into public.github_installations (
          id, organization_id, connection_id, external_installation_id, app_id,
          app_slug, account_id, account_login, account_type, target_type,
          repository_selection, status, installed_at, created_by
        ) values
          (
            '30000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            900001, 700001, 'factory-app', 800001, 'factory-one',
            'Organization', 'Organization', 'selected', 'active', now(), '${ownerOneId}'
          ),
          (
            '30000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000002',
            900002, 700001, 'factory-app', 800002, 'factory-two',
            'Organization', 'Organization', 'selected', 'active', now(), '${ownerTwoId}'
          );
        insert into public.github_repositories (
          organization_id, installation_id, external_repository_id, owner_login,
          name, full_name, default_branch, html_url, private, visibility,
          selected, github_updated_at
        ) values
          (
            '10000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            600001, 'factory-one', 'legacy', 'factory-one/legacy', 'master',
            'https://github.com/factory-one/legacy', true, 'private', false,
            '2026-08-01T00:00:00Z'
          ),
          (
            '10000000-0000-4000-8000-000000000002',
            '30000000-0000-4000-8000-000000000002',
            600001, 'factory-two', 'untouched', 'factory-two/untouched', 'main',
            'https://github.com/factory-two/untouched', true, 'private', false,
            '2026-08-01T00:00:00Z'
          );
      `);

      const reconciledRepositories = [
        {
          archived: false,
          default_branch: "main",
          disabled: false,
          full_name: "factory-one/updated",
          html_url: "https://github.com/factory-one/updated",
          id: 600001,
          name: "updated",
          node_id: "R_repo_one",
          owner_login: "factory-one",
          permissions: { contents: true, metadata: true },
          private: true,
          pushed_at: "2026-08-12T11:59:00Z",
          updated_at: "2026-08-12T12:00:00Z",
          visibility: "private",
        },
        {
          archived: false,
          default_branch: "main",
          disabled: false,
          full_name: "factory-one/new-repository",
          html_url: "https://github.com/factory-one/new-repository",
          id: 600002,
          name: "new-repository",
          node_id: "R_repo_two",
          owner_login: "factory-one",
          permissions: { metadata: true },
          private: true,
          pushed_at: null,
          updated_at: "2026-08-12T12:01:00Z",
          visibility: "private",
        },
      ];

      await db.exec("set role authenticated");
      await expect(
        db.query(
          "select public.reconcile_github_repository_grants($1,$2,$3::jsonb)",
          [
            "10000000-0000-4000-8000-000000000001",
            "30000000-0000-4000-8000-000000000001",
            JSON.stringify(reconciledRepositories),
          ],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.exec("reset role");

      await db.exec("set role service_role");
      const reconciliation = await db.query<{ reconcile_github_repository_grants: number }>(
        "select public.reconcile_github_repository_grants($1,$2,$3::jsonb)",
        [
          "10000000-0000-4000-8000-000000000001",
          "30000000-0000-4000-8000-000000000001",
          JSON.stringify(reconciledRepositories),
        ],
      );
      expect(reconciliation.rows[0]?.reconcile_github_repository_grants).toBe(2);
      await db.exec("reset role");

      const tenantOneRepositories = await db.query<{
        default_branch: string;
        external_repository_id: number;
        full_name: string;
        selected: boolean;
      }>(`
        select external_repository_id, full_name, default_branch, selected
        from public.github_repositories
        where organization_id = '10000000-0000-4000-8000-000000000001'
          and installation_id = '30000000-0000-4000-8000-000000000001'
        order by external_repository_id
      `);
      expect(tenantOneRepositories.rows).toEqual([
        {
          default_branch: "main",
          external_repository_id: 600001,
          full_name: "factory-one/updated",
          selected: true,
        },
        {
          default_branch: "main",
          external_repository_id: 600002,
          full_name: "factory-one/new-repository",
          selected: true,
        },
      ]);

      const tenantTwoRepository = await db.query<{
        full_name: string;
        selected: boolean;
      }>(`
        select full_name, selected
        from public.github_repositories
        where organization_id = '10000000-0000-4000-8000-000000000002'
          and installation_id = '30000000-0000-4000-8000-000000000002'
          and external_repository_id = 600001
      `);
      expect(tenantTwoRepository.rows).toEqual([
        { full_name: "factory-two/untouched", selected: false },
      ]);

      await db.exec("set role service_role");
      await expect(
        db.query(
          "select public.reconcile_github_repository_grants($1,$2,$3::jsonb)",
          [
            "10000000-0000-4000-8000-000000000002",
            "30000000-0000-4000-8000-000000000001",
            JSON.stringify(reconciledRepositories),
          ],
        ),
      ).rejects.toMatchObject({ code: "P0002" });

      const sensitiveRepository = {
        ...reconciledRepositories[1],
        id: 600003,
        permissions: { access_token: "ghp_abcdefghijklmnopqrstuvwxyz123456" },
      };
      await expect(
        db.query(
          "select public.reconcile_github_repository_grants($1,$2,$3::jsonb)",
          [
            "10000000-0000-4000-8000-000000000001",
            "30000000-0000-4000-8000-000000000001",
            JSON.stringify([sensitiveRepository]),
          ],
        ),
      ).rejects.toMatchObject({ code: "22023" });
      await db.exec("reset role");

      const sensitiveRow = await db.query<{ count: number }>(`
        select count(*)::integer as count
        from public.github_repositories
        where external_repository_id = 600003
      `);
      expect(sensitiveRow.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 60_000);
});
