// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-000000000101";
const organizationId = "10000000-0000-4000-8000-000000000001";
const connectionId = "20000000-0000-4000-8000-000000000001";
const installationId = "30000000-0000-4000-8000-000000000001";
const repositoryId = "40000000-0000-4000-8000-000000000001";
const boundProjectId = "50000000-0000-4000-8000-000000000001";
const nameOnlyProjectId = "50000000-0000-4000-8000-000000000002";

async function createDatabase() {
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
    create role service_role nologin;
  `);
  return db;
}

async function applyFullMigrationChain(db: PGlite) {
  const migrationFiles = (await readdir(migrationsRoot))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  expect(migrationFiles.at(-1)).toBe(
    "20260830000500_services_crm_foundation.sql",
  );
  for (const file of migrationFiles) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
}

async function seedBindings(db: PGlite) {
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}');
    select set_config('request.jwt.claim.sub', '${ownerId}', false);
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Activity Factory', 'activity-factory', '${ownerId}');
    insert into public.connections (
      id, organization_id, name, provider, status, external_account_label,
      secret_reference, created_by
    ) values (
      '${connectionId}', '${organizationId}', 'Activity GitHub', 'github',
      'connected', 'activity-factory', 'env://GITHUB_APP', '${ownerId}'
    );
    insert into public.github_installations (
      id, organization_id, connection_id, external_installation_id, app_id,
      app_slug, account_id, account_login, account_type, target_type,
      repository_selection, status, installed_at, created_by
    ) values (
      '${installationId}', '${organizationId}', '${connectionId}', 900001,
      700001, 'factory-app', 800001, 'activity-factory', 'Organization',
      'Organization', 'selected', 'active', '2026-08-01T00:00:00Z', '${ownerId}'
    );
    insert into public.github_repositories (
      id, organization_id, installation_id, external_repository_id,
      owner_login, name, full_name, default_branch, html_url, private,
      visibility, selected, github_updated_at
    ) values (
      '${repositoryId}', '${organizationId}', '${installationId}', 600001,
      'activity-factory', 'repository', 'activity-factory/repository', 'main',
      'https://github.com/activity-factory/repository', true, 'private', true,
      '2026-08-01T00:00:00Z'
    );
    insert into public.projects (
      id, organization_id, name, status, github_repository, default_branch, created_by
    ) values
      (
        '${boundProjectId}', '${organizationId}', 'Stably Bound', 'active',
        'activity-factory/stale-display-name', 'main', '${ownerId}'
      ),
      (
        '${nameOnlyProjectId}', '${organizationId}', 'Mutable Name Only', 'active',
        'activity-factory/repository', 'main', '${ownerId}'
      );
    insert into public.project_connections (
      organization_id, project_id, connection_id, github_repository_id,
      is_primary, created_by
    ) values
      (
        '${organizationId}', '${boundProjectId}', '${connectionId}',
        '${repositoryId}', true, '${ownerId}'
      ),
      (
        '${organizationId}', '${nameOnlyProjectId}', '${connectionId}',
        null, true, '${ownerId}'
      );
  `);
}

