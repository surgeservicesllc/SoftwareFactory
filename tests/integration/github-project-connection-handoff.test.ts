// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260813000100_provider_execution_layer.sql";

const ownerId = "00000000-0000-4000-8000-000000000101";
const adminId = "00000000-0000-4000-8000-000000000102";
const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const duplicateProjectId = "20000000-0000-4000-8000-000000000002";
const linkId = "30000000-0000-4000-8000-000000000001";
const duplicateLinkId = "30000000-0000-4000-8000-000000000002";
const oldConnectionId = "40000000-0000-4000-8000-000000000001";
const newConnectionId = "40000000-0000-4000-8000-000000000002";
const wrongAccountConnectionId = "40000000-0000-4000-8000-000000000003";
const oldInstallationId = "50000000-0000-4000-8000-000000000001";
const newInstallationId = "50000000-0000-4000-8000-000000000002";
const wrongAccountInstallationId = "50000000-0000-4000-8000-000000000003";
const oldRepositoryId = "60000000-0000-4000-8000-000000000001";
const newRepositoryId = "60000000-0000-4000-8000-000000000002";
const wrongAccountRepositoryId = "60000000-0000-4000-8000-000000000003";
const completedChangeId = "70000000-0000-4000-8000-000000000001";
const pendingChangeId = "70000000-0000-4000-8000-000000000002";
const externalRepositoryId = 99887766;
const oldExternalInstallationId = 153445938;
const newExternalInstallationId = 153499999;
const wrongAccountExternalInstallationId = 153499998;

async function applyMigrations(db: PGlite) {
  const files = (await readdir(migrationsRoot))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  expect(files.at(-1)).toBe(latestMigration);
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
}

async function assumeAuthenticated(db: PGlite, userId: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function handoff(
  db: PGlite,
  fromConnectionId: string,
  fromInstallationId: number,
  toConnectionId: string,
  toInstallationId: number,
) {
  const approval = await db.query<{ approval_id: string }>(
    "select public.approve_github_project_connection_handoff($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as approval_id",
    [
      organizationId,
      projectId,
      fromConnectionId,
      fromInstallationId,
      toConnectionId,
      toInstallationId,
      externalRepositoryId,
      "HANDOFF GITHUB PROJECT",
      "Replace the GitHub App with its verified candidate.",
      "Reverse to the prior live installation and verify repository reads.",
    ],
  );
  return db.query<{
    connection_id: string;
    default_branch: string;
    github_repository: string;
    github_repository_id: string;
    previous_connection_id: string;
    previous_github_repository_id: string;
    project_id: string;
  }>(
    "select * from public.handoff_github_project_connection($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      organizationId,
      projectId,
      fromConnectionId,
      fromInstallationId,
      toConnectionId,
      toInstallationId,
      externalRepositoryId,
      approval.rows[0]!.approval_id,
    ],
  );
}

