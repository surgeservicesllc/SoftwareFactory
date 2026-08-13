// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-000000000101";
const adminId = "00000000-0000-4000-8000-000000000102";
const otherOwnerId = "00000000-0000-4000-8000-000000000103";
const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const otherProjectId = "20000000-0000-4000-8000-000000000002";
const connectionId = "30000000-0000-4000-8000-000000000001";
const otherConnectionId = "30000000-0000-4000-8000-000000000002";
const installationId = "40000000-0000-4000-8000-000000000001";
const otherInstallationId = "40000000-0000-4000-8000-000000000002";
const repositoryId = "50000000-0000-4000-8000-000000000001";
const otherRepositoryId = "50000000-0000-4000-8000-000000000002";

async function assumeAuthenticated(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("owner-approved protected draft changes", () => {
  it("enforces owner-only RED evidence, immutable audit, tenant ACLs, and safe lease reclamation", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const path = "AI/BACKLOG.md";
    const confirmation = `APPROVE RED DRAFT PR FOR ${path}`;
    const reason = "Update the reviewed backlog priorities for this release.";
    const rollbackPlan = "Close the draft pull request without merging if review fails.";
    const contentDigest = "a".repeat(64);
    const blobDigest = "b".repeat(40);
    const firstNonce = "60000000-0000-4000-8000-000000000001";
    const reclaimedNonce = "60000000-0000-4000-8000-000000000002";
    const providerBoundaryNonce = "60000000-0000-4000-8000-000000000003";
    const expiredApprovalNonce = "60000000-0000-4000-8000-000000000004";
    const expiredApprovalReclaimNonce = "60000000-0000-4000-8000-000000000005";

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

      const migrationFiles = (await readdir(migrationsDirectory))
        .filter((file) => file.endsWith(".sql"))
        .sort();
      for (const migrationFile of migrationFiles) {
        await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
      }

      const databaseDetectorCases = [
        ["DATABASE_PASSWORD=opaque-password", true],
        ["OPENAI_API_KEY=opaque-api-key", true],
        ["SUPABASE_SERVICE_ROLE_KEY=opaque-service-role-key", true],
        ["GITHUB_APP_WEBHOOK_SECRET=opaque-webhook-secret", true],
        ["GITHUB_APP_STATE_SECRET=opaque-state-secret", true],
        ["AWS_SECRET_ACCESS_KEY=opaque-access-key", true],
        ["VERCEL_TOKEN=opaque-vercel-token", true],
        ["PRIVATE_KEY=opaque-private-key", true],
        ["PRIVATE_KEY_BASE64=QWxhZGRpbjpvcGVuIHNlc2FtZQ==", true],
        ["ACCESS_TOKEN=opaque-access-token", true],
        ["DATABASE_URL=postgresql://app:correct-horse-battery-staple@db.example.com/factory", true],
        ["STRIPE_SECRET_KEY=sk_live_51SoftwareFactorySecretValue", true],
        ['const DATABASE_PASSWORD = "correct-horse-battery-staple";', true],
        ['{"feature":true,"DATABASE_PASSWORD":"correct-horse-battery-staple"}', true],
        ["DATABASE_PASSWORD=<set-in-secret-manager>", false],
        ["OPENAI_API_KEY=${OPENAI_API_KEY}", false],
        ["PRIVATE_KEY_BASE64=${{ secrets.PRIVATE_KEY_BASE64 }}", false],
        ["AWS_SECRET_ACCESS_KEY=change-me", false],
        ["VERCEL_TOKEN=xxxxxxxx", false],
        ["DATABASE_URL=postgresql://app:${DATABASE_PASSWORD}@db.example.com/factory", false],
        ['{"DATABASE_PASSWORD":"REPLACE_ME","feature":true}', false],
        ["Document DATABASE_PASSWORD assignment handling without a value.", false],
      ] as const;
      for (const [candidate, expected] of databaseDetectorCases) {
        const detected = await db.query<{ detected: boolean }>(
          "select public.text_has_likely_secret($1) as detected",
          [candidate],
        );
        expect(detected.rows, candidate).toEqual([{ detected: expected }]);
      }

      await db.exec(`
        insert into auth.users (id) values
          ('${ownerId}'), ('${adminId}'), ('${otherOwnerId}');
        insert into public.organizations (id, name, slug, created_by) values
          ('${organizationId}', 'Protected Factory', 'protected-factory', '${ownerId}'),
          ('${otherOrganizationId}', 'Other Factory', 'other-factory', '${otherOwnerId}');
        insert into public.organization_members (
          organization_id, user_id, role, created_by
        ) values (
          '${organizationId}', '${adminId}', 'admin', '${ownerId}'
        );

        insert into public.connections (
          id, organization_id, name, provider, status, external_account_label,
          secret_reference, created_by
        ) values
          ('${connectionId}', '${organizationId}', 'Protected GitHub', 'github',
           'connected', 'protected-factory', 'env://GITHUB_APP', '${ownerId}'),
          ('${otherConnectionId}', '${otherOrganizationId}', 'Other GitHub', 'github',
           'connected', 'other-factory', 'env://GITHUB_APP', '${otherOwnerId}');

        insert into public.github_installations (
          id, organization_id, connection_id, external_installation_id, app_id,
          app_slug, account_id, account_login, account_type, target_type,
          repository_selection, status, installed_at, created_by
        ) values
          ('${installationId}', '${organizationId}', '${connectionId}', 900001,
           700001, 'factory-app', 800001, 'protected-factory', 'Organization',
           'Organization', 'selected', 'active', now(), '${ownerId}'),
          ('${otherInstallationId}', '${otherOrganizationId}', '${otherConnectionId}', 900002,
           700001, 'factory-app', 800002, 'other-factory', 'Organization',
           'Organization', 'selected', 'active', now(), '${otherOwnerId}');

        insert into public.github_repositories (
          id, organization_id, installation_id, external_repository_id, owner_login,
          name, full_name, default_branch, html_url, private, visibility,
          selected, github_updated_at
        ) values
          ('${repositoryId}', '${organizationId}', '${installationId}', 600001,
           'protected-factory', 'application', 'protected-factory/application', 'main',
           'https://github.com/protected-factory/application', true, 'private', true, now()),
          ('${otherRepositoryId}', '${otherOrganizationId}', '${otherInstallationId}', 600002,
           'other-factory', 'application', 'other-factory/application', 'main',
           'https://github.com/other-factory/application', true, 'private', true, now());

        insert into public.projects (
          id, organization_id, name, status, github_repository, default_branch, created_by
        ) values
          ('${projectId}', '${organizationId}', 'Protected Project', 'active',
           'protected-factory/application', 'main', '${ownerId}'),
          ('${otherProjectId}', '${otherOrganizationId}', 'Other Project', 'active',
           'other-factory/application', 'main', '${otherOwnerId}');

        insert into public.project_connections (
          organization_id, project_id, connection_id, github_repository_id,
          is_primary, created_by
        ) values
          ('${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}', true, '${ownerId}'),
          ('${otherOrganizationId}', '${otherProjectId}', '${otherConnectionId}', '${otherRepositoryId}', true, '${otherOwnerId}');
      `);

      const privileges = await db.query<{
        anon_execute: boolean;
        authenticated_execute: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        service_execute: boolean;
      }>(`
        select
          has_function_privilege(
            'anon',
            'public.reserve_owner_approved_protected_github_change(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,text)',
            'EXECUTE'
          ) as anon_execute,
          has_function_privilege(
            'authenticated',
            'public.reserve_owner_approved_protected_github_change(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,text)',
            'EXECUTE'
          ) as authenticated_execute,
          has_function_privilege(
            'service_role',
            'public.reserve_owner_approved_protected_github_change(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,text)',
            'EXECUTE'
          ) as service_execute,
          has_table_privilege('authenticated', 'public.github_protected_change_approvals', 'SELECT') as authenticated_select,
          has_table_privilege('authenticated', 'public.github_protected_change_approvals', 'INSERT') as authenticated_insert
      `);
      expect(privileges.rows[0]).toEqual({
        anon_execute: false,
        authenticated_execute: true,
        authenticated_insert: false,
        authenticated_select: true,
        service_execute: false,
      });

      const reservationSql = "select * from public.reserve_github_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)";
      const creatorCollisionArguments = [
        organizationId,
        projectId,
        connectionId,
        repositoryId,
        "protected-creator-collision-001",
        "60000000-0000-4000-8000-000000000020",
        "c".repeat(64),
        "AI/DECISIONS.md",
        "d".repeat(40),
        "main",
        "Creator collision boundary",
        "Creator collision boundary",
      ] as const;
      await assumeAuthenticated(db, adminId);
      await db.query(reservationSql, [...creatorCollisionArguments]);

      const intentCollisionArguments = [
        organizationId,
        projectId,
        connectionId,
        repositoryId,
        "protected-intent-collision-001",
        "60000000-0000-4000-8000-000000000021",
        "e".repeat(64),
        "AI/ARCHITECTURE.md",
        "f".repeat(40),
        "main",
        "Original protected intent",
        "Original protected intent",
      ] as const;
      await assumeAuthenticated(db, ownerId);
      await db.query(reservationSql, [...intentCollisionArguments]);

      const protectedApprovalSql = "select * from public.reserve_owner_approved_protected_github_change($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)";
      await expect(db.query(protectedApprovalSql, [
        ...creatorCollisionArguments,
        "APPROVE RED DRAFT PR FOR AI/DECISIONS.md",
        reason,
        rollbackPlan,
      ])).rejects.toMatchObject({
        code: "23505",
        message: "idempotency key was already used for a different protected change intent",
      });
      await expect(db.query(protectedApprovalSql, [
        ...intentCollisionArguments.slice(0, 10),
        "Changed protected intent",
        "Changed protected intent",
        "APPROVE RED DRAFT PR FOR AI/ARCHITECTURE.md",
        reason,
        rollbackPlan,
      ])).rejects.toMatchObject({
        code: "23505",
        message: "idempotency key was already used for a different protected change intent",
      });

      await resetRole(db);
      const collisionEvidence = await db.query<{ approval_events: number; approvals: number }>(`
        select
          (select count(*)::integer from public.github_protected_change_approvals) as approvals,
          (
            select count(*)::integer
            from public.activity_events
            where event_type in (
              'approval.requested'::public.activity_event_type,
              'approval.decided'::public.activity_event_type
            )
          ) as approval_events
      `);
      expect(collisionEvidence.rows).toEqual([{ approval_events: 0, approvals: 0 }]);

      const approvalArguments = [
        organizationId,
        projectId,
        connectionId,
        repositoryId,
        "protected-change-001",
        firstNonce,
        contentDigest,
        path,
        blobDigest,
        "main",
        "Update protected backlog",
        "Update protected backlog",
        confirmation,
        reason,
        rollbackPlan,
      ] as const;
      const approvalSql = "select * from public.reserve_owner_approved_protected_github_change($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)";

      await assumeAuthenticated(db, adminId);
      await expect(db.query(approvalSql, [...approvalArguments])).rejects.toMatchObject({ code: "42501" });

      await assumeAuthenticated(db, ownerId);
      await expect(db.query(approvalSql, [
        otherOrganizationId,
        otherProjectId,
        otherConnectionId,
        otherRepositoryId,
        "cross-tenant-protected-001",
        "60000000-0000-4000-8000-000000000099",
        contentDigest,
        path,
        blobDigest,
        "main",
        "Cross tenant protected change",
        "Cross tenant protected change",
        confirmation,
        reason,
        rollbackPlan,
      ])).rejects.toMatchObject({ code: "42501" });
      await expect(db.query(approvalSql, [
        ...approvalArguments.slice(0, 12),
        "APPROVE RED DRAFT PR FOR README.md",
        reason,
        rollbackPlan,
      ])).rejects.toMatchObject({ code: "22023" });

      const reservation = await db.query<{ execution_nonce: string; id: string; reservation_expires_at: string }>(
        approvalSql,
        [...approvalArguments],
      );
      const requestId = reservation.rows[0]!.id;
      const replayArguments = [...approvalArguments];
      replayArguments[5] = "60000000-0000-4000-8000-000000000098";
      const replay = await db.query<{ execution_nonce: string; id: string }>(approvalSql, replayArguments);
      expect(replay.rows).toEqual([expect.objectContaining({
        execution_nonce: reservation.rows[0]!.execution_nonce,
        id: requestId,
      })]);

      const evidence = await db.query<{
        approver_user_id: string;
        base_branch: string;
        connection_id: string;
        content_sha256: string;
        confirmation_text: string;
        default_branch_write_allowed: boolean;
        deploy_allowed: boolean;
        executor_user_id: string;
        id: string;
        merge_allowed: boolean;
        path: string;
        project_id: string;
        rationale: string;
        repository_id: string;
        requester_user_id: string;
        risk_classification: string;
        rollback_plan: string;
      }>(`
        select approval.*
        from public.github_protected_change_approvals approval
        where approval.change_request_id = '${requestId}'
      `);
      expect(evidence.rows[0]).toMatchObject({
        approver_user_id: ownerId,
        base_branch: "main",
        connection_id: connectionId,
        content_sha256: contentDigest,
        confirmation_text: confirmation,
        default_branch_write_allowed: false,
        deploy_allowed: false,
        executor_user_id: ownerId,
        merge_allowed: false,
        path,
        project_id: projectId,
        rationale: reason,
        repository_id: repositoryId,
        requester_user_id: ownerId,
        risk_classification: "red",
        rollback_plan: rollbackPlan,
      });
      const approvalEvents = await db.query<{ event_type: string }>(`
        select event_type
        from public.list_activity('${organizationId}', 100)
        where entity_type = 'github_protected_change_approval'
          and entity_id = '${evidence.rows[0]!.id}'
        order by event_type
      `);
      expect(approvalEvents.rows).toEqual([
        { event_type: "approval.requested" },
        { event_type: "approval.decided" },
      ]);

      await resetRole(db);
      await db.exec("alter table public.github_protected_change_approvals disable trigger github_protected_change_approvals_append_only");
      await db.query(
        "update public.github_protected_change_approvals set content_sha256 = $1 where change_request_id = $2",
        ["f".repeat(64), requestId],
      );
      await db.exec("alter table public.github_protected_change_approvals enable trigger github_protected_change_approvals_append_only");
      await assumeAuthenticated(db, ownerId);
      await expect(db.query(
        "select public.begin_github_change_provider_execution($1,$2)",
        [requestId, firstNonce],
      )).rejects.toMatchObject({
        code: "23514",
        message: "protected approval snapshot does not match provider execution intent",
      });
      await resetRole(db);
      await db.exec("alter table public.github_protected_change_approvals disable trigger github_protected_change_approvals_append_only");
      await db.query(
        "update public.github_protected_change_approvals set content_sha256 = $1 where change_request_id = $2",
        [contentDigest, requestId],
      );
      await db.exec("alter table public.github_protected_change_approvals enable trigger github_protected_change_approvals_append_only");

      await assumeAuthenticated(db, adminId);
      const adminVisibility = await db.query<{ count: number }>(
        "select count(*)::integer as count from public.github_protected_change_approvals",
      );
      expect(adminVisibility.rows).toEqual([{ count: 0 }]);
      await expect(db.query(
        "update public.github_protected_change_approvals set rationale = $1 where change_request_id = $2",
        ["A different rationale that should never be accepted.", requestId],
      )).rejects.toMatchObject({ code: "42501" });
      await resetRole(db);

      await expect(db.query(
        "update public.github_protected_change_approvals set rationale = $1 where change_request_id = $2",
        ["A different rationale that should never be accepted.", requestId],
      )).rejects.toMatchObject({ code: "55000" });
      const approvalEvent = await db.query<{ id: string }>(`
        select id from public.activity_events
        where entity_type = 'github_protected_change_approval'
        limit 1
      `);
      await expect(db.query(
        "delete from public.activity_events where id = $1",
        [approvalEvent.rows[0]!.id],
      )).rejects.toMatchObject({ code: "55000" });

      const reclaimSql = "select * from public.reclaim_expired_github_change_reservation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)";
      const reclaimArguments = [
        organizationId,
        requestId,
        projectId,
        connectionId,
        repositoryId,
        "protected-change-001",
        firstNonce,
        reclaimedNonce,
        contentDigest,
        path,
        blobDigest,
        "main",
        "Update protected backlog",
        "Update protected backlog",
      ] as const;
      await assumeAuthenticated(db, ownerId);
      await expect(db.query(reclaimSql, [
        ...reclaimArguments.slice(0, 8),
        "f".repeat(64),
        ...reclaimArguments.slice(9),
      ])).rejects.toMatchObject({ code: "23505" });
      await expect(db.query(reclaimSql, [...reclaimArguments])).rejects.toMatchObject({ code: "55000" });
      await resetRole(db);
      await db.query(
        "update public.github_change_requests set reservation_expires_at = created_at + interval '1 millisecond' where id = $1",
        [requestId],
      );
      await assumeAuthenticated(db, ownerId);
      const reclaimed = await db.query<{ execution_nonce: string }>(reclaimSql, [...reclaimArguments]);
      expect(reclaimed.rows).toHaveLength(1);
      expect(reclaimed.rows[0]).toMatchObject({ execution_nonce: reclaimedNonce });

      const replayedAfterReclaim = await db.query<{ execution_nonce: string }>(
        approvalSql,
        [...approvalArguments],
      );
      expect(replayedAfterReclaim.rows).toHaveLength(1);
      expect(replayedAfterReclaim.rows[0]).toMatchObject({ execution_nonce: reclaimedNonce });

      const providerBoundary = await db.query<{ started: boolean }>(
        "select public.begin_github_change_provider_execution($1,$2) as started",
        [requestId, reclaimedNonce],
      );
      expect(providerBoundary.rows).toEqual([{ started: true }]);
      await resetRole(db);
      await db.query(
        "update public.github_change_requests set reservation_expires_at = created_at + interval '1 millisecond' where id = $1",
        [requestId],
      );
      await assumeAuthenticated(db, ownerId);
      await expect(db.query(reclaimSql, [
        ...reclaimArguments.slice(0, 6),
        reclaimedNonce,
        providerBoundaryNonce,
        ...reclaimArguments.slice(8),
      ])).rejects.toMatchObject({
        code: "55000",
        message: "a change with provider evidence cannot be reclaimed",
      });
      await resetRole(db);

      const expiredRequest = await db.query<{ id: string }>(`
        insert into public.github_change_requests (
          organization_id, project_id, connection_id, repository_id,
          idempotency_key, execution_nonce, content_sha256, path,
          expected_blob_sha, base_branch, title, commit_message, created_by,
          created_at, reservation_expires_at
        ) values (
          '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}',
          'expired-protected-001', '${expiredApprovalNonce}', repeat('c', 64),
          'AI/ROADMAP.md', repeat('d', 40), 'main', 'Expired protected approval',
          'Expired protected approval', '${ownerId}', now() - interval '20 minutes',
          now() - interval '1 minute'
        ) returning id
      `);
      await db.query(`
        insert into public.github_protected_change_approvals (
          change_request_id, organization_id, project_id, connection_id,
          repository_id, path, content_sha256, expected_blob_sha, base_branch,
          requester_user_id, approver_user_id, executor_user_id,
          confirmation_text, rationale, rollback_plan, requested_at, decided_at,
          expires_at
        ) values (
          '${expiredRequest.rows[0]!.id}', '${organizationId}', '${projectId}',
          '${connectionId}', '${repositoryId}', 'AI/ROADMAP.md', repeat('c', 64),
          repeat('d', 40), 'main', '${ownerId}', '${ownerId}', '${ownerId}',
          'APPROVE RED DRAFT PR FOR AI/ROADMAP.md',
          'Review an already expired protected approval boundary.',
          'Close the draft pull request without merging if review fails.',
          now() - interval '20 minutes', now() - interval '20 minutes',
          now() - interval '5 minutes'
        )
      `);

      await assumeAuthenticated(db, ownerId);
      await expect(db.query(
        "select public.begin_github_change_provider_execution($1,$2)",
        [expiredRequest.rows[0]!.id, expiredApprovalNonce],
      )).rejects.toMatchObject({
        code: "55000",
        message: "protected change approval expired before provider execution",
      });
      await expect(db.query(reclaimSql, [
        organizationId,
        expiredRequest.rows[0]!.id,
        projectId,
        connectionId,
        repositoryId,
        "expired-protected-001",
        expiredApprovalNonce,
        expiredApprovalReclaimNonce,
        "c".repeat(64),
        "AI/ROADMAP.md",
        "d".repeat(40),
        "main",
        "Expired protected approval",
        "Expired protected approval",
      ])).rejects.toMatchObject({
        code: "55000",
        message: "protected change approval expired before reservation reclaim",
      });
      await resetRole(db);

      const evidenceReservation = await db.query<{ id: string }>(`
        insert into public.github_change_requests (
          organization_id, project_id, connection_id, repository_id,
          idempotency_key, execution_nonce, content_sha256, path,
          expected_blob_sha, base_branch, title, commit_message, created_by,
          created_at, reservation_expires_at, head_branch
        ) values (
          '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}',
          'provider-evidence-001', '60000000-0000-4000-8000-000000000010',
          repeat('c', 64), 'README.md', repeat('d', 40), 'main',
          'Provider evidence', 'Provider evidence', '${ownerId}',
          now() - interval '10 minutes', now() - interval '1 second', 'softwarefactory/evidence'
        ) returning id
      `);
      await assumeAuthenticated(db, ownerId);
      await expect(db.query(reclaimSql, [
        organizationId,
        evidenceReservation.rows[0]!.id,
        projectId,
        connectionId,
        repositoryId,
        "provider-evidence-001",
        "60000000-0000-4000-8000-000000000010",
        "60000000-0000-4000-8000-000000000011",
        "c".repeat(64),
        "README.md",
        "d".repeat(40),
        "main",
        "Provider evidence",
        "Provider evidence",
      ])).rejects.toMatchObject({ code: "55000" });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("keeps the request bounded and records approval before any provider write", async () => {
    const route = await readFile(
      resolve(repositoryRoot, "app/api/github/repositories/[owner]/[repo]/changes/route.ts"),
      "utf8",
    );
    const schema = route.slice(route.indexOf("const changeSchema"), route.indexOf("type ChangeRecord"));

    expect(schema).toContain(".strict()");
    expect(schema).toContain("reason: z.string().trim().min(20).max(500)");
    expect(schema).toContain("rollbackPlan: z.string().trim().min(20).max(500)");
    expect(route).toContain("assertSameOriginRequest(request)");
    expect(route).toContain("protected_resource_approval_required");
    expect(route).toContain("reserve_owner_approved_protected_github_change");
    expect(route.indexOf("reserve_owner_approved_protected_github_change")).toBeLessThan(
      route.indexOf("await createGitHubBranch("),
    );
    expect(route).toContain("createGitHubDraftPullRequest");
    expect(route).not.toMatch(/mergePullRequest|createDeployment|updateDefaultBranch/);
  });
});
