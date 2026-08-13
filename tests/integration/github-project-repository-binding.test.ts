// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationFilesBeforeBinding = [
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
const bindingMigration = "20260812002100_bind_projects_to_github_repository_ids.sql";
const migrationsAfterBinding = [
  "20260812002200_owner_approved_protected_draft_changes.sql",
  "20260812002300_github_activity_details.sql",
  "20260812002400_safe_activity_list_reads.sql",
  "20260812002500_harden_sensitive_assignments_and_protected_approval_integrity.sql",
] as const;

const ownerOneId = "00000000-0000-4000-8000-000000000101";
const ownerTwoId = "00000000-0000-4000-8000-000000000102";
const organizationOneId = "10000000-0000-4000-8000-000000000001";
const organizationTwoId = "10000000-0000-4000-8000-000000000002";
const connectionOneId = "20000000-0000-4000-8000-000000000001";
const connectionTwoId = "20000000-0000-4000-8000-000000000002";
const installationOneId = "30000000-0000-4000-8000-000000000001";
const installationTwoId = "30000000-0000-4000-8000-000000000002";
const boundRepositoryId = "40000000-0000-4000-8000-000000000001";
const ambiguousRepositoryOneId = "40000000-0000-4000-8000-000000000002";
const ambiguousRepositoryTwoId = "40000000-0000-4000-8000-000000000003";
const connectableRepositoryId = "40000000-0000-4000-8000-000000000004";
const otherTenantRepositoryId = "40000000-0000-4000-8000-000000000005";
const sameNameDecoyRepositoryId = "40000000-0000-4000-8000-000000000006";
const legacyProjectId = "50000000-0000-4000-8000-000000000001";
const ambiguousProjectId = "50000000-0000-4000-8000-000000000002";
const legacyLinkId = "60000000-0000-4000-8000-000000000001";
const ambiguousLinkId = "60000000-0000-4000-8000-000000000002";

async function source(file: string) {
  return readFile(resolve(repositoryRoot, "supabase/migrations", file), "utf8");
}

