// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  "20260812001900_allow_service_role_sensitive_json_checks.sql",
] as const;

const targetTables = [
  "github_installations",
  "github_repositories",
  "github_webhook_deliveries",
  "github_change_requests",
] as const;

const ownerOneId = "00000000-0000-4000-8000-000000000101";
const adminOneId = "00000000-0000-4000-8000-000000000102";
const memberOneId = "00000000-0000-4000-8000-000000000103";
const ownerTwoId = "00000000-0000-4000-8000-000000000201";

const organizationOneId = "10000000-0000-4000-8000-000000000001";
const organizationTwoId = "10000000-0000-4000-8000-000000000002";
const projectOneId = "40000000-0000-4000-8000-000000000001";
const projectTwoId = "40000000-0000-4000-8000-000000000002";
const connectionOneId = "20000000-0000-4000-8000-000000000001";
const connectionTwoId = "20000000-0000-4000-8000-000000000002";
const spareConnectionOneId = "20000000-0000-4000-8000-000000000011";
const installationOneId = "30000000-0000-4000-8000-000000000001";
const installationTwoId = "30000000-0000-4000-8000-000000000002";
const repositoryOneId = "50000000-0000-4000-8000-000000000001";
const repositoryTwoId = "50000000-0000-4000-8000-000000000002";
const deliveryOneId = "60000000-0000-4000-8000-000000000001";
const deliveryTwoId = "60000000-0000-4000-8000-000000000002";
const changeOneId = "70000000-0000-4000-8000-000000000001";
const changeTwoId = "70000000-0000-4000-8000-000000000002";

type ApplicationRole =
  | "anon"
  | "authenticated"
  | "authenticated_rls_probe"
  | "service_role";

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function assumeRole(
  db: PGlite,
  role: ApplicationRole,
  userId: string | null = null,
) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [userId ?? ""],
  );
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub', '', false)",
  );
}

function reservationArguments(actorKey: string) {
  return [
    organizationOneId,
    projectOneId,
    connectionOneId,
    repositoryOneId,
    actorKey,
    crypto.randomUUID(),
    "a".repeat(64),
    "README.md",
    "b".repeat(40),
    "main",
    "RLS matrix draft",
    "RLS matrix draft",
  ];
}

const reservationSql = `
  select id, organization_id, created_by, idempotency_key
  from public.reserve_github_change_request(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::uuid,
    $7::text, $8::text, $9::text, $10::text, $11::text, $12::text
  )
`;

