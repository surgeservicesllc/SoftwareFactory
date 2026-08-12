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
];

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

describe("direct control-plane write boundaries", () => {
  it("routes authenticated change reservations through the validated RPC", async () => {
    const route = await source(
      "app/api/github/repositories/[owner]/[repo]/changes/route.ts",
    );

    expect(route).toContain('.rpc("reserve_github_change_request"');
    expect(route).not.toMatch(
      /\.from\("github_change_requests"\)[\s\S]{0,120}\.insert\(/,
    );
  });

  it("applies 001-017, removes direct writes, and preserves narrow RPC workflows", async () => {
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
        connections_delete: boolean;
        connections_insert: boolean;
        connections_select: boolean;
        connections_update: boolean;
        project_connections_delete: boolean;
        project_connections_insert: boolean;
        project_connections_select: boolean;
        project_connections_update: boolean;
        projects_delete: boolean;
        projects_insert: boolean;
        projects_select: boolean;
        projects_update: boolean;
        requests_delete: boolean;
        requests_insert: boolean;
        requests_select: boolean;
        requests_update: boolean;
      }>(`
        select
          has_table_privilege('authenticated', 'public.connections', 'SELECT') as connections_select,
          has_table_privilege('authenticated', 'public.connections', 'INSERT') as connections_insert,
          has_table_privilege('authenticated', 'public.connections', 'UPDATE') as connections_update,
          has_table_privilege('authenticated', 'public.connections', 'DELETE') as connections_delete,
          has_table_privilege('authenticated', 'public.projects', 'SELECT') as projects_select,
          has_table_privilege('authenticated', 'public.projects', 'INSERT') as projects_insert,
          has_table_privilege('authenticated', 'public.projects', 'UPDATE') as projects_update,
          has_table_privilege('authenticated', 'public.projects', 'DELETE') as projects_delete,
          has_table_privilege('authenticated', 'public.project_connections', 'SELECT') as project_connections_select,
          has_table_privilege('authenticated', 'public.project_connections', 'INSERT') as project_connections_insert,
          has_table_privilege('authenticated', 'public.project_connections', 'UPDATE') as project_connections_update,
          has_table_privilege('authenticated', 'public.project_connections', 'DELETE') as project_connections_delete,
          has_table_privilege('authenticated', 'public.github_change_requests', 'SELECT') as requests_select,
          has_table_privilege('authenticated', 'public.github_change_requests', 'INSERT') as requests_insert,
          has_table_privilege('authenticated', 'public.github_change_requests', 'UPDATE') as requests_update,
          has_table_privilege('authenticated', 'public.github_change_requests', 'DELETE') as requests_delete
      `);
      expect(privileges.rows[0]).toEqual({
        connections_delete: false,
        connections_insert: false,
        connections_select: true,
        connections_update: false,
        project_connections_delete: false,
        project_connections_insert: false,
        project_connections_select: true,
        project_connections_update: false,
        projects_delete: false,
        projects_insert: false,
        projects_select: true,
        projects_update: false,
        requests_delete: false,
        requests_insert: false,
        requests_select: true,
        requests_update: false,
      });

      const rpcPrivileges = await db.query<{
        anon_reserve: boolean;
        authenticated_connect: boolean;
        authenticated_controls: boolean;
        authenticated_reserve: boolean;
      }>(`
        select
          has_function_privilege(
            'anon',
            'public.reserve_github_change_request(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text)',
            'EXECUTE'
          ) as anon_reserve,
          has_function_privilege(
            'authenticated',
            'public.reserve_github_change_request(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text)',
            'EXECUTE'
          ) as authenticated_reserve,
          has_function_privilege(
            'authenticated',
            'public.connect_github_project(uuid,uuid,bigint,text,text,text)',
            'EXECUTE'
          ) as authenticated_connect,
          has_function_privilege(
            'authenticated',
            'public.update_project_controls(uuid,boolean,public.risk_level,boolean,boolean,boolean,boolean,timestamp with time zone)',
            'EXECUTE'
          ) as authenticated_controls
      `);
      expect(rpcPrivileges.rows[0]).toEqual({
        anon_reserve: false,
        authenticated_connect: true,
        authenticated_controls: true,
        authenticated_reserve: true,
      });

      const ownerId = "00000000-0000-4000-8000-000000000101";
      const organizationId = "10000000-0000-4000-8000-000000000001";
      const connectionId = "20000000-0000-4000-8000-000000000001";
      const installationId = "30000000-0000-4000-8000-000000000001";
      const repositoryId = "40000000-0000-4000-8000-000000000001";

      await db.exec(`
        insert into auth.users (id) values ('${ownerId}');
        select set_config('request.jwt.claim.sub', '${ownerId}', false);
        insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Boundary Factory', 'boundary-factory', '${ownerId}');
        insert into public.connections (
          id, organization_id, name, provider, status, external_account_label,
          secret_reference, created_by
        ) values (
          '${connectionId}', '${organizationId}', 'Boundary GitHub', 'github',
          'connected', 'boundary-factory', 'env://GITHUB_APP', '${ownerId}'
        );
        insert into public.github_installations (
          id, organization_id, connection_id, external_installation_id, app_id,
          app_slug, account_id, account_login, account_type, target_type,
          repository_selection, status, installed_at, created_by
        ) values (
          '${installationId}', '${organizationId}', '${connectionId}', 900001,
          700001, 'boundary-app', 800001, 'boundary-factory', 'Organization',
          'Organization', 'selected', 'active', now(), '${ownerId}'
        );
        insert into public.github_repositories (
          id, organization_id, installation_id, external_repository_id,
          owner_login, name, full_name, default_branch, html_url, private,
          visibility, selected, github_updated_at
        ) values (
          '${repositoryId}', '${organizationId}', '${installationId}', 600001,
          'boundary-factory', 'repository', 'boundary-factory/repository',
          'main', 'https://github.com/boundary-factory/repository', true,
          'private', true, now()
        );
        set role authenticated;
      `);

      await expect(
        db.exec(`
          insert into public.projects (
            organization_id, name, status, github_repository, default_branch, created_by
          ) values (
            '${organizationId}', 'Bypass', 'active', 'boundary-factory/bypass',
            'main', '${ownerId}'
          )
        `),
      ).rejects.toMatchObject({ code: "42501" });

      const connectedProject = await db.query<{ project_id: string }>(`
        select project_id
        from public.connect_github_project(
          '${organizationId}', '${connectionId}', 600001,
          'Boundary Project', null, 'main'
        )
      `);
      const projectId = connectedProject.rows[0]!.project_id;

      await expect(
        db.exec(`update public.projects set name = 'Bypass' where id = '${projectId}'`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.exec(`update public.connections set status = 'disabled' where id = '${connectionId}'`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.exec(`delete from public.project_connections where project_id = '${projectId}'`),
      ).rejects.toMatchObject({ code: "42501" });

      const controls = await db.query<{ autonomous_mode: boolean }>(`
        select autonomous_mode
        from public.update_project_controls(
          '${projectId}', false, 'green', false, false, false, false, null
        )
      `);
      expect(controls.rows[0]?.autonomous_mode).toBe(false);

      await expect(
        db.exec(`
          insert into public.github_change_requests (
            organization_id, project_id, connection_id, repository_id,
            idempotency_key, execution_nonce, content_sha256, path,
            expected_blob_sha, base_branch, title, commit_message, created_by
          ) values (
            '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}',
            'direct-bypass-001', gen_random_uuid(), repeat('a', 64), 'README.md',
            repeat('b', 40), 'main', 'Bypass', 'Bypass', '${ownerId}'
          )
        `),
      ).rejects.toMatchObject({ code: "42501" });

      const firstNonce = "50000000-0000-4000-8000-000000000001";
      const reserveArguments = [
        organizationId,
        projectId,
        connectionId,
        repositoryId,
        "bounded-change-001",
        firstNonce,
        "a".repeat(64),
        "README.md",
        "b".repeat(40),
        "main",
        "Bounded change",
        "Bounded change",
      ];
      const reservation = await db.query<{
        execution_nonce: string;
        id: string;
        status: string;
      }>(
        `select id, execution_nonce, status
         from public.reserve_github_change_request(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
         )`,
        reserveArguments,
      );
      expect(reservation.rows[0]).toEqual({
        execution_nonce: firstNonce,
        id: expect.any(String),
        status: "reserved",
      });

      const replay = await db.query<{ execution_nonce: string; id: string }>(
        `select id, execution_nonce
         from public.reserve_github_change_request(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
         )`,
        [
          ...reserveArguments.slice(0, 5),
          "50000000-0000-4000-8000-000000000002",
          ...reserveArguments.slice(6),
        ],
      );
      expect(replay.rows[0]).toEqual({
        execution_nonce: firstNonce,
        id: reservation.rows[0]!.id,
      });

      const evidence = await db.query<{ events: number; requests: number }>(`
        select
          (select count(*)::integer from public.github_change_requests
           where organization_id = '${organizationId}'
             and idempotency_key = 'bounded-change-001') as requests,
          (select count(*)::integer from public.activity_events
           where organization_id = '${organizationId}'
             and entity_type = 'github_change_request'
             and description = 'GitHub change request reserved') as events
      `);
      expect(evidence.rows[0]).toEqual({ events: 1, requests: 1 });

      await expect(
        db.query(
          `select * from public.reserve_github_change_request(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
           )`,
          [
            organizationId,
            projectId,
            connectionId,
            "40000000-0000-4000-8000-000000000099",
            "wrong-target-001",
            "50000000-0000-4000-8000-000000000003",
            "a".repeat(64),
            "README.md",
            "b".repeat(40),
            "main",
            "Wrong target",
            "Wrong target",
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await db.close();
    }
  }, 60_000);
});