async function assumeAuthenticated(db: PGlite, userId: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("stable GitHub project repository bindings", () => {
  it("applies the full chain and enforces immutable tenant-scoped repository identity", async () => {
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

      for (const migrationFile of migrationFilesBeforeBinding) {
        await db.exec(await source(migrationFile));
      }

      await db.exec(`
        insert into auth.users (id) values ('${ownerOneId}'), ('${ownerTwoId}');
        insert into public.organizations (id, name, slug, created_by) values
          ('${organizationOneId}', 'Tenant One', 'tenant-one', '${ownerOneId}'),
          ('${organizationTwoId}', 'Tenant Two', 'tenant-two', '${ownerTwoId}');

        insert into public.connections (
          id, organization_id, name, provider, status, external_account_label,
          secret_reference, created_by
        ) values
          (
            '${connectionOneId}', '${organizationOneId}', 'Tenant One GitHub',
            'github', 'connected', 'tenant-one', 'env://GITHUB_APP', '${ownerOneId}'
          ),
          (
            '${connectionTwoId}', '${organizationTwoId}', 'Tenant Two GitHub',
            'github', 'connected', 'tenant-two', 'env://GITHUB_APP', '${ownerTwoId}'
          );

        insert into public.github_installations (
          id, organization_id, connection_id, external_installation_id, app_id,
          app_slug, account_id, account_login, account_type, target_type,
          repository_selection, status, installed_at, created_by
        ) values
          (
            '${installationOneId}', '${organizationOneId}', '${connectionOneId}',
            900001, 700001, 'factory-app', 800001, 'tenant-one', 'Organization',
            'Organization', 'selected', 'active', now(), '${ownerOneId}'
          ),
          (
            '${installationTwoId}', '${organizationTwoId}', '${connectionTwoId}',
            900002, 700001, 'factory-app', 800002, 'tenant-two', 'Organization',
            'Organization', 'selected', 'active', now(), '${ownerTwoId}'
          );

        insert into public.github_repositories (
          id, organization_id, installation_id, external_repository_id, owner_login,
          name, full_name, default_branch, html_url, private, visibility,
          selected, github_updated_at
        ) values
          (
            '${boundRepositoryId}', '${organizationOneId}', '${installationOneId}',
            600001, 'tenant-one', 'legacy', 'tenant-one/legacy', 'main',
            'https://github.com/tenant-one/legacy', true, 'private', true, now()
          ),
          (
            '${ambiguousRepositoryOneId}', '${organizationOneId}', '${installationOneId}',
            600002, 'tenant-one', 'Ambiguous', 'tenant-one/Ambiguous', 'main',
            'https://github.com/tenant-one/Ambiguous', true, 'private', true, now()
          ),
          (
            '${ambiguousRepositoryTwoId}', '${organizationOneId}', '${installationOneId}',
            600003, 'tenant-one', 'ambiguous', 'tenant-one/ambiguous', 'main',
            'https://github.com/tenant-one/ambiguous', true, 'private', true, now()
          ),
          (
            '${connectableRepositoryId}', '${organizationOneId}', '${installationOneId}',
            600004, 'tenant-one', 'connectable', 'tenant-one/connectable', 'main',
            'https://github.com/tenant-one/connectable', true, 'private', true, now()
          ),
          (
            '${otherTenantRepositoryId}', '${organizationTwoId}', '${installationTwoId}',
            600005, 'tenant-two', 'repository', 'tenant-two/repository', 'main',
            'https://github.com/tenant-two/repository', true, 'private', true, now()
          );

        insert into public.projects (
          id, organization_id, name, status, github_repository, default_branch, created_by
        ) values
          (
            '${legacyProjectId}', '${organizationOneId}', 'Legacy Project', 'active',
            'tenant-one/legacy', 'main', '${ownerOneId}'
          ),
          (
            '${ambiguousProjectId}', '${organizationOneId}', 'Ambiguous Project', 'active',
            'tenant-one/ambiguous', 'main', '${ownerOneId}'
          );

        insert into public.project_connections (
          id, organization_id, project_id, connection_id, is_primary, created_by
        ) values
          (
            '${legacyLinkId}', '${organizationOneId}', '${legacyProjectId}',
            '${connectionOneId}', true, '${ownerOneId}'
          ),
          (
            '${ambiguousLinkId}', '${organizationOneId}', '${ambiguousProjectId}',
            '${connectionOneId}', true, '${ownerOneId}'
          );
      `);

      await db.exec(await source(bindingMigration));
      for (const migrationFile of migrationsAfterBinding) {
        await db.exec(await source(migrationFile));
      }

      const backfilledLinks = await db.query<{
        github_repository_id: string | null;
        id: string;
      }>(`
        select id, github_repository_id
        from public.project_connections
        where id in ('${legacyLinkId}', '${ambiguousLinkId}')
        order by id
      `);
      expect(backfilledLinks.rows).toEqual([
        { github_repository_id: boundRepositoryId, id: legacyLinkId },
        { github_repository_id: null, id: ambiguousLinkId },
      ]);

      const rls = await db.query<{
        relforcerowsecurity: boolean;
        relname: string;
        relrowsecurity: boolean;
      }>(`
        select class.relname, class.relrowsecurity, class.relforcerowsecurity
        from pg_catalog.pg_class class
        join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'public'
          and class.relname in (
            'github_change_requests', 'github_repositories',
            'project_connections', 'projects'
          )
        order by class.relname
      `);
      expect(rls.rows).toHaveLength(4);
      expect(rls.rows.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);

      const privileges = await db.query<{
        anon_connect: boolean;
        anon_sync: boolean;
        anon_validate: boolean;
        authenticated_connect: boolean;
        authenticated_sync: boolean;
        authenticated_validate: boolean;
        public_connect: boolean;
        public_sync: boolean;
        public_validate: boolean;
        service_connect: boolean;
        service_sync: boolean;
        service_validate: boolean;
      }>(`
        select
          has_function_privilege(
            'public',
            'public.connect_github_project(uuid,uuid,bigint,text,text,text)',
            'EXECUTE'
          ) as public_connect,
          has_function_privilege(
            'authenticated',
            'public.connect_github_project(uuid,uuid,bigint,text,text,text)',
            'EXECUTE'
          ) as authenticated_connect,
          has_function_privilege(
            'anon',
            'public.connect_github_project(uuid,uuid,bigint,text,text,text)',
            'EXECUTE'
          ) as anon_connect,
          has_function_privilege(
            'service_role',
            'public.connect_github_project(uuid,uuid,bigint,text,text,text)',
            'EXECUTE'
          ) as service_connect,
          has_function_privilege(
            'public',
            'public.validate_github_change_repository_binding()',
            'EXECUTE'
          ) as public_validate,
          has_function_privilege(
            'anon',
            'public.validate_github_change_repository_binding()',
            'EXECUTE'
          ) as anon_validate,
          has_function_privilege(
            'authenticated',
            'public.validate_github_change_repository_binding()',
            'EXECUTE'
          ) as authenticated_validate,
          has_function_privilege(
            'service_role',
            'public.validate_github_change_repository_binding()',
            'EXECUTE'
          ) as service_validate,
          has_function_privilege(
            'public',
            'public.sync_linked_project_repository_metadata()',
            'EXECUTE'
          ) as public_sync,
          has_function_privilege(
            'anon',
            'public.sync_linked_project_repository_metadata()',
            'EXECUTE'
          ) as anon_sync,
          has_function_privilege(
            'authenticated',
            'public.sync_linked_project_repository_metadata()',
            'EXECUTE'
          ) as authenticated_sync,
          has_function_privilege(
            'service_role',
            'public.sync_linked_project_repository_metadata()',
            'EXECUTE'
          ) as service_sync
      `);
      expect(privileges.rows[0]).toEqual({
        anon_connect: false,
        anon_sync: false,
        anon_validate: false,
        authenticated_connect: true,
        authenticated_sync: false,
        authenticated_validate: false,
        public_connect: false,
        public_sync: false,
        public_validate: false,
        service_connect: false,
        service_sync: false,
        service_validate: false,
      });

      const triggerRows = await db.query<{ tgname: string }>(`
        select trigger.tgname
        from pg_catalog.pg_trigger trigger
        join pg_catalog.pg_class class on class.oid = trigger.tgrelid
        join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
        where not trigger.tgisinternal
          and namespace.nspname = 'public'
          and trigger.tgname in (
            'github_change_requests_validate_repository_binding',
            'github_repositories_sync_linked_project_metadata'
          )
        order by trigger.tgname
      `);
      expect(triggerRows.rows).toEqual([
        { tgname: "github_change_requests_validate_repository_binding" },
        { tgname: "github_repositories_sync_linked_project_metadata" },
      ]);

      await assumeAuthenticated(db, ownerOneId);
      const connectionAttempts = await Promise.allSettled([
        db.query<{
          connection_id: string;
          project_id: string;
        }>(
          "select project_id, connection_id from public.connect_github_project($1,$2,$3,$4,$5,$6)",
          [
            organizationOneId,
            connectionOneId,
            600004,
            "Connected concurrently A",
            "Repository binding race test",
            "main",
          ],
        ),
        db.query<{
          connection_id: string;
          project_id: string;
        }>(
          "select project_id, connection_id from public.connect_github_project($1,$2,$3,$4,$5,$6)",
          [
            organizationOneId,
            connectionOneId,
            600004,
            "Connected concurrently B",
            "Repository binding race test",
            "main",
          ],
        ),
      ]);
      const successfulConnections = connectionAttempts.filter((attempt) => attempt.status === "fulfilled");
      const rejectedConnections = connectionAttempts.filter((attempt) => attempt.status === "rejected");
      expect(successfulConnections).toHaveLength(1);
      expect(rejectedConnections).toHaveLength(1);
      expect(rejectedConnections[0]!.reason).toMatchObject({
        code: "23505",
        message: "GitHub repository is already linked to a non-archived project",
      });
      const connectedProject = successfulConnections[0]!.value;
      const connectedProjectId = connectedProject.rows[0]!.project_id;
      await resetRole(db);

      const connectedLink = await db.query<{
        github_repository_id: string;
      }>(`
        select github_repository_id
        from public.project_connections
        where project_id = '${connectedProjectId}'
          and connection_id = '${connectionOneId}'
      `);
      expect(connectedLink.rows).toEqual([{ github_repository_id: connectableRepositoryId }]);

      await db.query(
        "update public.projects set status = 'archived' where id = $1",
        [connectedProjectId],
      );
      await assumeAuthenticated(db, ownerOneId);
      const relinkedProject = await db.query<{ project_id: string }>(
        "select project_id from public.connect_github_project($1,$2,$3,$4,$5,$6)",
        [
          organizationOneId,
          connectionOneId,
          600004,
          "Relink after archive",
          "Archived projects release their repository identity",
          "main",
        ],
      );
      await resetRole(db);
      const repositoryLinks = await db.query<{ status: string }>(`
        select project.status::text as status
        from public.project_connections link
        join public.projects project on project.id = link.project_id
        where link.organization_id = '${organizationOneId}'
          and link.github_repository_id = '${connectableRepositoryId}'
        order by project.status
      `);
      expect(relinkedProject.rows).toHaveLength(1);
      expect(repositoryLinks.rows).toEqual([{ status: "active" }, { status: "archived" }]);

      await assumeAuthenticated(db, ownerOneId);
      await expect(
        db.query(
          "select * from public.connect_github_project($1,$2,$3,$4,$5,$6)",
          [
            organizationTwoId,
            connectionTwoId,
            600005,
            "Cross tenant project",
            null,
            "main",
          ],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await resetRole(db);

      await db.exec(`
        update public.github_repositories
        set name = 'renamed',
            full_name = 'tenant-one/renamed',
            default_branch = 'trunk'
        where id = '${boundRepositoryId}'
      `);

      const renamedProject = await db.query<{
        default_branch: string;
        github_repository: string;
        github_repository_id: string;
      }>(`
        select project.github_repository, project.default_branch, link.github_repository_id
        from public.projects project
        join public.project_connections link on link.project_id = project.id
        where project.id = '${legacyProjectId}'
      `);
      expect(renamedProject.rows).toEqual([
        {
          default_branch: "trunk",
          github_repository: "tenant-one/renamed",
          github_repository_id: boundRepositoryId,
        },
      ]);

      const ambiguousProject = await db.query<{
        default_branch: string;
        github_repository: string;
      }>(`
        select github_repository, default_branch
        from public.projects
        where id = '${ambiguousProjectId}'
      `);
      expect(ambiguousProject.rows).toEqual([
        { default_branch: "main", github_repository: "tenant-one/ambiguous" },
      ]);

      await db.exec(`
        insert into public.github_repositories (
          id, organization_id, installation_id, external_repository_id, owner_login,
          name, full_name, default_branch, html_url, private, visibility,
          selected, github_updated_at
        ) values (
          '${sameNameDecoyRepositoryId}', '${organizationOneId}', '${installationOneId}',
          600006, 'tenant-one', 'legacy', 'tenant-one/legacy', 'trunk',
          'https://github.com/tenant-one/legacy', true, 'private', true, now()
        );

        -- Simulate stale/tampered display metadata. Before the binding trigger,
        -- the reservation function's name match would accept this replacement.
        update public.projects
        set github_repository = 'tenant-one/legacy'
        where id = '${legacyProjectId}';
      `);

      await assumeAuthenticated(db, ownerOneId);
      await expect(
        db.query(
          "select * from public.reserve_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            organizationOneId,
            legacyProjectId,
            connectionOneId,
            sameNameDecoyRepositoryId,
            "same-name-decoy-001",
            "70000000-0000-4000-8000-000000000001",
            "a".repeat(64),
            "README.md",
            "b".repeat(40),
            "trunk",
            "Reject same-name replacement",
            "Reject same-name replacement",
          ],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: "GitHub change request repository is not bound to the project connection",
      });

      await expect(
        db.query(
          "update public.project_connections set github_repository_id = $1 where id = $2",
          [sameNameDecoyRepositoryId, legacyLinkId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await resetRole(db);

      await expect(
        db.query(
          `insert into public.github_change_requests (
            organization_id, project_id, connection_id, repository_id,
            idempotency_key, execution_nonce, content_sha256, path,
            expected_blob_sha, base_branch, title, commit_message, created_by
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            organizationOneId,
            legacyProjectId,
            connectionOneId,
            sameNameDecoyRepositoryId,
            "direct-mismatch-001",
            "70000000-0000-4000-8000-000000000002",
            "c".repeat(64),
            "README.md",
            "d".repeat(40),
            "trunk",
            "Reject mismatched repository",
            "Reject mismatched repository",
            ownerOneId,
          ],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: "GitHub change request repository is not bound to the project connection",
      });

      await db.exec(`
        update public.github_repositories
        set default_branch = 'stable'
        where id = '${boundRepositoryId}'
      `);

      await assumeAuthenticated(db, ownerOneId);
      const validReservation = await db.query<{ repository_id: string }>(
        "select repository_id from public.reserve_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          organizationOneId,
          legacyProjectId,
          connectionOneId,
          boundRepositoryId,
          "stable-binding-001",
          "70000000-0000-4000-8000-000000000003",
          "e".repeat(64),
          "README.md",
          "f".repeat(40),
          "stable",
          "Use stable repository binding",
          "Use stable repository binding",
        ],
      );
      expect(validReservation.rows).toEqual([{ repository_id: boundRepositoryId }]);
      await resetRole(db);

      const finalProject = await db.query<{
        default_branch: string;
        github_repository: string;
        github_repository_id: string;
      }>(`
        select project.github_repository, project.default_branch, link.github_repository_id
        from public.projects project
        join public.project_connections link on link.project_id = project.id
        where project.id = '${legacyProjectId}'
      `);
      expect(finalProject.rows).toEqual([
        {
          default_branch: "stable",
          github_repository: "tenant-one/renamed",
          github_repository_id: boundRepositoryId,
        },
      ]);
    } finally {
      await db.close();
    }
  }, 60_000);
});