describe("Phase 1B GitHub table RLS behavior", () => {
  let db: PGlite;

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
      create role authenticated_rls_probe nologin in role authenticated;
    `);

    for (const migrationFile of migrationFiles) {
      await db.exec(await source(`supabase/migrations/${migrationFile}`));
    }

    await db.exec(`
      insert into auth.users (id) values
        ('${ownerOneId}'),
        ('${adminOneId}'),
        ('${memberOneId}'),
        ('${ownerTwoId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationOneId}', 'RLS Factory One', 'rls-factory-one', '${ownerOneId}'),
        ('${organizationTwoId}', 'RLS Factory Two', 'rls-factory-two', '${ownerTwoId}');

      insert into public.organization_members (
        organization_id, user_id, role, created_by
      ) values
        ('${organizationOneId}', '${adminOneId}', 'admin', '${ownerOneId}'),
        ('${organizationOneId}', '${memberOneId}', 'member', '${ownerOneId}');

      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values
        ('${projectOneId}', '${organizationOneId}', 'Tenant One Project', 'active', 'tenant-one/repository', 'main', '${ownerOneId}'),
        ('${projectTwoId}', '${organizationTwoId}', 'Tenant Two Project', 'active', 'tenant-two/repository', 'main', '${ownerTwoId}');

      insert into public.connections (
        id, organization_id, name, provider, status, external_account_label,
        secret_reference, created_by
      ) values
        ('${connectionOneId}', '${organizationOneId}', 'Tenant One GitHub', 'github', 'connected', 'tenant-one', 'env://GITHUB_APP', '${ownerOneId}'),
        ('${connectionTwoId}', '${organizationTwoId}', 'Tenant Two GitHub', 'github', 'connected', 'tenant-two', 'env://GITHUB_APP', '${ownerTwoId}'),
        ('${spareConnectionOneId}', '${organizationOneId}', 'Tenant One Spare GitHub', 'github', 'connected', 'tenant-one-spare', 'env://GITHUB_APP', '${ownerOneId}');

      insert into public.project_connections (
        organization_id, project_id, connection_id, is_primary, created_by
      ) values
        ('${organizationOneId}', '${projectOneId}', '${connectionOneId}', true, '${ownerOneId}'),
        ('${organizationTwoId}', '${projectTwoId}', '${connectionTwoId}', true, '${ownerTwoId}');

      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values
        ('${installationOneId}', '${organizationOneId}', '${connectionOneId}', 900001, 700001, 'rls-factory-app', 800001, 'tenant-one', 'Organization', 'Organization', 'selected', 'active', now(), '${ownerOneId}'),
        ('${installationTwoId}', '${organizationTwoId}', '${connectionTwoId}', 900002, 700001, 'rls-factory-app', 800002, 'tenant-two', 'Organization', 'Organization', 'selected', 'active', now(), '${ownerTwoId}');

      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id, owner_login,
        name, full_name, default_branch, html_url, private, visibility,
        selected, github_updated_at
      ) values
        ('${repositoryOneId}', '${organizationOneId}', '${installationOneId}', 600001, 'tenant-one', 'repository', 'tenant-one/repository', 'main', 'https://github.com/tenant-one/repository', true, 'private', true, now()),
        ('${repositoryTwoId}', '${organizationTwoId}', '${installationTwoId}', 600002, 'tenant-two', 'repository', 'tenant-two/repository', 'main', 'https://github.com/tenant-two/repository', true, 'private', true, now());

      insert into public.github_webhook_deliveries (
        id, organization_id, connection_id, installation_id, external_delivery_id,
        external_installation_id, external_repository_id, event_name, action,
        payload_sha256, payload, status
      ) values
        ('${deliveryOneId}', '${organizationOneId}', '${connectionOneId}', '${installationOneId}', 'delivery-tenant-one-0001', 900001, 600001, 'repository', 'edited', repeat('a', 64), '{}', 'processed'),
        ('${deliveryTwoId}', '${organizationTwoId}', '${connectionTwoId}', '${installationTwoId}', 'delivery-tenant-two-0002', 900002, 600002, 'repository', 'edited', repeat('b', 64), '{}', 'processed');

      insert into public.github_change_requests (
        id, organization_id, project_id, connection_id, repository_id,
        idempotency_key, execution_nonce, content_sha256, path,
        expected_blob_sha, base_branch, title, commit_message, created_by
      ) values
        ('${changeOneId}', '${organizationOneId}', '${projectOneId}', '${connectionOneId}', '${repositoryOneId}', 'rls-seed-one', gen_random_uuid(), repeat('c', 64), 'README.md', repeat('d', 40), 'main', 'Tenant one change', 'Tenant one change', '${ownerOneId}'),
        ('${changeTwoId}', '${organizationTwoId}', '${projectTwoId}', '${connectionTwoId}', '${repositoryTwoId}', 'rls-seed-two', gen_random_uuid(), repeat('e', 64), 'README.md', repeat('f', 40), 'main', 'Tenant two change', 'Tenant two change', '${ownerTwoId}');
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("keeps RLS and FORCE RLS enabled with a read-only member policy", async () => {
    const relations = await db.query<{
      relforcerowsecurity: boolean;
      relname: string;
      relrowsecurity: boolean;
    }>(`
      select class.relname, class.relrowsecurity, class.relforcerowsecurity
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relname = any(array[${targetTables.map((table) => `'${table}'`).join(", ")}])
      order by class.relname
    `);
    expect(relations.rows).toHaveLength(4);
    expect(
      relations.rows.every(
        (relation) => relation.relrowsecurity && relation.relforcerowsecurity,
      ),
    ).toBe(true);

    const policies = await db.query<{
      cmd: string;
      roles: string;
      tablename: string;
    }>(`
      select tablename, cmd, pg_catalog.array_to_string(roles, ',') as roles
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = any(array[${targetTables.map((table) => `'${table}'`).join(", ")}])
      order by tablename, cmd
    `);
    expect(policies.rows).toEqual([
      { tablename: "github_change_requests", cmd: "SELECT", roles: "authenticated" },
      { tablename: "github_installations", cmd: "SELECT", roles: "authenticated" },
      { tablename: "github_repositories", cmd: "SELECT", roles: "authenticated" },
      { tablename: "github_webhook_deliveries", cmd: "SELECT", roles: "authenticated" },
    ]);

    const privileges = await db.query<{
      can_delete: boolean;
      can_insert: boolean;
      can_select: boolean;
      can_update: boolean;
      relname: string;
      rolname: string;
    }>(`
      select
        role.rolname,
        class.relname,
        pg_catalog.has_table_privilege(role.rolname, class.oid, 'SELECT') as can_select,
        pg_catalog.has_table_privilege(role.rolname, class.oid, 'INSERT') as can_insert,
        pg_catalog.has_table_privilege(role.rolname, class.oid, 'UPDATE') as can_update,
        pg_catalog.has_table_privilege(role.rolname, class.oid, 'DELETE') as can_delete
      from pg_catalog.pg_roles role
      cross join pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where role.rolname in ('anon', 'authenticated', 'service_role')
        and namespace.nspname = 'public'
        and class.relname = any(array[${targetTables.map((table) => `'${table}'`).join(", ")}])
      order by role.rolname, class.relname
    `);

    for (const privilege of privileges.rows) {
      if (privilege.rolname === "anon") {
        expect([
          privilege.can_select,
          privilege.can_insert,
          privilege.can_update,
          privilege.can_delete,
        ]).toEqual([false, false, false, false]);
      } else if (privilege.rolname === "authenticated") {
        expect([
          privilege.can_select,
          privilege.can_insert,
          privilege.can_update,
          privilege.can_delete,
        ]).toEqual([true, false, false, false]);
      } else {
        expect([
          privilege.can_select,
          privilege.can_insert,
          privilege.can_update,
          privilege.can_delete,
        ]).toEqual([true, true, true, false]);
      }
    }
    expect(privileges.rows).toHaveLength(12);

    const rpcPrivileges = await db.query<{
      authenticated_execute: boolean;
      function_name: string;
      service_execute: boolean;
    }>(`
      select * from (values
        (
          'reserve',
          pg_catalog.has_function_privilege('authenticated', 'public.reserve_github_change_request(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text)', 'EXECUTE'),
          pg_catalog.has_function_privilege('service_role', 'public.reserve_github_change_request(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text)', 'EXECUTE')
        ),
        (
          'complete',
          pg_catalog.has_function_privilege('authenticated', 'public.complete_github_change_request(uuid,uuid,text,text,text,bigint,integer,text,text)', 'EXECUTE'),
          pg_catalog.has_function_privilege('service_role', 'public.complete_github_change_request(uuid,uuid,text,text,text,bigint,integer,text,text)', 'EXECUTE')
        ),
        (
          'webhook',
          pg_catalog.has_function_privilege('authenticated', 'public.process_github_webhook_delivery(uuid)', 'EXECUTE'),
          pg_catalog.has_function_privilege('service_role', 'public.process_github_webhook_delivery(uuid)', 'EXECUTE')
        ),
        (
          'repository_grants',
          pg_catalog.has_function_privilege('authenticated', 'public.reconcile_github_repository_grants(uuid,uuid,jsonb)', 'EXECUTE'),
          pg_catalog.has_function_privilege('service_role', 'public.reconcile_github_repository_grants(uuid,uuid,jsonb)', 'EXECUTE')
        )
      ) as matrix(function_name, authenticated_execute, service_execute)
      order by function_name
    `);
    expect(rpcPrivileges.rows).toEqual([
      { function_name: "complete", authenticated_execute: false, service_execute: true },
      { function_name: "repository_grants", authenticated_execute: false, service_execute: true },
      { function_name: "reserve", authenticated_execute: true, service_execute: false },
      { function_name: "webhook", authenticated_execute: false, service_execute: true },
    ]);

    const classifierPrivileges = await db.query<{
      authenticated_wrapper: boolean;
      service_internal: boolean;
      service_text: boolean;
      service_wrapper: boolean;
    }>(`
      select
        pg_catalog.has_function_privilege(
          'authenticated', 'public.jsonb_has_sensitive_keys(jsonb)', 'EXECUTE'
        ) as authenticated_wrapper,
        pg_catalog.has_function_privilege(
          'service_role', 'public.jsonb_has_sensitive_keys(jsonb)', 'EXECUTE'
        ) as service_wrapper,
        pg_catalog.has_function_privilege(
          'service_role', 'public.jsonb_has_sensitive_keys_internal(jsonb,integer)', 'EXECUTE'
        ) as service_internal,
        pg_catalog.has_function_privilege(
          'service_role', 'public.text_has_likely_secret(text)', 'EXECUTE'
        ) as service_text
    `);
    expect(classifierPrivileges.rows[0]).toEqual({
      authenticated_wrapper: true,
      service_internal: false,
      service_text: false,
      service_wrapper: true,
    });
  });

  it("allows every tenant member to read only that tenant's four GitHub rows", async () => {
    for (const userId of [ownerOneId, adminOneId, memberOneId]) {
      await assumeRole(db, "authenticated", userId);
      for (const table of targetTables) {
        const visible = await db.query<{ organization_id: string }>(`
          select organization_id from public.${table} order by organization_id
        `);
        expect(visible.rows).toEqual([{ organization_id: organizationOneId }]);
      }
    }

    await assumeRole(db, "authenticated", ownerTwoId);
    for (const table of targetTables) {
      const visible = await db.query<{ organization_id: string }>(`
        select organization_id from public.${table} order by organization_id
      `);
      expect(visible.rows).toEqual([{ organization_id: organizationTwoId }]);
    }
    await resetRole(db);
  });

  it("denies direct authenticated writes and enforces the manager-only reservation RPC", async () => {
    await resetRole(db);
    await db.exec(`
      grant insert, update, delete on table
        public.github_installations,
        public.github_repositories,
        public.github_webhook_deliveries,
        public.github_change_requests
      to authenticated_rls_probe;
    `);

    // This inherited probe role has test-only DML grants. Any denial below is
    // therefore the RLS policy itself, independently of the production ACL.
    await assumeRole(db, "authenticated_rls_probe", ownerOneId);
    for (const [table, id] of [
      ["github_installations", installationOneId],
      ["github_repositories", repositoryOneId],
      ["github_webhook_deliveries", deliveryOneId],
      ["github_change_requests", changeOneId],
    ] as const) {
      const ownUpdate = await db.query<{ id: string }>(`
        update public.${table} set id = id where id = '${id}' returning id
      `);
      expect(ownUpdate.rows).toEqual([]);
    }
    for (const [table, id] of [
      ["github_installations", installationTwoId],
      ["github_repositories", repositoryTwoId],
      ["github_webhook_deliveries", deliveryTwoId],
      ["github_change_requests", changeTwoId],
    ] as const) {
      const crossTenantUpdate = await db.query<{ id: string }>(`
        update public.${table} set id = id where id = '${id}' returning id
      `);
      expect(crossTenantUpdate.rows).toEqual([]);
      const crossTenantDelete = await db.query<{ id: string }>(`
        delete from public.${table} where id = '${id}' returning id
      `);
      expect(crossTenantDelete.rows).toEqual([]);
    }

    await expect(db.query(`
      insert into public.github_installations (
        organization_id, connection_id, external_installation_id, app_id, app_slug,
        account_id, account_login, account_type, target_type, repository_selection,
        status, installed_at, created_by
      ) values (
        '${organizationOneId}', '${spareConnectionOneId}', 900011, 700001, 'rls-factory-app',
        800011, 'tenant-one-spare', 'Organization', 'Organization', 'selected',
        'active', now(), '${ownerOneId}'
      )
    `)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(`
      insert into public.github_repositories (
        organization_id, installation_id, external_repository_id, owner_login,
        name, full_name, default_branch, html_url, private, visibility,
        selected, github_updated_at
      ) values (
        '${organizationOneId}', '${installationOneId}', 600011, 'tenant-one',
        'forbidden', 'tenant-one/forbidden', 'main', 'https://github.com/tenant-one/forbidden',
        true, 'private', true, now()
      )
    `)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(`
      insert into public.github_webhook_deliveries (
        organization_id, connection_id, installation_id, external_delivery_id,
        external_installation_id, event_name, payload_sha256
      ) values (
        '${organizationOneId}', '${connectionOneId}', '${installationOneId}',
        'delivery-auth-denied-0001', 900001, 'ping', repeat('9', 64)
      )
    `)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(`
      insert into public.github_change_requests (
        organization_id, project_id, connection_id, repository_id,
        idempotency_key, execution_nonce, content_sha256, path,
        expected_blob_sha, base_branch, title, commit_message, created_by
      ) values (
        '${organizationOneId}', '${projectOneId}', '${connectionOneId}', '${repositoryOneId}',
        'direct-write-denied', gen_random_uuid(), repeat('8', 64), 'README.md',
        repeat('7', 40), 'main', 'Forbidden direct write', 'Forbidden direct write', '${ownerOneId}'
      )
    `)).rejects.toMatchObject({ code: "42501" });

    await assumeRole(db, "authenticated", ownerOneId);
    await expect(db.query(`
      insert into public.github_change_requests (
        organization_id, project_id, connection_id, repository_id,
        idempotency_key, execution_nonce, content_sha256, path,
        expected_blob_sha, base_branch, title, commit_message, created_by
      ) values (
        '${organizationOneId}', '${projectOneId}', '${connectionOneId}', '${repositoryOneId}',
        'acl-write-denied', gen_random_uuid(), repeat('8', 64), 'README.md',
        repeat('7', 40), 'main', 'Forbidden ACL write', 'Forbidden ACL write', '${ownerOneId}'
      )
    `)).rejects.toMatchObject({ code: "42501" });

    const ownerReservation = await db.query<{
      created_by: string;
      id: string;
      idempotency_key: string;
      organization_id: string;
    }>(reservationSql, reservationArguments("rls-owner-reserve-001"));
    expect(ownerReservation.rows[0]).toMatchObject({
      created_by: ownerOneId,
      idempotency_key: "rls-owner-reserve-001",
      organization_id: organizationOneId,
    });

    await assumeRole(db, "authenticated", adminOneId);
    const adminReservation = await db.query<{
      created_by: string;
      id: string;
      idempotency_key: string;
      organization_id: string;
    }>(reservationSql, reservationArguments("rls-admin-reserve-001"));
    expect(adminReservation.rows[0]).toMatchObject({
      created_by: adminOneId,
      idempotency_key: "rls-admin-reserve-001",
      organization_id: organizationOneId,
    });

    await assumeRole(db, "authenticated", memberOneId);
    await expect(
      db.query(reservationSql, reservationArguments("rls-member-denied-001")),
    ).rejects.toMatchObject({ code: "42501" });

    await assumeRole(db, "authenticated", ownerTwoId);
    await expect(
      db.query(reservationSql, reservationArguments("rls-cross-denied-001")),
    ).rejects.toMatchObject({ code: "42501" });
    await resetRole(db);
  });

  it("denies anonymous reads, writes, and reservation execution", async () => {
    await assumeRole(db, "anon");
    for (const table of targetTables) {
      await expect(
        db.query(`select id from public.${table} limit 1`),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      db.query(reservationSql, reservationArguments("rls-anon-denied-001")),
    ).rejects.toMatchObject({ code: "42501" });
    await resetRole(db);
  });

  it("permits only explicitly granted service-role table and terminal RPC paths", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    await expect(
      db.query(
        "select * from public.complete_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          ownerOneId,
          changeOneId,
          "softwarefactory/rls-matrix",
          "1".repeat(40),
          `https://github.com/tenant-one/repository/commit/${"1".repeat(40)}`,
          910001,
          101,
          "RLS matrix draft",
          "https://github.com/tenant-one/repository/pull/101",
        ],
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await assumeRole(db, "service_role");
    for (const table of targetTables) {
      const tenants = await db.query<{ organization_id: string }>(`
        select distinct organization_id from public.${table} order by organization_id
      `);
      expect(tenants.rows.map((row) => row.organization_id)).toEqual([
        organizationOneId,
        organizationTwoId,
      ]);
    }

    const serviceInstallationId = "30000000-0000-4000-8000-000000000011";
    const serviceRepositoryId = "50000000-0000-4000-8000-000000000011";
    const serviceChangeId = "70000000-0000-4000-8000-000000000011";
    await db.exec(`
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, permissions, installed_at, created_by
      ) values (
        '${serviceInstallationId}', '${organizationOneId}', '${spareConnectionOneId}',
        900011, 700001, 'rls-factory-app', 800011, 'tenant-one-spare',
        'Organization', 'Organization', 'selected', 'active',
        '{"metadata":"read"}', now(), '${ownerOneId}'
      );

      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id, owner_login,
        name, full_name, default_branch, html_url, private, visibility,
        selected, permissions, github_updated_at
      ) values (
        '${serviceRepositoryId}', '${organizationOneId}', '${serviceInstallationId}',
        600011, 'tenant-one', 'service-repository', 'tenant-one/service-repository',
        'main', 'https://github.com/tenant-one/service-repository', true, 'private',
        true, '{"contents":"write"}', now()
      );

      insert into public.github_change_requests (
        id, organization_id, project_id, connection_id, repository_id,
        idempotency_key, execution_nonce, content_sha256, path,
        expected_blob_sha, base_branch, title, commit_message, created_by
      ) values (
        '${serviceChangeId}', '${organizationOneId}', '${projectOneId}',
        '${connectionOneId}', '${repositoryOneId}', 'rls-service-direct-001',
        gen_random_uuid(), repeat('2', 64), 'README.md', repeat('3', 40),
        'main', 'Service boundary record', 'Service boundary record', '${ownerOneId}'
      );
    `);

    const serviceDelivery = await db.query<{ id: string }>(`
      insert into public.github_webhook_deliveries (
        external_delivery_id, event_name, payload_sha256, status
      ) values (
        'delivery-service-role-0001', 'ping', repeat('6', 64), 'accepted'
      ) returning id
    `);
    const serviceDeliveryId = serviceDelivery.rows[0]!.id;
    const updatedDelivery = await db.query<{ status: string }>(`
      update public.github_webhook_deliveries
      set status = 'ignored', processed_at = now()
      where id = '${serviceDeliveryId}'
      returning status
    `);
    expect(updatedDelivery.rows).toEqual([{ status: "ignored" }]);

    const serviceUpdates = await Promise.all([
      db.query<{ id: string }>(`
        update public.github_installations set id = id
        where id = '${serviceInstallationId}' returning id
      `),
      db.query<{ id: string }>(`
        update public.github_repositories set id = id
        where id = '${serviceRepositoryId}' returning id
      `),
      db.query<{ id: string }>(`
        update public.github_change_requests set id = id
        where id = '${serviceChangeId}' returning id
      `),
    ]);
    expect(serviceUpdates.map((result) => result.rows[0]?.id)).toEqual([
      serviceInstallationId,
      serviceRepositoryId,
      serviceChangeId,
    ]);

    await expect(db.query(`
      insert into public.github_webhook_deliveries (
        external_delivery_id, event_name, payload_sha256, metadata
      ) values (
        'delivery-sensitive-denied-01', 'ping', repeat('5', 64),
        '{"access_token":"github_pat_abcdefghijklmnopqrstuvwxyz123456"}'
      )
    `)).rejects.toMatchObject({ code: "23514" });

    for (const [table, id] of [
      ["github_installations", serviceInstallationId],
      ["github_repositories", serviceRepositoryId],
      ["github_webhook_deliveries", serviceDeliveryId],
      ["github_change_requests", serviceChangeId],
    ] as const) {
      await expect(db.query(`
        delete from public.${table} where id = '${id}'
      `)).rejects.toMatchObject({ code: "42501" });
    }

    const completion = await db.query<{ change_request_id: string }>(
      "select change_request_id from public.complete_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        ownerOneId,
        changeOneId,
        "softwarefactory/rls-matrix",
        "1".repeat(40),
        `https://github.com/tenant-one/repository/commit/${"1".repeat(40)}`,
        910001,
        101,
        "RLS matrix draft",
        "https://github.com/tenant-one/repository/pull/101",
      ],
    );
    expect(completion.rows).toEqual([{ change_request_id: changeOneId }]);
    const completedChange = await db.query<{ status: string }>(`
      select status from public.github_change_requests where id = '${changeOneId}'
    `);
    expect(completedChange.rows).toEqual([{ status: "completed" }]);

    await expect(
      db.query(reservationSql, reservationArguments("rls-service-denied-001")),
    ).rejects.toMatchObject({ code: "42501" });
    await resetRole(db);
  });
});