describe("persisted GitHub webhook activity details", () => {
  it("applies the full chain and records only allowlisted evidence on exact repository bindings", async () => {
    const db = await createDatabase();
    try {
      await applyFullMigrationChain(db);
      await seedBindings(db);

      const deliveries = [
        {
          action: "opened",
          event: "pull_request",
          payload: {
            arbitrary_blob: "must-not-reach-activity",
            pull_request: { draft: true, id: 710001, number: 42, state: "open" },
            repository: { full_name: "activity-factory/repository" },
            sender: { id: 810001, login: "octocat" },
          },
        },
        {
          action: "completed",
          event: "check_run",
          payload: {
            arbitrary_blob: "must-not-reach-activity",
            check_run: { conclusion: "success", id: 710002, status: "completed" },
            repository: { full_name: "activity-factory/repository" },
            sender: { id: 810001, login: "octocat" },
          },
        },
        {
          action: null,
          event: "status",
          payload: {
            arbitrary_blob: "must-not-reach-activity",
            commit_status: { sha: "a".repeat(40), state: "success" },
            repository: { full_name: "activity-factory/repository" },
            sender: { id: 810001, login: "octocat" },
          },
        },
        {
          action: "completed",
          event: "workflow_run",
          payload: {
            arbitrary_blob: "must-not-reach-activity",
            repository: { full_name: "activity-factory/repository" },
            sender: { id: 810001, login: "octocat" },
            workflow_run: { conclusion: "failure", id: 710003, status: "completed" },
          },
        },
      ];

      const deliveryIds: string[] = [];
      for (const [index, delivery] of deliveries.entries()) {
        const inserted = await db.query<{ id: string }>(`
          insert into public.github_webhook_deliveries (
            organization_id, connection_id, installation_id,
            external_delivery_id, external_installation_id,
            external_repository_id, event_name, action, payload_sha256,
            payload, status
          ) values (
            '${organizationId}', '${connectionId}', '${installationId}',
            $1, 900001, 600001, $2, $3, repeat('a', 64), $4::jsonb, 'accepted'
          ) returning id
        `, [
          `activity-delivery-${String(index + 1).padStart(3, "0")}`,
          delivery.event,
          delivery.action,
          JSON.stringify(delivery.payload),
        ]);
        deliveryIds.push(inserted.rows[0]!.id);
        await db.exec("set role service_role");
        try {
          await db.query("select public.process_github_webhook_delivery($1)", [inserted.rows[0]!.id]);
          await db.query("select public.process_github_webhook_delivery($1)", [inserted.rows[0]!.id]);
        } finally {
          await db.exec("reset role");
        }
      }

      const events = await db.query<{
        actor_user_id: string | null;
        entity_id: string;
        metadata: Record<string, unknown>;
        metadata_has_sensitive_data: boolean;
        project_id: string;
      }>(`
        select
          project_id,
          actor_user_id,
          entity_id,
          metadata,
          public.jsonb_has_sensitive_keys(metadata) as metadata_has_sensitive_data
        from public.activity_events
        where entity_type = 'github_webhook_delivery'
          and entity_id = any($1::uuid[])
        order by occurred_at, id
      `, [deliveryIds]);

      expect(events.rows).toHaveLength(4);
      expect(events.rows.every((event) => event.project_id === boundProjectId)).toBe(true);
      expect(events.rows.every((event) => event.actor_user_id === null)).toBe(true);
      expect(events.rows.every((event) => !event.metadata_has_sensitive_data)).toBe(true);
      expect(events.rows.map((event) => event.metadata)).toEqual([
        expect.objectContaining({
          action: "opened",
          draft: true,
          event: "pull_request",
          external_resource_id: 710001,
          github_actor: { id: 810001, login: "octocat" },
          github_repository_id: repositoryId,
          repository_id: 600001,
          resource_number: 42,
          resource_type: "pull_request",
          source: "github",
          state_transition: "processed",
          status: "open",
        }),
        expect.objectContaining({
          action: "completed",
          conclusion: "success",
          event: "check_run",
          external_resource_id: 710002,
          resource_type: "check_run",
          status: "completed",
        }),
        expect.objectContaining({
          commit_sha: "a".repeat(40),
          event: "status",
          external_resource_id: "a".repeat(40),
          resource_type: "commit",
          status: "success",
        }),
        expect.objectContaining({
          action: "completed",
          conclusion: "failure",
          event: "workflow_run",
          external_resource_id: 710003,
          resource_type: "workflow_run",
          status: "completed",
        }),
      ]);
      expect(JSON.stringify(events.rows)).not.toMatch(/arbitrary_blob|must-not-reach-activity/);

      const privileges = await db.query<{
        enrich_authenticated: boolean;
        enrich_service: boolean;
        process_service: boolean;
        record_authenticated: boolean;
        record_service: boolean;
      }>(`
        select
          has_function_privilege(
            'authenticated', 'public.enrich_github_webhook_activity_details()', 'EXECUTE'
          ) as enrich_authenticated,
          has_function_privilege(
            'service_role', 'public.enrich_github_webhook_activity_details()', 'EXECUTE'
          ) as enrich_service,
          has_function_privilege(
            'authenticated', 'public.record_stably_bound_github_project_activity()', 'EXECUTE'
          ) as record_authenticated,
          has_function_privilege(
            'service_role', 'public.record_stably_bound_github_project_activity()', 'EXECUTE'
          ) as record_service,
          has_function_privilege(
            'service_role', 'public.process_github_webhook_delivery(uuid)', 'EXECUTE'
          ) as process_service
      `);
      expect(privileges.rows[0]).toEqual({
        enrich_authenticated: false,
        enrich_service: false,
        process_service: true,
        record_authenticated: false,
        record_service: false,
      });

      await expect(db.query(
        "update public.activity_events set description = 'mutated' where entity_id = $1",
        [deliveryIds[0]],
      )).rejects.toMatchObject({ code: "55000" });
      await expect(db.query(
        "delete from public.activity_events where entity_id = $1",
        [deliveryIds[0]],
      )).rejects.toMatchObject({ code: "55000" });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("keeps repository ordering and terminal deletion semantics under the activity triggers", async () => {
    const db = await createDatabase();
    try {
      await applyFullMigrationChain(db);
      await seedBindings(db);

      let sequence = 0;
      const processRepository = async (
        action: string,
        updatedAt: string,
        repository: Record<string, unknown>,
      ) => {
        sequence += 1;
        const inserted = await db.query<{ id: string }>(`
          insert into public.github_webhook_deliveries (
            organization_id, connection_id, installation_id,
            external_delivery_id, external_installation_id,
            external_repository_id, event_name, action, payload_sha256,
            payload, status, received_at
          ) values (
            '${organizationId}', '${connectionId}', '${installationId}',
            $1, 900001, 600001, 'repository', $2, repeat('b', 64),
            $3::jsonb, 'accepted', ($4::timestamptz + interval '10 minutes')
          ) returning id
        `, [
          `activity-repository-${String(sequence).padStart(3, "0")}`,
          action,
          JSON.stringify({
            arbitrary_blob: "must-not-reach-activity",
            repository: { updated_at: updatedAt, ...repository },
            sender: { id: 810001, login: "octocat" },
          }),
          updatedAt,
        ]);
        await db.exec("set role service_role");
        try {
          await db.query("select public.process_github_webhook_delivery($1)", [inserted.rows[0]!.id]);
        } finally {
          await db.exec("reset role");
        }
        return inserted.rows[0]!.id;
      };

      const renamed = {
        archived: false,
        default_branch: "trunk",
        disabled: false,
        full_name: "activity-factory/renamed",
        name: "renamed",
        owner_login: "activity-factory",
        visibility: "private",
      };
      const appliedId = await processRepository("renamed", "2026-08-12T12:02:00Z", renamed);
      const staleId = await processRepository("renamed", "2026-08-12T12:01:00Z", {
        ...renamed,
        full_name: "activity-factory/stale",
        name: "stale",
      });
      const deletedId = await processRepository("deleted", "2026-08-12T12:03:00Z", renamed);
      const terminalId = await processRepository("renamed", "2026-08-12T12:04:00Z", {
        ...renamed,
        default_branch: "unsafe",
      });
      const restoredId = await processRepository("restored", "2026-08-12T12:05:00Z", {
        ...renamed,
        default_branch: "stable",
      });

      const state = await db.query<{
        default_branch: string;
        disabled: boolean;
        full_name: string;
        project_branch: string;
        project_repository: string;
        provider_deleted_at: string | null;
        selected: boolean;
      }>(`
        select
          repository.full_name,
          repository.default_branch,
          repository.disabled,
          repository.selected,
          repository.provider_deleted_at::text,
          project.github_repository as project_repository,
          project.default_branch as project_branch
        from public.github_repositories repository
        join public.projects project on project.id = '${boundProjectId}'
        where repository.id = '${repositoryId}'
      `);
      expect(state.rows[0]).toEqual({
        default_branch: "stable",
        disabled: false,
        full_name: "activity-factory/renamed",
        project_branch: "stable",
        project_repository: "activity-factory/renamed",
        provider_deleted_at: null,
        selected: false,
      });

      const transitionRows = await db.query<{
        entity_id: string;
        metadata: Record<string, unknown>;
      }>(`
        select entity_id, metadata
        from public.activity_events
        where entity_type = 'github_webhook_delivery'
          and entity_id = any($1::uuid[])
      `, [[appliedId, staleId, deletedId, terminalId, restoredId]]);
      const transitions = new Map(transitionRows.rows.map((row) => [
        row.entity_id,
        row.metadata,
      ]));
      expect(transitions.size).toBe(5);
      expect(transitions.get(appliedId)).toMatchObject({
        action: "renamed",
        external_resource_id: 600001,
        github_actor: { id: 810001, login: "octocat" },
        github_repository_id: repositoryId,
        repository_id: 600001,
        resource_type: "repository",
        source: "github",
        state_transition: "applied",
      });
      expect(transitions.get(staleId)).toMatchObject({
        action: "renamed",
        state_transition: "ignored_out_of_order",
      });
      expect(transitions.get(deletedId)).toMatchObject({
        action: "deleted",
        state_transition: "terminal_deleted",
      });
      expect(transitions.get(terminalId)).toMatchObject({
        action: "renamed",
        state_transition: "ignored_terminal_deleted",
      });
      expect(transitions.get(restoredId)).toMatchObject({
        action: "restored",
        state_transition: "restored_unselected",
      });
      expect(JSON.stringify(transitionRows.rows)).not.toMatch(
        /arbitrary_blob|must-not-reach-activity/,
      );
    } finally {
      await db.close();
    }
  }, 60_000);
});
