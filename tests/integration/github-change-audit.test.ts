// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const auditMigrationPath = "supabase/migrations/20260812001200_github_change_audit.sql";
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
];

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

describe("GitHub change audit hardening", () => {
  it("keeps both terminal RPCs server-only and actor-attributed", async () => {
    const migration = await source(auditMigrationPath);

    expect(migration).not.toMatch(/alter type public\.activity_event_type/i);
    expect(migration).toMatch(
      /insert into public\.activity_events \([\s\S]*?actor_user_id[\s\S]*?'project\.updated'/i,
    );
    expect(migration).toMatch(
      /insert into public\.activity_events \([\s\S]*?p_actor_user_id[\s\S]*?'project\.updated'/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.fail_github_change_request_with_evidence[\s\S]*?from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.fail_github_change_request_with_evidence[\s\S]*?to service_role/i,
    );
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security|drop\s+table/i);
  });

  it("retains only provider state proven before a failed request", async () => {
    const route = await source(
      "app/api/github/repositories/[owner]/[repo]/changes/route.ts",
    );
    const branchCreated = route.indexOf("headBranchEvidence = headBranch");
    const branchCall = route.indexOf("await createGitHubBranch(");
    const commitRecorded = route.indexOf("commitEvidence = {");
    const commitCall = route.indexOf("await updateGitHubFileOnBranch(");

    expect(branchCreated).toBeGreaterThan(branchCall);
    expect(commitRecorded).toBeGreaterThan(commitCall);
    expect(route).toContain('rpc("fail_github_change_request_with_evidence"');
    expect(route).toContain("p_head_branch: headBranchEvidence");
    expect(route).toContain("p_commit_sha: commitEvidence?.sha ?? null");
    expect(route).toContain("p_commit_url: commitEvidence?.url ?? null");
    expect(route).toContain("if (failure.error) throw failure.error");
  });

  it("persists partial failure evidence and immutable attributed events in PostgreSQL", async () => {
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
        await db.exec(
          await source(`supabase/migrations/${migrationFile}`),
        );
      }

      const ownerId = "00000000-0000-4000-8000-000000000101";
      await db.exec(`
        insert into auth.users (id) values ('${ownerId}');
        select set_config('request.jwt.claim.sub', '${ownerId}', false);
      `);
      const organization = await db.query<{ id: string }>(`
        insert into public.organizations (name, slug, created_by)
        values ('GitHub Audit Factory', 'github-audit-factory', '${ownerId}')
        returning id
      `);
      const organizationId = organization.rows[0]!.id;
      const project = await db.query<{ id: string }>(`
        insert into public.projects (
          organization_id, name, status, github_repository, default_branch, created_by
        ) values (
          '${organizationId}', 'Audit Project', 'active', 'owner/repository', 'main', '${ownerId}'
        ) returning id
      `);
      const projectId = project.rows[0]!.id;
      const connection = await db.query<{ id: string }>(`
        insert into public.connections (
          organization_id, name, provider, status, external_account_label,
          secret_reference, created_by
        ) values (
          '${organizationId}', 'Audit GitHub', 'github', 'connected', 'owner',
          'env://GITHUB_APP', '${ownerId}'
        ) returning id
      `);
      const connectionId = connection.rows[0]!.id;
      const installation = await db.query<{ id: string }>(`
        insert into public.github_installations (
          organization_id, connection_id, external_installation_id, app_id, app_slug,
          account_id, account_login, account_type, target_type, repository_selection,
          status, installed_at, created_by
        ) values (
          '${organizationId}', '${connectionId}', 900001, 700001, 'audit-app',
          800001, 'owner', 'Organization', 'Organization', 'selected',
          'active', now(), '${ownerId}'
        ) returning id
      `);
      const installationId = installation.rows[0]!.id;
      const repository = await db.query<{ id: string }>(`
        insert into public.github_repositories (
          organization_id, installation_id, external_repository_id, owner_login,
          name, full_name, default_branch, html_url, private, visibility,
          selected, github_updated_at
        ) values (
          '${organizationId}', '${installationId}', 600001, 'owner',
          'repository', 'owner/repository', 'main', 'https://github.com/owner/repository',
          true, 'private', true, now()
        ) returning id
      `);
      const repositoryId = repository.rows[0]!.id;

      const reserve = async (key: string) => {
        const result = await db.query<{ id: string }>(`
          insert into public.github_change_requests (
            organization_id, project_id, connection_id, repository_id,
            idempotency_key, execution_nonce, content_sha256, path,
            expected_blob_sha, base_branch, title, commit_message, created_by
          ) values (
            '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}',
            '${key}', gen_random_uuid(), repeat('a', 64), 'README.md',
            repeat('b', 40), 'main', 'Audit change', 'Audit change', '${ownerId}'
          ) returning id
        `);
        return result.rows[0]!.id;
      };

      const completedRequestId = await reserve("audit-complete-001");
      await db.exec("select set_config('request.jwt.claim.sub', '', false);");
      const completionArguments = [
        ownerId,
        completedRequestId,
        "softwarefactory/audit-complete",
        "c".repeat(40),
        "https://github.com/owner/repository/commit/" + "c".repeat(40),
        500001,
        41,
        "Audit change",
        "https://github.com/owner/repository/pull/41",
      ] as const;
      await db.query(
        "select * from public.complete_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [...completionArguments],
      );
      await db.query(
        "select * from public.complete_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [...completionArguments],
      );

      const failedRequestId = await reserve("audit-failure-001");
      const failedCommitSha = "d".repeat(40);
      const failedCommitUrl = `https://github.com/owner/repository/commit/${failedCommitSha}`;
      await db.query(
        "select public.fail_github_change_request_with_evidence($1,$2,$3,$4,$5,$6)",
        [
          ownerId,
          failedRequestId,
          "provider_unavailable",
          "softwarefactory/audit-failure",
          failedCommitSha,
          failedCommitUrl,
        ],
      );

      const failedRecord = await db.query<{
        commit_sha: string;
        commit_url: string;
        error_code: string;
        head_branch: string;
        status: string;
      }>(`
        select status, error_code, head_branch, commit_sha, commit_url
        from public.github_change_requests
        where id = '${failedRequestId}'
      `);
      expect(failedRecord.rows[0]).toEqual({
        commit_sha: failedCommitSha,
        commit_url: failedCommitUrl,
        error_code: "provider_unavailable",
        head_branch: "softwarefactory/audit-failure",
        status: "failed",
      });

      const terminalEvents = await db.query<{
        actor_user_id: string | null;
        entity_id: string;
        event_type: string;
      }>(`
        select actor_user_id, entity_id, event_type::text
        from public.activity_events
        where entity_type = 'github_change_request'
        order by entity_id
      `);
      expect(terminalEvents.rows).toEqual(expect.arrayContaining([
        {
          actor_user_id: ownerId,
          entity_id: completedRequestId,
          event_type: "project.updated",
        },
        {
          actor_user_id: ownerId,
          entity_id: failedRequestId,
          event_type: "project.updated",
        },
      ]));
      expect(terminalEvents.rows).toHaveLength(2);

      const pullRequestAudit = await db.query<{ actor_user_id: string | null }>(`
        select actor_user_id
        from public.activity_events
        where event_type = 'pull_request.created'
          and entity_type = 'pull_request'
      `);
      expect(pullRequestAudit.rows).toEqual([{ actor_user_id: ownerId }]);

      await expect(
        db.query(
          "update public.activity_events set description = 'mutated' where entity_id = $1",
          [failedRequestId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      await db.close();
    }
  }, 60_000);
});
