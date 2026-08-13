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
  "20260812001400_sync_linked_project_repository_metadata.sql",
];

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

describe("GitHub repository metadata propagation", () => {
  it("applies 001-014 and updates only exact linked projects with immutable redacted evidence", async () => {
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
            'public.sync_linked_project_repository_metadata()',
            'EXECUTE'
          ) as anon_execute,
          has_function_privilege(
            'authenticated',
            'public.sync_linked_project_repository_metadata()',
            'EXECUTE'
          ) as authenticated_execute,
          has_function_privilege(
            'service_role',
            'public.sync_linked_project_repository_metadata()',
            'EXECUTE'
          ) as service_execute
      `);
      expect(privileges.rows[0]).toEqual({
        anon_execute: false,
        authenticated_execute: false,
        service_execute: false,
      });

      const rls = await db.query<{
        relforcerowsecurity: boolean;
        relrowsecurity: boolean;
      }>(`
        select relrowsecurity, relforcerowsecurity
        from pg_catalog.pg_class class
        join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'public'
          and class.relname in ('activity_events', 'github_repositories', 'projects')
        order by class.relname
      `);
      expect(rls.rows).toHaveLength(3);
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
          id, organization_id, installation_id, external_repository_id, owner_login,
          name, full_name, default_branch, html_url, private, visibility,
          selected, github_updated_at
        ) values
          (
            '40000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            600001, 'factory-one', 'repository', 'factory-one/repository', 'main',
            'https://github.com/factory-one/repository', true, 'private', true, now()
          ),
          (
            '40000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000002',
            '30000000-0000-4000-8000-000000000002',
            600002, 'factory-two', 'repository', 'factory-two/repository', 'main',
            'https://github.com/factory-two/repository', true, 'private', true, now()
          );
        insert into public.projects (
          id, organization_id, name, status, github_repository, default_branch, created_by
        ) values
          (
            '50000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'Linked Project', 'active', 'factory-one/repository', 'main', '${ownerOneId}'
          ),
          (
            '50000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000001',
            'Unlinked Project', 'archived', 'factory-one/repository', 'main', '${ownerOneId}'
          ),
          (
            '50000000-0000-4000-8000-000000000003',
            '10000000-0000-4000-8000-000000000002',
            'Other Tenant Project', 'active', 'factory-two/repository', 'main', '${ownerTwoId}'
          );
        insert into public.project_connections (
          organization_id, project_id, connection_id, is_primary, created_by
        ) values
          (
            '10000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001', true, '${ownerOneId}'
          ),
          (
            '10000000-0000-4000-8000-000000000002',
            '50000000-0000-4000-8000-000000000003',
            '20000000-0000-4000-8000-000000000002', true, '${ownerTwoId}'
          );
      `);

      await db.exec(`
        update public.github_repositories
        set default_branch = 'trunk'
        where id = '40000000-0000-4000-8000-000000000001'
      `);

      const projectsAfterBranchChange = await db.query<{
        default_branch: string;
        github_repository: string;
        id: string;
      }>(`
        select id, github_repository, default_branch
        from public.projects
        order by id
      `);
      expect(projectsAfterBranchChange.rows).toEqual([
        {
          default_branch: "trunk",
          github_repository: "factory-one/repository",
          id: "50000000-0000-4000-8000-000000000001",
        },
        {
          default_branch: "main",
          github_repository: "factory-one/repository",
          id: "50000000-0000-4000-8000-000000000002",
        },
        {
          default_branch: "main",
          github_repository: "factory-two/repository",
          id: "50000000-0000-4000-8000-000000000003",
        },
      ]);

      await db.exec(`
        update public.github_repositories
        set name = 'renamed',
            full_name = 'factory-one/renamed',
            default_branch = 'stable'
        where id = '40000000-0000-4000-8000-000000000001'
      `);

      const linkedProject = await db.query<{
        default_branch: string;
        github_repository: string;
      }>(`
        select github_repository, default_branch
        from public.projects
        where id = '50000000-0000-4000-8000-000000000001'
      `);
      expect(linkedProject.rows[0]).toEqual({
        default_branch: "stable",
        github_repository: "factory-one/renamed",
      });

      const syncEvents = await db.query<{
        actor_user_id: string | null;
        description: string;
        metadata: Record<string, unknown>;
        metadata_has_sensitive_data: boolean;
        project_id: string;
      }>(`
        select
          project_id,
          actor_user_id,
          description,
          metadata,
          public.jsonb_has_sensitive_keys(metadata) as metadata_has_sensitive_data
        from public.activity_events
        where description = 'GitHub repository metadata synchronized'
        order by occurred_at, id
      `);
      expect(syncEvents.rows).toHaveLength(2);
      expect(syncEvents.rows[0]).toMatchObject({
        actor_user_id: null,
        description: "GitHub repository metadata synchronized",
        metadata: {
          default_branch_changed: true,
          repository_name_changed: false,
          source: "github_repository_sync",
        },
        metadata_has_sensitive_data: false,
        project_id: "50000000-0000-4000-8000-000000000001",
      });
      expect(syncEvents.rows[1]).toMatchObject({
        actor_user_id: null,
        metadata: {
          default_branch_changed: true,
          repository_name_changed: true,
          source: "github_repository_sync",
        },
        metadata_has_sensitive_data: false,
        project_id: "50000000-0000-4000-8000-000000000001",
      });
      expect(JSON.stringify(syncEvents.rows)).not.toContain("factory-one/repository");
      expect(JSON.stringify(syncEvents.rows)).not.toContain("factory-one/renamed");
      expect(JSON.stringify(syncEvents.rows)).not.toContain("trunk");
      expect(JSON.stringify(syncEvents.rows)).not.toContain("stable");

      await expect(
        db.exec(`
          update public.activity_events
          set description = 'mutated'
          where description = 'GitHub repository metadata synchronized'
        `),
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      await db.close();
    }
  }, 60_000);
});
