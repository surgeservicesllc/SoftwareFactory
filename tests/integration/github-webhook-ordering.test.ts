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
  "20260812001500_recover_draft_pr_completion.sql",
  "20260812001600_guard_github_installation_terminal_state.sql",
  "20260812001700_close_authenticated_control_plane_writes.sql",
  "20260812001800_order_github_repository_events.sql",
];

const ownerId = "00000000-0000-4000-8000-000000000101";
const organizationId = "10000000-0000-4000-8000-000000000001";
const connectionId = "20000000-0000-4000-8000-000000000001";
const installationId = "30000000-0000-4000-8000-000000000001";
const repositoryId = "40000000-0000-4000-8000-000000000001";

async function source(file: string) {
  return readFile(resolve(repositoryRoot, "supabase/migrations", file), "utf8");
}

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

async function applyMigrations(db: PGlite, files = migrationFiles) {
  for (const file of files) await db.exec(await source(file));
}

async function seedInstallation(db: PGlite, deletedAt: string | null = null) {
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}');
    select set_config('request.jwt.claim.sub', '${ownerId}', false);
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Ordering Factory', 'ordering-factory', '${ownerId}');
    insert into public.connections (
      id, organization_id, name, provider, status, external_account_label,
      secret_reference, created_by
    ) values (
      '${connectionId}', '${organizationId}', 'Ordering GitHub', 'github',
      'connected', 'ordering-factory', 'env://GITHUB_APP', '${ownerId}'
    );
    insert into public.github_installations (
      id, organization_id, connection_id, external_installation_id, app_id,
      app_slug, account_id, account_login, account_type, target_type,
      repository_selection, status, deleted_at, installed_at, created_by
    ) values (
      '${installationId}', '${organizationId}', '${connectionId}', 900001,
      700001, 'factory-app', 800001, 'ordering-factory', 'Organization',
      'Organization', 'selected', 'active',
      ${deletedAt ? `'${deletedAt}'::timestamptz` : "null"},
      '2026-08-01T00:00:00Z', '${ownerId}'
    );
    insert into public.github_repositories (
      id, organization_id, installation_id, external_repository_id,
      owner_login, name, full_name, default_branch, html_url, private,
      visibility, selected, github_updated_at
    ) values (
      '${repositoryId}', '${organizationId}', '${installationId}', 600001,
      'ordering-factory', 'repository', 'ordering-factory/repository', 'main',
      'https://github.com/ordering-factory/repository', true, 'private', true,
      '2026-08-01T00:00:00Z'
    );
  `);
}

describe("GitHub webhook installation ordering", () => {
  it("keeps deletion terminal while applying only newer pre-deletion transitions", async () => {
    const db = await createDatabase();
    try {
      await applyMigrations(db);
      await seedInstallation(db);

      let deliverySequence = 0;
      const processDelivery = async (
        action: string,
        providerUpdatedAt: string,
        eventName = "installation",
        payload: Record<string, unknown> = {},
      ) => {
        deliverySequence += 1;
        const externalDeliveryId = `ordering-delivery-${String(deliverySequence).padStart(3, "0")}`;
        const inserted = await db.query<{ id: string }>(`
          insert into public.github_webhook_deliveries (
            organization_id, connection_id, installation_id,
            external_delivery_id, external_installation_id,
            external_repository_id, event_name, action, payload_sha256,
            payload, status, received_at
          ) values (
            '${organizationId}', '${connectionId}', '${installationId}',
            $1, 900001, ${eventName === "installation_repositories" ? "600001" : "null"},
            $2, $3, repeat('a', 64), $4::jsonb, 'accepted',
            ($5::timestamptz + interval '10 minutes')
          ) returning id
        `, [
          externalDeliveryId,
          eventName,
          action,
          JSON.stringify({ installation_updated_at: providerUpdatedAt, ...payload }),
          providerUpdatedAt,
        ]);
        await db.exec("set role service_role");
        try {
          await db.query("select public.process_github_webhook_delivery($1)", [inserted.rows[0]!.id]);
        } finally {
          await db.exec("reset role");
        }
        return inserted.rows[0]!.id;
      };

      await processDelivery("suspend", "2026-08-12T12:00:00Z");
      await processDelivery("unsuspend", "2026-08-12T12:01:00Z");
      const staleSuspendId = await processDelivery("suspend", "2026-08-12T12:01:00Z");

      let state = await db.query<{
        connection_status: string;
        deleted_at: string | null;
        installation_status: string;
        last_provider_event_at: string | null;
        selected: boolean;
      }>(`
        select installation.status as installation_status,
               installation.deleted_at::text,
               installation.last_provider_event_at::text,
               connection.status::text as connection_status,
               repository.selected
        from public.github_installations installation
        join public.connections connection on connection.id = installation.connection_id
        join public.github_repositories repository on repository.installation_id = installation.id
        where installation.id = '${installationId}'
      `);
      expect(state.rows[0]).toMatchObject({
        connection_status: "connected",
        deleted_at: null,
        installation_status: "active",
        selected: true,
      });
      expect(new Date(state.rows[0]!.last_provider_event_at!).toISOString())
        .toBe("2026-08-12T12:01:00.000Z");

      const staleDelivery = await db.query<{ transition: string }>(`
        select metadata ->> 'state_transition' as transition
        from public.github_webhook_deliveries
        where id = '${staleSuspendId}'
      `);
      expect(staleDelivery.rows[0]?.transition).toBe("ignored_out_of_order");

      await processDelivery("deleted", "2026-08-12T12:02:00Z");
      const delayedUnsuspendId = await processDelivery("unsuspend", "2026-08-12T12:01:30Z");
      const newerUnsuspendId = await processDelivery("unsuspend", "2026-08-12T12:03:00Z");
      await processDelivery("created", "2026-08-12T12:04:00Z");
      await processDelivery(
        "added",
        "2026-08-12T12:05:00Z",
        "installation_repositories",
        { added_repository_ids: [600001], removed_repository_ids: [] },
      );

      state = await db.query(`
        select installation.status as installation_status,
               installation.deleted_at::text,
               installation.last_provider_event_at::text,
               connection.status::text as connection_status,
               repository.selected
        from public.github_installations installation
        join public.connections connection on connection.id = installation.connection_id
        join public.github_repositories repository on repository.installation_id = installation.id
        where installation.id = '${installationId}'
      `);
      expect(state.rows[0]).toMatchObject({
        connection_status: "error",
        installation_status: "deleted",
        selected: false,
      });
      expect(new Date(state.rows[0]!.deleted_at!).toISOString())
        .toBe("2026-08-12T12:02:00.000Z");
      expect(new Date(state.rows[0]!.last_provider_event_at!).toISOString())
        .toBe("2026-08-12T12:02:00.000Z");

      const ignoredTerminalDeliveries = await db.query<{ id: string; transition: string }>(`
        select id, metadata ->> 'state_transition' as transition
        from public.github_webhook_deliveries
        where id in ('${delayedUnsuspendId}', '${newerUnsuspendId}')
        order by id
      `);
      expect(ignoredTerminalDeliveries.rows.map((row) => row.transition))
        .toEqual(["ignored_terminal_deleted", "ignored_terminal_deleted"]);

      await expect(db.query(`
        update public.github_installations
        set status = 'active', deleted_at = null
        where id = '${installationId}'
      `)).rejects.toMatchObject({ code: "55000" });

      await db.exec("set role service_role");
      try {
        await expect(db.query(`
          select * from public.sync_github_installation(
            '${ownerId}', '${organizationId}', 900001, 700001, 'factory-app',
            800001, 'ordering-factory', 'Organization', null, 'Organization',
            'selected', '{}'::jsonb, '{}'::text[], '2026-08-01T00:00:00Z',
            null, '[]'::jsonb, '${connectionId}'
          )
        `)).rejects.toMatchObject({ code: "55000" });

        const freshInstallation = await db.query<{ repository_count: number; was_created: boolean }>(`
          select repository_count, was_created
          from public.sync_github_installation(
            '${ownerId}', '${organizationId}', 900002, 700001, 'factory-app',
            800001, 'ordering-factory', 'Organization', null, 'Organization',
            'selected', '{}'::jsonb, '{}'::text[], '2026-08-12T12:06:00Z',
            null, '[]'::jsonb, null
          )
        `);
        expect(freshInstallation.rows[0]).toEqual({ repository_count: 0, was_created: true });
      } finally {
        await db.exec("reset role");
      }

      const terminalStateAfterSync = await db.query<{ status: string; selected: boolean }>(`
        select installation.status, repository.selected
        from public.github_installations installation
        join public.github_repositories repository on repository.installation_id = installation.id
        where installation.id = '${installationId}'
      `);
      expect(terminalStateAfterSync.rows[0]).toEqual({ status: "deleted", selected: false });

      const freshState = await db.query<{ deleted_at: string | null; status: string }>(`
        select status, deleted_at::text
        from public.github_installations
        where external_installation_id = 900002
      `);
      expect(freshState.rows[0]).toEqual({ deleted_at: null, status: "active" });

      const catalog = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        force_count: number;
        rls_count: number;
        service_execute: boolean;
        table_count: number;
      }>(`
        select
          (select count(*)::integer from pg_catalog.pg_class class
            join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
            where namespace.nspname = 'public' and class.relkind = 'r') as table_count,
          (select count(*)::integer from pg_catalog.pg_class class
            join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
            where namespace.nspname = 'public' and class.relkind = 'r' and class.relrowsecurity) as rls_count,
          (select count(*)::integer from pg_catalog.pg_class class
            join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
            where namespace.nspname = 'public' and class.relkind = 'r' and class.relforcerowsecurity) as force_count,
          has_function_privilege('anon', 'public.process_github_webhook_delivery(uuid)', 'EXECUTE') as anon_execute,
          has_function_privilege('authenticated', 'public.process_github_webhook_delivery(uuid)', 'EXECUTE') as authenticated_execute,
          has_function_privilege('service_role', 'public.process_github_webhook_delivery(uuid)', 'EXECUTE') as service_execute
      `);
      expect(catalog.rows[0]).toEqual({
        anon_execute: false,
        authenticated_execute: false,
        force_count: 22,
        rls_count: 22,
        service_execute: true,
        table_count: 22,
      });

      const ignoredEvent = await db.query<{ id: string }>(`
        select id
        from public.activity_events
        where entity_id = '${newerUnsuspendId}'
          and description = 'Ignored GitHub event for deleted installation'
      `);
      expect(ignoredEvent.rows).toHaveLength(1);
      await expect(db.query(
        "update public.activity_events set description = 'mutated' where id = $1",
        [ignoredEvent.rows[0]!.id],
      )).rejects.toMatchObject({ code: "55000" });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("repairs the pre-migration active-plus-deleted-marker state", async () => {
    const db = await createDatabase();
    try {
      await applyMigrations(
        db,
        migrationFiles.slice(0, migrationFiles.indexOf("20260812001600_guard_github_installation_terminal_state.sql")),
      );
      await seedInstallation(db, "2026-08-12T12:02:00Z");

      await db.exec(await source("20260812001600_guard_github_installation_terminal_state.sql"));

      const repaired = await db.query<{
        connection_status: string;
        installation_status: string;
        selected: boolean;
      }>(`
        select connection.status::text as connection_status,
               installation.status as installation_status,
               repository.selected
        from public.github_installations installation
        join public.connections connection on connection.id = installation.connection_id
        join public.github_repositories repository on repository.installation_id = installation.id
        where installation.id = '${installationId}'
      `);
      expect(repaired.rows[0]).toEqual({
        connection_status: "error",
        installation_status: "deleted",
        selected: false,
      });

      const repairAudit = await db.query<{ actor_user_id: string | null }>(`
        select actor_user_id
        from public.activity_events
        where entity_id = '${installationId}'
          and description = 'Reconciled terminal GitHub installation deletion state'
      `);
      expect(repairAudit.rows).toEqual([{ actor_user_id: null }]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("orders repository rename/delete events and requires explicit newer restore", async () => {
    const db = await createDatabase();
    try {
      await applyMigrations(db);
      await seedInstallation(db);
      await db.exec(`
        insert into public.projects (
          id, organization_id, name, status, github_repository, default_branch, created_by
        ) values (
          '50000000-0000-4000-8000-000000000001', '${organizationId}',
          'Ordering Project', 'active', 'ordering-factory/repository', 'main', '${ownerId}'
        );
        insert into public.project_connections (
          organization_id, project_id, connection_id, is_primary, created_by
        ) values (
          '${organizationId}', '50000000-0000-4000-8000-000000000001',
          '${connectionId}', true, '${ownerId}'
        );
      `);

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
          `repository-delivery-${String(sequence).padStart(3, "0")}`,
          action,
          JSON.stringify({ repository: { updated_at: updatedAt, ...repository } }),
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

      const metadata = {
        archived: false,
        default_branch: "trunk",
        disabled: false,
        full_name: "ordering-factory/renamed",
        name: "renamed",
        owner_login: "ordering-factory",
        visibility: "private",
      };
      await processRepository("renamed", "2026-08-12T12:02:00Z", metadata);
      const staleId = await processRepository("renamed", "2026-08-12T12:01:00Z", {
        ...metadata,
        default_branch: "main",
        full_name: "ordering-factory/stale",
        name: "stale",
      });
      await processRepository("deleted", "2026-08-12T12:03:00Z", metadata);
      const delayedRenameId = await processRepository("renamed", "2026-08-12T12:04:00Z", {
        ...metadata,
        default_branch: "unsafe-stale",
      });

      let state = await db.query<{
        default_branch: string;
        disabled: boolean;
        full_name: string;
        project_branch: string;
        project_repository: string;
        provider_deleted_at: string | null;
        selected: boolean;
      }>(`
        select repository.full_name,
               repository.default_branch,
               repository.disabled,
               repository.selected,
               repository.provider_deleted_at::text,
               project.github_repository as project_repository,
               project.default_branch as project_branch
        from public.github_repositories repository
        join public.projects project on project.id = '50000000-0000-4000-8000-000000000001'
        where repository.id = '${repositoryId}'
      `);
      expect(state.rows[0]).toMatchObject({
        default_branch: "trunk",
        disabled: true,
        full_name: "ordering-factory/renamed",
        project_branch: "trunk",
        project_repository: "ordering-factory/renamed",
        selected: false,
      });
      expect(new Date(state.rows[0]!.provider_deleted_at!).toISOString())
        .toBe("2026-08-12T12:03:00.000Z");

      const ignored = await db.query<{ transition: string }>(`
        select metadata ->> 'state_transition' as transition
        from public.github_webhook_deliveries
        where id in ('${staleId}', '${delayedRenameId}')
        order by received_at
      `);
      expect(ignored.rows.map((row) => row.transition)).toEqual([
        "ignored_out_of_order",
        "ignored_terminal_deleted",
      ]);

      await processRepository("restored", "2026-08-12T12:05:00Z", {
        ...metadata,
        default_branch: "stable",
      });
      state = await db.query(`
        select repository.full_name,
               repository.default_branch,
               repository.disabled,
               repository.selected,
               repository.provider_deleted_at::text,
               project.github_repository as project_repository,
               project.default_branch as project_branch
        from public.github_repositories repository
        join public.projects project on project.id = '50000000-0000-4000-8000-000000000001'
        where repository.id = '${repositoryId}'
      `);
      expect(state.rows[0]).toEqual({
        default_branch: "stable",
        disabled: false,
        full_name: "ordering-factory/renamed",
        project_branch: "stable",
        project_repository: "ordering-factory/renamed",
        provider_deleted_at: null,
        selected: false,
      });

      const privileges = await db.query<{
        current_service: boolean;
        previous_service: boolean;
      }>(`
        select
          has_function_privilege('service_role', 'public.process_github_webhook_delivery(uuid)', 'EXECUTE') as current_service,
          has_function_privilege('service_role', 'public.process_github_webhook_delivery_v016(uuid)', 'EXECUTE') as previous_service
      `);
      expect(privileges.rows[0]).toEqual({ current_service: true, previous_service: false });

      const audit = await db.query<{ id: string }>(`
        select id from public.activity_events
        where entity_id = '${delayedRenameId}'
          and description = 'Ignored GitHub event for deleted repository'
      `);
      expect(audit.rows).toHaveLength(1);
      await expect(db.query(
        "update public.activity_events set description = 'mutated' where id = $1",
        [audit.rows[0]!.id],
      )).rejects.toMatchObject({ code: "55000" });
    } finally {
      await db.close();
    }
  }, 60_000);
});
