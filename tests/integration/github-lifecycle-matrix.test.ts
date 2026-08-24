// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

// The complete applied migration history, read from disk. Access loss,
// disconnection, and reconnection are only meaningful against the schema the
// hosted project actually runs, so a stale hand-maintained list is worse than
// no list. The pin below fails deliberately when a new migration lands, so its
// author reviews this matrix.
const newestMigration = "20260824000100_anchored_automatic_gates_decide_themselves.sql";

const ownerAId = "00000000-0000-4000-8000-000000000301";
const memberAId = "00000000-0000-4000-8000-000000000302";
const ownerBId = "00000000-0000-4000-8000-000000000401";
const outsiderId = "00000000-0000-4000-8000-000000000501";

const organizationAId = "10000000-0000-4000-8000-00000000000a";
const organizationBId = "10000000-0000-4000-8000-00000000000b";

const projectPrimaryId = "40000000-0000-4000-8000-00000000000a";
const projectSecondaryId = "40000000-0000-4000-8000-00000000000b";
const projectBId = "40000000-0000-4000-8000-00000000000c";

const connectionPrimaryId = "20000000-0000-4000-8000-00000000000a";
const connectionSecondaryId = "20000000-0000-4000-8000-00000000000b";
const connectionBId = "20000000-0000-4000-8000-00000000000c";

const installationPrimaryId = "30000000-0000-4000-8000-00000000000a";
const installationSecondaryId = "30000000-0000-4000-8000-00000000000b";
const installationBId = "30000000-0000-4000-8000-00000000000c";

const repositoryPrimaryId = "50000000-0000-4000-8000-00000000000a";
const repositorySecondaryId = "50000000-0000-4000-8000-00000000000b";
const repositoryBId = "50000000-0000-4000-8000-00000000000c";

// Two independent GitHub accounts installed by one tenant, plus a second tenant.
const externalInstallationPrimary = 910_001;
const externalInstallationSecondary = 910_002;
const externalInstallationB = 910_003;
const externalRepositoryPrimary = 610_001;
const externalRepositorySecondary = 610_002;
const externalRepositoryB = 610_003;

const appId = 710_001;

type InstallationRow = {
  deleted_at: string | null;
  external_installation_id: string;
  status: string;
  suspended_at: string | null;
};

type RepositoryRow = {
  archived: boolean;
  disabled: boolean;
  full_name: string;
  selected: boolean;
};

type ConnectionRow = { error_message: string | null; status: string };

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