describe("GitHub replacement installation project handoff", () => {
  it("preserves project/history, fails closed, audits, and reverses while both installations are active", async () => {
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
      await applyMigrations(db);

      await db.exec(`
        insert into auth.users (id) values ('${ownerId}'), ('${adminId}');
        insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'SoftwareFactory', 'softwarefactory-handoff', '${ownerId}');
        insert into public.organization_members (
          organization_id, user_id, role, created_by
        ) values (
          '${organizationId}', '${adminId}', 'admin', '${ownerId}'
        );

        insert into public.connections (
          id, organization_id, name, provider, status, external_account_label,
          secret_reference, created_by
        ) values
          (
            '${oldConnectionId}', '${organizationId}', 'Original GitHub App',
            'github', 'connected', 'surgeservicesllc', 'env://GITHUB_APP', '${ownerId}'
          ),
          (
            '${newConnectionId}', '${organizationId}', 'Replacement GitHub App',
            'github', 'connected', 'surgeservicesllc', 'env://GITHUB_APP', '${ownerId}'
          ),
          (
            '${wrongAccountConnectionId}', '${organizationId}', 'Wrong Account App',
            'github', 'connected', 'someone-else', 'env://GITHUB_APP', '${ownerId}'
          );

        insert into public.github_installations (
          id, organization_id, connection_id, external_installation_id, app_id,
          app_slug, account_id, account_login, account_type, target_type,
          repository_selection, status, installed_at, created_by
        ) values
          (
            '${oldInstallationId}', '${organizationId}', '${oldConnectionId}',
            ${oldExternalInstallationId}, 4573846, 'surge-softwarefactory', 839271,
            'surgeservicesllc', 'Organization', 'Organization', 'selected', 'active',
            now(), '${ownerId}'
          ),
          (
            '${newInstallationId}', '${organizationId}', '${newConnectionId}',
            ${newExternalInstallationId}, 4574999, 'surge-softwarefactory-replacement', 839271,
            'surgeservicesllc', 'Organization', 'Organization', 'selected', 'active',
            now(), '${ownerId}'
          ),
          (
            '${wrongAccountInstallationId}', '${organizationId}', '${wrongAccountConnectionId}',
            ${wrongAccountExternalInstallationId}, 4574998, 'unrelated-app', 839272,
            'someone-else', 'Organization', 'Organization', 'selected', 'active',
            now(), '${ownerId}'
          );

        insert into public.github_repositories (
          id, organization_id, installation_id, external_repository_id,
          owner_login, name, full_name, default_branch, html_url, private,
          visibility, selected, github_updated_at
        ) values
          (
            '${oldRepositoryId}', '${organizationId}', '${oldInstallationId}',
            ${externalRepositoryId}, 'surgeservicesllc', 'SoftwareFactory',
            'surgeservicesllc/SoftwareFactory', 'main',
            'https://github.com/surgeservicesllc/SoftwareFactory', true, 'private', true, now()
          ),
          (
            '${newRepositoryId}', '${organizationId}', '${newInstallationId}',
            ${externalRepositoryId}, 'surgeservicesllc', 'SoftwareFactory',
            'surgeservicesllc/SoftwareFactory', 'trunk',
            'https://github.com/surgeservicesllc/SoftwareFactory', true, 'private', true, now()
          ),
          (
            '${wrongAccountRepositoryId}', '${organizationId}', '${wrongAccountInstallationId}',
            ${externalRepositoryId}, 'someone-else', 'SoftwareFactory',
            'someone-else/SoftwareFactory', 'main',
            'https://github.com/someone-else/SoftwareFactory', true, 'private', true, now()
          );

        insert into public.projects (
          id, organization_id, name, status, github_repository, default_branch, created_by
        ) values (
          '${projectId}', '${organizationId}', 'SoftwareFactory', 'active',
          'surgeservicesllc/SoftwareFactory', 'main', '${ownerId}'
        );
        insert into public.project_connections (
          id, organization_id, project_id, connection_id, github_repository_id,
          is_primary, created_by
        ) values (
          '${linkId}', '${organizationId}', '${projectId}', '${oldConnectionId}',
          '${oldRepositoryId}', true, '${ownerId}'
        );

        insert into public.github_change_requests (
          id, organization_id, project_id, connection_id, repository_id,
          idempotency_key, execution_nonce, content_sha256, path,
          expected_blob_sha, base_branch, head_branch, title, commit_message,
          status, commit_sha, commit_url, external_pull_request_id,
          pull_request_number, pull_request_url, created_by, completed_at
        ) values (
          '${completedChangeId}', '${organizationId}', '${projectId}',
          '${oldConnectionId}', '${oldRepositoryId}', 'completed-before-handoff',
          '80000000-0000-4000-8000-000000000001', repeat('a', 64), 'README.md',
          repeat('b', 40), 'main', 'softwarefactory/completed-before-handoff',
          'Preserved historical change', 'Preserved historical change', 'completed',
          repeat('c', 40), 'https://github.com/surgeservicesllc/SoftwareFactory/commit/abc',
          991001, 91, 'https://github.com/surgeservicesllc/SoftwareFactory/pull/91',
          '${ownerId}', now()
        );
      `);

      const privileges = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        public_execute: boolean;
        service_execute: boolean;
      }>(`
        select
          has_function_privilege(
            'public',
            'public.handoff_github_project_connection(uuid,uuid,uuid,bigint,uuid,bigint,bigint,uuid)',
            'EXECUTE'
          ) as public_execute,
          has_function_privilege(
            'anon',
            'public.handoff_github_project_connection(uuid,uuid,uuid,bigint,uuid,bigint,bigint,uuid)',
            'EXECUTE'
          ) as anon_execute,
          has_function_privilege(
            'authenticated',
            'public.handoff_github_project_connection(uuid,uuid,uuid,bigint,uuid,bigint,bigint,uuid)',
            'EXECUTE'
          ) as authenticated_execute,
          has_function_privilege(
            'service_role',
            'public.handoff_github_project_connection(uuid,uuid,uuid,bigint,uuid,bigint,bigint,uuid)',
            'EXECUTE'
          ) as service_execute
      `);
      expect(privileges.rows).toEqual([{
        anon_execute: false,
        authenticated_execute: true,
        public_execute: false,
        service_execute: false,
      }]);

      await assumeAuthenticated(db, ownerId);
      await expect(db.query(
        "select * from public.connect_github_project($1,$2,$3,$4,$5,$6)",
        [
          organizationId,
          newConnectionId,
          externalRepositoryId,
          "Duplicate candidate project",
          null,
          "trunk",
        ],
      )).rejects.toMatchObject({
        code: "23505",
        message: "GitHub repository is already linked to a non-archived project",
      });
      await resetRole(db);

      await assumeAuthenticated(db, null);
      await expect(handoff(
        db,
        oldConnectionId,
        oldExternalInstallationId,
        newConnectionId,
        newExternalInstallationId,
      )).rejects.toMatchObject({
        code: "42501",
        message: "an active organization owner must authorize the GitHub installation handoff",
      });

      await assumeAuthenticated(db, adminId);
      await expect(handoff(
        db,
        oldConnectionId,
        oldExternalInstallationId,
        newConnectionId,
        newExternalInstallationId,
      )).rejects.toMatchObject({
        code: "42501",
        message: "an active organization owner must authorize the GitHub installation handoff",
      });

      await assumeAuthenticated(db, ownerId);
      await expect(handoff(
        db,
        oldConnectionId,
        oldExternalInstallationId,
        wrongAccountConnectionId,
        wrongAccountExternalInstallationId,
      )).rejects.toMatchObject({
        code: "P0002",
        message: "exact GitHub handoff target was not found",
      });
      await resetRole(db);

      await assumeAuthenticated(db, ownerId);
      await expect(handoff(
        db,
        oldConnectionId,
        oldExternalInstallationId,
        newConnectionId,
        newExternalInstallationId,
      )).rejects.toMatchObject({
        code: "55000",
        message: "target GitHub installation must process a signed webhook before first handoff",
      });
      await resetRole(db);
      await db.exec(`
        insert into public.github_webhook_deliveries (
          id, organization_id, connection_id, installation_id,
          external_delivery_id, external_installation_id, external_repository_id,
          event_name, action, payload_sha256, metadata, status, processed_at
        ) values (
          '65000000-0000-4000-8000-000000000001', '${organizationId}',
          '${newConnectionId}', '${newInstallationId}',
          'candidate-signed-00000001', ${newExternalInstallationId},
          ${externalRepositoryId}, 'repository', 'edited', repeat('9', 64),
          '{"app_id":4574999}'::jsonb, 'processed', now()
        );
      `);

      await db.query(
        "update public.github_repositories set selected = false where id = $1",
        [newRepositoryId],
      );
      await assumeAuthenticated(db, ownerId);
      await expect(handoff(
        db,
        oldConnectionId,
        oldExternalInstallationId,
        newConnectionId,
        newExternalInstallationId,
      )).rejects.toMatchObject({
        code: "55000",
        message: "source and target GitHub repositories must be selected and enabled for handoff",
      });
      await resetRole(db);
      await db.query(
        "update public.github_repositories set selected = true where id = $1",
        [newRepositoryId],
      );

      await db.exec(`
        insert into public.projects (
          id, organization_id, name, status, github_repository, default_branch, created_by
        ) values (
          '${duplicateProjectId}', '${organizationId}', 'Conflicting project', 'active',
          'surgeservicesllc/conflicting-display-name', 'trunk', '${ownerId}'
        );
        insert into public.project_connections (
          id, organization_id, project_id, connection_id, github_repository_id,
          is_primary, created_by
        ) values (
          '${duplicateLinkId}', '${organizationId}', '${duplicateProjectId}',
          '${newConnectionId}', '${newRepositoryId}', true, '${ownerId}'
        );
      `);
      await assumeAuthenticated(db, ownerId);
      await expect(handoff(
        db,
        oldConnectionId,
        oldExternalInstallationId,
        newConnectionId,
        newExternalInstallationId,
      )).rejects.toMatchObject({
        code: "23505",
        message: "target GitHub repository is already linked to a non-archived project",
      });
      await resetRole(db);
      await db.query(
        "update public.projects set status = 'archived' where id = $1",
        [duplicateProjectId],
      );

      await db.exec(`
        insert into public.github_change_requests (
          id, organization_id, project_id, connection_id, repository_id,
          idempotency_key, execution_nonce, content_sha256, path,
          expected_blob_sha, base_branch, title, commit_message, created_by
        ) values (
          '${pendingChangeId}', '${organizationId}', '${projectId}',
          '${oldConnectionId}', '${oldRepositoryId}', 'pending-before-handoff',
          '80000000-0000-4000-8000-000000000002', repeat('d', 64), 'README.md',
          repeat('e', 40), 'main', 'Pending historical change',
          'Pending historical change', '${ownerId}'
        );
      `);
      await assumeAuthenticated(db, ownerId);
      await expect(handoff(
        db,
        oldConnectionId,
        oldExternalInstallationId,
        newConnectionId,
        newExternalInstallationId,
      )).rejects.toMatchObject({
        code: "55000",
        message: "project has a pending GitHub change request; finish or fail it before handoff",
      });
      await resetRole(db);
      await db.query(
        "update public.github_change_requests set status = 'failed', error_code = 'handoff_test' where id = $1",
        [pendingChangeId],
      );

      await assumeAuthenticated(db, ownerId);
      const forward = await handoff(
        db,
        oldConnectionId,
        oldExternalInstallationId,
        newConnectionId,
        newExternalInstallationId,
      );
      expect(forward.rows).toEqual([{
        connection_id: newConnectionId,
        default_branch: "trunk",
        github_repository: "surgeservicesllc/SoftwareFactory",
        github_repository_id: newRepositoryId,
        previous_connection_id: oldConnectionId,
        previous_github_repository_id: oldRepositoryId,
        project_id: projectId,
      }]);
      await resetRole(db);

      const boundProject = await db.query<{
        connection_id: string;
        default_branch: string;
        github_repository: string;
        github_repository_id: string;
        link_id: string;
        project_id: string;
      }>(`
        select
          project.id as project_id,
          project.github_repository,
          project.default_branch,
          link.id as link_id,
          link.connection_id,
          link.github_repository_id
        from public.projects project
        join public.project_connections link
          on link.project_id = project.id
         and link.organization_id = project.organization_id
        where project.id = '${projectId}'
      `);
      expect(boundProject.rows).toEqual([{
        connection_id: newConnectionId,
        default_branch: "trunk",
        github_repository: "surgeservicesllc/SoftwareFactory",
        github_repository_id: newRepositoryId,
        link_id: linkId,
        project_id: projectId,
      }]);

      const preservedHistory = await db.query<{
        connection_id: string;
        project_id: string;
        repository_id: string;
        status: string;
      }>(`
        select project_id, connection_id, repository_id, status
        from public.github_change_requests
        where id = '${completedChangeId}'
      `);
      expect(preservedHistory.rows).toEqual([{
        connection_id: oldConnectionId,
        project_id: projectId,
        repository_id: oldRepositoryId,
        status: "completed",
      }]);

      await assumeAuthenticated(db, ownerId);
      await expect(db.query(
        "select * from public.reserve_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          organizationId,
          projectId,
          oldConnectionId,
          oldRepositoryId,
          "old-binding-after-handoff",
          "80000000-0000-4000-8000-000000000003",
          "f".repeat(64),
          "README.md",
          "1".repeat(40),
          "main",
          "Reject old binding after handoff",
          "Reject old binding after handoff",
        ],
      )).rejects.toMatchObject({
        code: "23514",
        message: "GitHub change request target is not an active linked repository",
      });

      const newReservation = await db.query<{ connection_id: string; repository_id: string }>(
        "select connection_id, repository_id from public.reserve_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          organizationId,
          projectId,
          newConnectionId,
          newRepositoryId,
          "new-binding-after-handoff",
          "80000000-0000-4000-8000-000000000004",
          "2".repeat(64),
          "README.md",
          "3".repeat(40),
          "trunk",
          "Accept new binding after handoff",
          "Accept new binding after handoff",
        ],
      );
      expect(newReservation.rows).toEqual([{
        connection_id: newConnectionId,
        repository_id: newRepositoryId,
      }]);
      await resetRole(db);
      await db.query(
        "update public.github_change_requests set status = 'failed', error_code = 'handoff_test' where idempotency_key = 'new-binding-after-handoff'",
      );

      const handoffEvents = await db.query<{
        actor_user_id: string;
        id: string;
        metadata: Record<string, unknown>;
      }>(`
        select id, actor_user_id, metadata
        from public.activity_events
        where project_id = '${projectId}'
          and entity_type = 'project_connection_handoff'
        order by occurred_at, id
      `);
      expect(handoffEvents.rows).toHaveLength(1);
      expect(handoffEvents.rows[0]!.actor_user_id).toBe(ownerId);
      expect(handoffEvents.rows[0]!.metadata).toMatchObject({
        connection_id: newConnectionId,
        external_repository_id: externalRepositoryId,
        github_event_type: "github.project_connection_handed_off",
        github_repository_id: newRepositoryId,
        history_preserved: true,
        installation_id: newExternalInstallationId,
        previous_connection_id: oldConnectionId,
        previous_github_repository_id: oldRepositoryId,
        previous_installation_id: oldExternalInstallationId,
        rollback_requires_both_installations_active: true,
        state_transition: "rebound",
      });
      expect(JSON.stringify(handoffEvents.rows[0]!.metadata)).not.toMatch(
        /password|private.?key|secret|token/i,
      );
      await expect(db.query(
        "update public.activity_events set description = 'tampered' where id = $1",
        [handoffEvents.rows[0]!.id],
      )).rejects.toMatchObject({
        code: "55000",
        message: "activity events are append-only",
      });

      await assumeAuthenticated(db, ownerId);
      const reverse = await handoff(
        db,
        newConnectionId,
        newExternalInstallationId,
        oldConnectionId,
        oldExternalInstallationId,
      );
      expect(reverse.rows).toEqual([{
        connection_id: oldConnectionId,
        default_branch: "main",
        github_repository: "surgeservicesllc/SoftwareFactory",
        github_repository_id: oldRepositoryId,
        previous_connection_id: newConnectionId,
        previous_github_repository_id: newRepositoryId,
        project_id: projectId,
      }]);
      await resetRole(db);

      const finalState = await db.query<{
        connection_id: string;
        default_branch: string;
        github_repository_id: string;
        handoff_events: number;
        link_id: string;
      }>(`
        select
          link.id as link_id,
          link.connection_id,
          link.github_repository_id,
          project.default_branch,
          (
            select count(*)::integer
            from public.activity_events event
            where event.project_id = project.id
              and event.entity_type = 'project_connection_handoff'
          ) as handoff_events
        from public.projects project
        join public.project_connections link on link.project_id = project.id
        where project.id = '${projectId}'
      `);
      expect(finalState.rows).toEqual([{
        connection_id: oldConnectionId,
        default_branch: "main",
        github_repository_id: oldRepositoryId,
        handoff_events: 2,
        link_id: linkId,
      }]);
    } finally {
      await db.close();
    }
  }, 90_000);
});