describe("Phase 1B GitHub access-loss, disconnect, and reconnect matrix", () => {
  let db: PGlite;
  let deliverySequence = 0;

  async function assumeRole(role: string, userId: string | null = null) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    await db.exec(`set role ${role}`);
  }

  async function asService() {
    await assumeRole("service_role");
  }

  /**
   * Ground-truth observation. Migration 026 revoked service-role access to
   * every table outside the four GitHub ingress tables, so assertions read the
   * database as the owner rather than borrowing an application role they are
   * not entitled to.
   */
  async function asObserver() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }

  /** Applies one verified provider delivery exactly as the webhook route does. */
  async function deliver(options: {
    action?: string | null;
    connectionId: string;
    event: string;
    externalInstallationId: number;
    externalRepositoryId?: number | null;
    installationId: string;
    organizationId: string;
    payload?: Record<string, unknown>;
  }) {
    await asService();
    deliverySequence += 1;
    const externalDeliveryId = `matrix-delivery-${String(deliverySequence).padStart(6, "0")}`;
    const inserted = await db.query<{ id: string }>(
      `insert into public.github_webhook_deliveries (
         organization_id, connection_id, installation_id, external_delivery_id,
         external_installation_id, external_repository_id, event_name, action,
         payload_sha256, payload, status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, md5($4) || md5($4), $9::jsonb, 'accepted')
       returning id`,
      [
        options.organizationId,
        options.connectionId,
        options.installationId,
        externalDeliveryId,
        options.externalInstallationId,
        options.externalRepositoryId ?? null,
        options.event,
        options.action ?? null,
        JSON.stringify(options.payload ?? {}),
      ],
    );
    const deliveryId = inserted.rows[0]!.id;
    await db.query("select public.process_github_webhook_delivery($1::uuid)", [deliveryId]);
    return { deliveryId, externalDeliveryId };
  }

  async function readInstallation(installationId: string) {
    await asObserver();
    const result = await db.query<InstallationRow>(
      `select status, suspended_at, deleted_at, external_installation_id::text
       from public.github_installations where id = $1`,
      [installationId],
    );
    return result.rows[0]!;
  }

  async function readRepository(repositoryId: string) {
    await asObserver();
    const result = await db.query<RepositoryRow>(
      "select full_name, selected, archived, disabled from public.github_repositories where id = $1",
      [repositoryId],
    );
    return result.rows[0]!;
  }

  async function readConnection(connectionId: string) {
    await asObserver();
    const result = await db.query<ConnectionRow>(
      "select status::text as status, error_message from public.connections where id = $1",
      [connectionId],
    );
    return result.rows[0]!;
  }

  /**
   * Attempts a real draft-PR reservation as an authenticated manager. This is
   * the trusted write boundary, so it is the only honest test of whether an
   * access-loss state actually prevents new GitHub operations.
   */
  async function attemptReservation(options: {
    actorUserId: string;
    connectionId: string;
    key: string;
    organizationId: string;
    projectId: string;
    repositoryId: string;
  }) {
    await assumeRole("authenticated", options.actorUserId);
    try {
      const result = await db.query<{ id: string }>(
        `select id from public.reserve_github_change_request(
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, gen_random_uuid(),
           repeat('a', 64), 'README.md', repeat('b', 40), 'main',
           'Matrix draft change', 'Matrix draft change'
         )`,
        [
          options.organizationId,
          options.projectId,
          options.connectionId,
          options.repositoryId,
          options.key,
        ],
      );
      return { allowed: true as const, id: result.rows[0]?.id ?? null };
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      return {
        allowed: false as const,
        code: failure.code ?? null,
        message: failure.message ?? "",
      };
    } finally {
      await db.exec("reset role");
    }
  }

  async function countRows(sql: string, parameters: unknown[] = []) {
    await asObserver();
    const result = await db.query<{ total: string }>(sql, parameters);
    return Number(result.rows[0]!.total);
  }

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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(newestMigration);
    for (const migrationFile of migrationFiles) {
      await db.exec(await source(`supabase/migrations/${migrationFile}`));
    }

    await db.exec(`
      insert into auth.users (id) values
        ('${ownerAId}'), ('${memberAId}'), ('${ownerBId}'), ('${outsiderId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationAId}', 'Matrix Tenant A', 'matrix-tenant-a', '${ownerAId}'),
        ('${organizationBId}', 'Matrix Tenant B', 'matrix-tenant-b', '${ownerBId}');

      insert into public.organization_members (organization_id, user_id, role, created_by) values
        ('${organizationAId}', '${memberAId}', 'member', '${ownerAId}');

      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values
        ('${projectPrimaryId}', '${organizationAId}', 'Matrix Primary', 'active', 'tenant-a/primary', 'main', '${ownerAId}'),
        ('${projectSecondaryId}', '${organizationAId}', 'Matrix Secondary', 'active', 'tenant-a-lab/secondary', 'main', '${ownerAId}'),
        ('${projectBId}', '${organizationBId}', 'Matrix Tenant B', 'active', 'tenant-b/repository', 'main', '${ownerBId}');

      insert into public.connections (
        id, organization_id, name, provider, status, external_account_label,
        secret_reference, created_by
      ) values
        ('${connectionPrimaryId}', '${organizationAId}', 'GitHub · tenant-a', 'github', 'connected', 'tenant-a', 'env://GITHUB_APP', '${ownerAId}'),
        ('${connectionSecondaryId}', '${organizationAId}', 'GitHub · tenant-a-lab', 'github', 'connected', 'tenant-a-lab', 'env://GITHUB_APP', '${ownerAId}'),
        ('${connectionBId}', '${organizationBId}', 'GitHub · tenant-b', 'github', 'connected', 'tenant-b', 'env://GITHUB_APP', '${ownerBId}');

      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values
        ('${installationPrimaryId}', '${organizationAId}', '${connectionPrimaryId}', ${externalInstallationPrimary}, ${appId}, 'matrix-app', 820001, 'tenant-a', 'Organization', 'Organization', 'selected', 'active', now(), '${ownerAId}'),
        ('${installationSecondaryId}', '${organizationAId}', '${connectionSecondaryId}', ${externalInstallationSecondary}, ${appId}, 'matrix-app', 820002, 'tenant-a-lab', 'Organization', 'Organization', 'selected', 'active', now(), '${ownerAId}'),
        ('${installationBId}', '${organizationBId}', '${connectionBId}', ${externalInstallationB}, ${appId}, 'matrix-app', 820003, 'tenant-b', 'Organization', 'Organization', 'selected', 'active', now(), '${ownerBId}');

      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id, owner_login,
        name, full_name, default_branch, html_url, private, visibility,
        selected, github_updated_at
      ) values
        ('${repositoryPrimaryId}', '${organizationAId}', '${installationPrimaryId}', ${externalRepositoryPrimary}, 'tenant-a', 'primary', 'tenant-a/primary', 'main', 'https://github.com/tenant-a/primary', true, 'private', true, timestamptz '2026-08-01 00:00:00+00'),
        ('${repositorySecondaryId}', '${organizationAId}', '${installationSecondaryId}', ${externalRepositorySecondary}, 'tenant-a-lab', 'secondary', 'tenant-a-lab/secondary', 'main', 'https://github.com/tenant-a-lab/secondary', true, 'private', true, timestamptz '2026-08-01 00:00:00+00'),
        ('${repositoryBId}', '${organizationBId}', '${installationBId}', ${externalRepositoryB}, 'tenant-b', 'repository', 'tenant-b/repository', 'main', 'https://github.com/tenant-b/repository', true, 'private', true, timestamptz '2026-08-01 00:00:00+00');

      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id, is_primary, created_by
      ) values
        ('${organizationAId}', '${projectPrimaryId}', '${connectionPrimaryId}', '${repositoryPrimaryId}', true, '${ownerAId}'),
        ('${organizationAId}', '${projectSecondaryId}', '${connectionSecondaryId}', '${repositorySecondaryId}', true, '${ownerAId}'),
        ('${organizationBId}', '${projectBId}', '${connectionBId}', '${repositoryBId}', true, '${ownerBId}');
    `);
    await db.exec("reset role");
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it("keeps two independent installations in one tenant separated end to end", async () => {
    const primary = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-primary-baseline",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    const secondary = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionSecondaryId,
      key: "matrix-secondary-baseline",
      organizationId: organizationAId,
      projectId: projectSecondaryId,
      repositoryId: repositorySecondaryId,
    });

    expect(primary.allowed).toBe(true);
    expect(secondary.allowed).toBe(true);

    // A repository belonging to the other installation is never reachable
    // through this connection, even for the same owner in the same tenant.
    const crossed = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-cross-installation",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositorySecondaryId,
    });
    expect(crossed.allowed).toBe(false);
    expect(crossed.code).toBe("23514");

    const swappedProject = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionSecondaryId,
      key: "matrix-swapped-project",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositorySecondaryId,
    });
    expect(swappedProject.allowed).toBe(false);
    expect(swappedProject.code).toBe("23514");
  });

  it("refuses to rebind a provider installation id to a second organization", async () => {
    await asService();
    await expect(
      db.query(
        `select * from public.sync_github_installation(
           $1::uuid, $2::uuid, $3::bigint, $4::bigint, 'matrix-app', 820001, 'tenant-a',
           'Organization', null, 'Organization', 'selected', '{}'::jsonb,
           array[]::text[], now(), null, '[]'::jsonb, null
         )`,
        [ownerBId, organizationBId, externalInstallationPrimary, appId],
      ),
    ).rejects.toMatchObject({ code: "42501" });

    // Tenant A still owns the installation after the rejected attempt.
    const installation = await readInstallation(installationPrimaryId);
    expect(installation.status).toBe("active");
    const ownership = await countRows(
      `select count(*)::text as total from public.github_installations
       where external_installation_id = $1 and organization_id = $2`,
      [externalInstallationPrimary, organizationAId],
    );
    expect(ownership).toBe(1);
  });

  it("denies a cross-tenant and anonymous read of GitHub installation metadata", async () => {
    await assumeRole("authenticated", ownerAId);
    const ownerVisible = await db.query<{ total: string }>(
      "select count(*)::text as total from public.github_installations",
    );
    expect(Number(ownerVisible.rows[0]!.total)).toBe(2);

    await assumeRole("authenticated", ownerBId);
    const tenantBVisible = await db.query<{ id: string }>(
      "select id from public.github_installations",
    );
    expect(tenantBVisible.rows.map((row) => row.id)).toEqual([installationBId]);

    await assumeRole("authenticated", outsiderId);
    const outsiderVisible = await db.query<{ total: string }>(
      "select count(*)::text as total from public.github_installations",
    );
    expect(Number(outsiderVisible.rows[0]!.total)).toBe(0);

    await assumeRole("anon");
    await expect(
      db.query("select id from public.github_installations"),
    ).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role");
  });

  it("stops new writes when a repository is removed from the installation", async () => {
    await deliver({
      action: "removed",
      connectionId: connectionPrimaryId,
      event: "installation_repositories",
      externalInstallationId: externalInstallationPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: { removed_repository_ids: [externalRepositoryPrimary] },
    });

    expect((await readRepository(repositoryPrimaryId)).selected).toBe(false);
    const removed = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-access-removed",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(removed.allowed).toBe(false);
    expect(removed.code).toBe("23514");

    // The other installation in the same tenant is unaffected by the loss.
    expect((await readRepository(repositorySecondaryId)).selected).toBe(true);

    await deliver({
      action: "added",
      connectionId: connectionPrimaryId,
      event: "installation_repositories",
      externalInstallationId: externalInstallationPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: { added_repository_ids: [externalRepositoryPrimary] },
    });
    expect((await readRepository(repositoryPrimaryId)).selected).toBe(true);
  });

  it("stops new writes when a repository is archived and again when it is deleted", async () => {
    await deliver({
      action: "archived",
      connectionId: connectionPrimaryId,
      event: "repository",
      externalInstallationId: externalInstallationPrimary,
      externalRepositoryId: externalRepositoryPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: {
        repository: {
          archived: true,
          full_name: "tenant-a/primary",
          updated_at: "2026-08-02T00:00:00Z",
        },
      },
    });

    expect((await readRepository(repositoryPrimaryId)).archived).toBe(true);
    const archived = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-archived",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(archived.allowed).toBe(false);
    expect(archived.code).toBe("23514");

    await deliver({
      action: "unarchived",
      connectionId: connectionPrimaryId,
      event: "repository",
      externalInstallationId: externalInstallationPrimary,
      externalRepositoryId: externalRepositoryPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: {
        repository: {
          archived: false,
          full_name: "tenant-a/primary",
          updated_at: "2026-08-03T00:00:00Z",
        },
      },
    });
    expect((await readRepository(repositoryPrimaryId)).archived).toBe(false);

    await deliver({
      action: "deleted",
      connectionId: connectionPrimaryId,
      event: "repository",
      externalInstallationId: externalInstallationPrimary,
      externalRepositoryId: externalRepositoryPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: {
        repository: {
          full_name: "tenant-a/primary",
          updated_at: "2026-08-04T00:00:00Z",
        },
      },
    });

    const deletedRepository = await readRepository(repositoryPrimaryId);
    expect(deletedRepository.disabled).toBe(true);
    expect(deletedRepository.selected).toBe(false);
    const deleted = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-repository-deleted",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(deleted.allowed).toBe(false);

    // A stale metadata event must never resurrect a deleted repository.
    await deliver({
      action: "edited",
      connectionId: connectionPrimaryId,
      event: "repository",
      externalInstallationId: externalInstallationPrimary,
      externalRepositoryId: externalRepositoryPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: {
        repository: {
          disabled: false,
          full_name: "tenant-a/primary",
          updated_at: "2026-08-05T00:00:00Z",
        },
      },
    });
    expect((await readRepository(repositoryPrimaryId)).disabled).toBe(true);
  });

  it("suspends and restores an installation truthfully without losing history", async () => {
    // Restore the primary repository before testing installation-level loss, so
    // the failure under test is unambiguous.
    await asObserver();
    await db.query(
      `update public.github_repositories
       set disabled = false, selected = true, provider_deleted_at = null
       where id = $1`,
      [repositoryPrimaryId],
    );
    await db.exec("reset role");

    const historyBefore = await countRows(
      "select count(*)::text as total from public.activity_events where organization_id = $1",
      [organizationAId],
    );

    await deliver({
      action: "suspend",
      connectionId: connectionPrimaryId,
      event: "installation",
      externalInstallationId: externalInstallationPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: { installation_updated_at: "2026-08-06T00:00:00Z" },
    });

    const suspended = await readInstallation(installationPrimaryId);
    expect(suspended.status).toBe("suspended");
    expect(suspended.suspended_at).not.toBeNull();
    const suspendedConnection = await readConnection(connectionPrimaryId);
    expect(suspendedConnection.status).toBe("error");
    expect(suspendedConnection.error_message).toBe("GitHub installation is suspended.");

    const duringSuspension = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-suspended",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(duringSuspension.allowed).toBe(false);
    expect(duringSuspension.code).toBe("23514");

    // A delayed suspend that predates the applied event must not reorder state.
    await deliver({
      action: "unsuspend",
      connectionId: connectionPrimaryId,
      event: "installation",
      externalInstallationId: externalInstallationPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: { installation_updated_at: "2026-08-05T00:00:00Z" },
    });
    expect((await readInstallation(installationPrimaryId)).status).toBe("suspended");

    await deliver({
      action: "unsuspend",
      connectionId: connectionPrimaryId,
      event: "installation",
      externalInstallationId: externalInstallationPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: { installation_updated_at: "2026-08-07T00:00:00Z" },
    });

    const restored = await readInstallation(installationPrimaryId);
    expect(restored.status).toBe("active");
    expect(restored.suspended_at).toBeNull();
    expect((await readConnection(connectionPrimaryId)).status).toBe("connected");

    const afterRestore = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-unsuspended",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(afterRestore.allowed).toBe(true);

    const historyAfter = await countRows(
      "select count(*)::text as total from public.activity_events where organization_id = $1",
      [organizationAId],
    );
    expect(historyAfter).toBeGreaterThan(historyBefore);
  });

  it("preserves history and blocks new work when an owner disconnects", async () => {
    const changesBefore = await countRows(
      "select count(*)::text as total from public.github_change_requests where organization_id = $1",
      [organizationAId],
    );
    const activityBefore = await countRows(
      "select count(*)::text as total from public.activity_events where organization_id = $1",
      [organizationAId],
    );

    // An ordinary member may not disconnect, and a stale installation id is
    // refused so a concurrent reinstall cannot be disconnected by mistake.
    await asService();
    await expect(
      db.query("select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)", [
        memberAId,
        connectionPrimaryId,
        externalInstallationPrimary,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)", [
        ownerAId,
        connectionPrimaryId,
        externalInstallationSecondary,
      ]),
    ).rejects.toMatchObject({ code: "40001" });

    await db.query("select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)", [
      ownerAId,
      connectionPrimaryId,
      externalInstallationPrimary,
    ]);
    await db.exec("reset role");

    expect((await readInstallation(installationPrimaryId)).status).toBe("disconnected");
    expect((await readConnection(connectionPrimaryId)).status).toBe("disabled");
    expect((await readRepository(repositoryPrimaryId)).selected).toBe(false);

    const afterDisconnect = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-disconnected",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(afterDisconnect.allowed).toBe(false);
    expect(afterDisconnect.code).toBe("23514");

    // Historical evidence survives the disconnection.
    expect(
      await countRows(
        "select count(*)::text as total from public.github_change_requests where organization_id = $1",
        [organizationAId],
      ),
    ).toBe(changesBefore);
    expect(
      await countRows(
        "select count(*)::text as total from public.activity_events where organization_id = $1",
        [organizationAId],
      ),
    ).toBeGreaterThan(activityBefore);

    // The second installation keeps working while the first is disconnected.
    const unaffected = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionSecondaryId,
      key: "matrix-secondary-unaffected",
      organizationId: organizationAId,
      projectId: projectSecondaryId,
      repositoryId: repositorySecondaryId,
    });
    expect(unaffected.allowed).toBe(true);
  });

  it("reconnects the same installation without duplicate or corrupt records", async () => {
    const installationsBefore = await countRows(
      "select count(*)::text as total from public.github_installations where organization_id = $1",
      [organizationAId],
    );
    const connectionsBefore = await countRows(
      "select count(*)::text as total from public.connections where organization_id = $1",
      [organizationAId],
    );
    const repositoriesBefore = await countRows(
      "select count(*)::text as total from public.github_repositories where organization_id = $1",
      [organizationAId],
    );
    const changesBefore = await countRows(
      "select count(*)::text as total from public.github_change_requests where organization_id = $1",
      [organizationAId],
    );

    await asService();
    const resync = await db.query<{
      connection_id: string;
      installation_id: string;
      repository_count: number;
      was_created: boolean;
    }>(
      `select * from public.sync_github_installation(
         $1::uuid, $2::uuid, $3::bigint, $4::bigint, 'matrix-app', 820001, 'tenant-a',
         'Organization', null, 'Organization', 'selected', '{}'::jsonb,
         array['installation', 'push']::text[], now(), null, $5::jsonb, $6::uuid
       )`,
      [
        ownerAId,
        organizationAId,
        externalInstallationPrimary,
        appId,
        JSON.stringify([
          {
            archived: false,
            default_branch: "main",
            disabled: false,
            full_name: "tenant-a/primary",
            github_updated_at: "2026-08-08T00:00:00Z",
            html_url: "https://github.com/tenant-a/primary",
            id: externalRepositoryPrimary,
            name: "primary",
            owner_login: "tenant-a",
            private: true,
            visibility: "private",
          },
        ]),
        connectionPrimaryId,
      ],
    );
    await db.exec("reset role");

    expect(resync.rows[0]!.was_created).toBe(false);
    expect(resync.rows[0]!.connection_id).toBe(connectionPrimaryId);
    expect(resync.rows[0]!.installation_id).toBe(installationPrimaryId);
    expect(resync.rows[0]!.repository_count).toBe(1);

    expect(
      await countRows(
        "select count(*)::text as total from public.github_installations where organization_id = $1",
        [organizationAId],
      ),
    ).toBe(installationsBefore);
    expect(
      await countRows(
        "select count(*)::text as total from public.connections where organization_id = $1",
        [organizationAId],
      ),
    ).toBe(connectionsBefore);
    expect(
      await countRows(
        "select count(*)::text as total from public.github_repositories where organization_id = $1",
        [organizationAId],
      ),
    ).toBe(repositoriesBefore);
    expect(
      await countRows(
        "select count(*)::text as total from public.github_change_requests where organization_id = $1",
        [organizationAId],
      ),
    ).toBe(changesBefore);

    const reconnected = await readInstallation(installationPrimaryId);
    expect(reconnected.status).toBe("active");
    expect(reconnected.deleted_at).toBeNull();
    expect((await readConnection(connectionPrimaryId)).status).toBe("connected");
    expect((await readRepository(repositoryPrimaryId)).selected).toBe(true);

    const afterReconnect = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-reconnected",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(afterReconnect.allowed).toBe(true);
  });

  it("records a server-discovered revocation and clears the stale suspension reason", async () => {
    // Suspension first, so the discovery has a stale marker to correct. This is
    // the real sequence: GitHub suspends, then the next token request is
    // refused outright.
    await deliver({
      action: "suspend",
      connectionId: connectionPrimaryId,
      event: "installation",
      externalInstallationId: externalInstallationPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: { installation_updated_at: "2026-08-11T00:00:00Z" },
    });
    expect((await readInstallation(installationPrimaryId)).suspended_at).not.toBeNull();

    await asService();
    const marked = await db.query<{ mark_github_connection_lost: boolean }>(
      "select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)",
      [ownerAId, connectionPrimaryId, "installation_revoked"],
    );
    await db.exec("reset role");
    expect(marked.rows[0]!.mark_github_connection_lost).toBe(true);

    const revoked = await readInstallation(installationPrimaryId);
    expect(revoked.status).toBe("error");
    // A retained suspension marker would make every surface report the wrong
    // reason for a loss that was actually a revocation.
    expect(revoked.suspended_at).toBeNull();
    expect(revoked.deleted_at).toBeNull();
    expect((await readRepository(repositoryPrimaryId)).selected).toBe(false);

    const lostConnection = await readConnection(connectionPrimaryId);
    expect(lostConnection.status).toBe("error");
    expect(lostConnection.error_message).toBe("GitHub Connection Lost");

    const afterRevocation = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-revoked",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(afterRevocation.allowed).toBe(false);
    expect(afterRevocation.code).toBe("23514");

    // The discarded suspension survives as evidence rather than as a
    // misleading column value.
    await asObserver();
    const evidence = await db.query<{
      installation_state_retained: boolean;
      previous_installation_status: string;
      previous_suspended_at: string | null;
      reason: string;
    }>(
      `select
         metadata ->> 'reason' as reason,
         metadata ->> 'previous_installation_status' as previous_installation_status,
         metadata ->> 'previous_suspended_at' as previous_suspended_at,
         (metadata ->> 'installation_state_retained')::boolean as installation_state_retained
       from public.activity_events
       where organization_id = $1 and description = 'GitHub connection lost'
       order by occurred_at desc, created_at desc
       limit 1`,
      [organizationAId],
    );
    expect(evidence.rows[0]).toMatchObject({
      installation_state_retained: false,
      previous_installation_status: "suspended",
      reason: "installation_revoked",
    });
    expect(evidence.rows[0]!.previous_suspended_at).not.toBeNull();

    // An ordinary member cannot fabricate a connection loss.
    await asService();
    await expect(
      db.query("select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)", [
        memberAId,
        connectionPrimaryId,
        "insufficient_permission",
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)", [
        ownerAId,
        connectionPrimaryId,
        "rate_limited",
      ]),
    ).rejects.toMatchObject({ code: "22023" });

    // Reconnecting after a revocation restores service through the normal path.
    await db.query(
      `select * from public.sync_github_installation(
         $1::uuid, $2::uuid, $3::bigint, $4::bigint, 'matrix-app', 820001, 'tenant-a',
         'Organization', null, 'Organization', 'selected', '{}'::jsonb,
         array[]::text[], now(), null, $5::jsonb, $6::uuid
       )`,
      [
        ownerAId,
        organizationAId,
        externalInstallationPrimary,
        appId,
        JSON.stringify([
          {
            archived: false,
            default_branch: "main",
            disabled: false,
            full_name: "tenant-a/primary",
            github_updated_at: "2026-08-11T12:00:00Z",
            html_url: "https://github.com/tenant-a/primary",
            id: externalRepositoryPrimary,
            name: "primary",
            owner_login: "tenant-a",
            private: true,
            visibility: "private",
          },
        ]),
        connectionPrimaryId,
      ],
    );
    await db.exec("reset role");

    expect((await readInstallation(installationPrimaryId)).status).toBe("active");
    const recovered = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-revocation-recovered",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(recovered.allowed).toBe(true);
  });

  it("treats provider deletion as terminal for the installation id", async () => {
    await deliver({
      action: "deleted",
      connectionId: connectionPrimaryId,
      event: "installation",
      externalInstallationId: externalInstallationPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: { installation_updated_at: "2026-08-09T00:00:00Z" },
    });

    const removed = await readInstallation(installationPrimaryId);
    expect(removed.status).toBe("deleted");
    expect(removed.deleted_at).not.toBeNull();
    const lostConnection = await readConnection(connectionPrimaryId);
    expect(lostConnection.status).toBe("error");
    expect(lostConnection.error_message).toBe("GitHub Connection Lost");

    const afterDeletion = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionPrimaryId,
      key: "matrix-installation-deleted",
      organizationId: organizationAId,
      projectId: projectPrimaryId,
      repositoryId: repositoryPrimaryId,
    });
    expect(afterDeletion.allowed).toBe(false);
    expect(afterDeletion.code).toBe("23514");

    // A delayed unsuspend for the deleted id is recorded, never applied.
    const delayed = await deliver({
      action: "unsuspend",
      connectionId: connectionPrimaryId,
      event: "installation",
      externalInstallationId: externalInstallationPrimary,
      installationId: installationPrimaryId,
      organizationId: organizationAId,
      payload: { installation_updated_at: "2026-08-10T00:00:00Z" },
    });
    expect((await readInstallation(installationPrimaryId)).status).toBe("deleted");
    const delayedTransition = await countRows(
      `select count(*)::text as total from public.github_webhook_deliveries
       where id = $1 and metadata ->> 'state_transition' = 'ignored_terminal_deleted'`,
      [delayed.deliveryId],
    );
    expect(delayedTransition).toBe(1);

    // Re-synchronizing the deleted id is refused with a truthful, client-safe
    // reason instead of quietly reactivating a revoked installation.
    await asService();
    await expect(
      db.query(
        `select * from public.sync_github_installation(
           $1::uuid, $2::uuid, $3::bigint, $4::bigint, 'matrix-app', 820001, 'tenant-a',
           'Organization', null, 'Organization', 'selected', '{}'::jsonb,
           array[]::text[], now(), null, '[]'::jsonb, $5::uuid
         )`,
        [ownerAId, organizationAId, externalInstallationPrimary, appId, connectionPrimaryId],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    // A discovery that arrives after the id is already terminal must record the
    // loss rather than abort. `deleted` already refuses every operation, so the
    // installation row is deliberately left untouched.
    const lateDiscovery = await db.query<{ mark_github_connection_lost: boolean }>(
      "select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)",
      [ownerAId, connectionPrimaryId, "insufficient_permission"],
    );
    expect(lateDiscovery.rows[0]!.mark_github_connection_lost).toBe(true);
    await db.exec("reset role");

    const stillTerminal = await readInstallation(installationPrimaryId);
    expect(stillTerminal.status).toBe("deleted");
    expect(stillTerminal.deleted_at).not.toBeNull();

    await asObserver();
    const lateEvidence = await db.query<{
      installation_state_retained: boolean;
      reason: string;
    }>(
      `select
         metadata ->> 'reason' as reason,
         (metadata ->> 'installation_state_retained')::boolean as installation_state_retained
       from public.activity_events
       where organization_id = $1 and description = 'GitHub connection lost'
       order by occurred_at desc, created_at desc
       limit 1`,
      [organizationAId],
    );
    expect(lateEvidence.rows[0]).toMatchObject({
      installation_state_retained: true,
      reason: "insufficient_permission",
    });
  });

  it("keeps every tenant-A loss event out of tenant B", async () => {
    const tenantBInstallation = await readInstallation(installationBId);
    expect(tenantBInstallation.status).toBe("active");
    expect((await readConnection(connectionBId)).status).toBe("connected");
    expect((await readRepository(repositoryBId)).selected).toBe(true);

    const tenantBWrite = await attemptReservation({
      actorUserId: ownerBId,
      connectionId: connectionBId,
      key: "matrix-tenant-b-unaffected",
      organizationId: organizationBId,
      projectId: projectBId,
      repositoryId: repositoryBId,
    });
    expect(tenantBWrite.allowed).toBe(true);

    // Tenant B never sees tenant A's loss history. Activity is unreachable as a
    // raw table for any authenticated caller, and the safe list RPC is scoped
    // to the caller's own membership rather than the requested organization.
    await assumeRole("authenticated", ownerBId);
    await expect(
      db.query("select id from public.activity_events where organization_id = $1", [
        organizationAId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    const foreignActivity = await db.query<{ total: string }>(
      "select count(*)::text as total from public.list_activity($1::uuid, 200)",
      [organizationAId],
    );
    expect(Number(foreignActivity.rows[0]!.total)).toBe(0);
    const ownActivity = await db.query<{ total: string }>(
      "select count(*)::text as total from public.list_activity($1::uuid, 200)",
      [organizationBId],
    );
    expect(Number(ownActivity.rows[0]!.total)).toBeGreaterThan(0);
    await expect(
      db.query(
        "select id from public.github_webhook_deliveries where organization_id = $1",
        [organizationAId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role");

    // Tenant B cannot reach tenant A's repository through its own connection.
    const crossTenant = await attemptReservation({
      actorUserId: ownerBId,
      connectionId: connectionBId,
      key: "matrix-cross-tenant",
      organizationId: organizationBId,
      projectId: projectBId,
      repositoryId: repositorySecondaryId,
    });
    expect(crossTenant.allowed).toBe(false);

    // And an authenticated tenant-A owner cannot act inside tenant B.
    const reverseCrossTenant = await attemptReservation({
      actorUserId: ownerAId,
      connectionId: connectionBId,
      key: "matrix-reverse-cross-tenant",
      organizationId: organizationBId,
      projectId: projectBId,
      repositoryId: repositoryBId,
    });
    expect(reverseCrossTenant.allowed).toBe(false);
    expect(reverseCrossTenant.code).toBe("42501");
  });
});
