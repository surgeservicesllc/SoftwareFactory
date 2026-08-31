// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * The Phase 1B adverse lifecycle, against the real migrated schema.
 *
 * `todo.md` listed these as the remaining 1B cases and none of them had a test:
 * approval expiry, explicit disconnect, connection loss and history
 * preservation, terminal deletion and restore, and cross-tenant isolation of
 * every one of those paths.
 *
 * They matter more than the happy path. Each is a state the integration enters
 * when something has already gone wrong, which is exactly when a control that
 * silently does nothing is most expensive — and the least likely to be noticed.
 */


const ownerId = "00000000-0000-4000-8000-00000000a001";
const adminId = "00000000-0000-4000-8000-00000000a002";
const memberId = "00000000-0000-4000-8000-00000000a003";
const outsiderId = "00000000-0000-4000-8000-00000000a004";

const organizationId = "10000000-0000-4000-8000-00000000a001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000a002";
const projectId = "40000000-0000-4000-8000-00000000a001";
const connectionId = "20000000-0000-4000-8000-00000000a001";
const installationId = "30000000-0000-4000-8000-00000000a001";
const repositoryId = "50000000-0000-4000-8000-00000000a001";

const EXTERNAL_INSTALLATION = 153479019;

async function actAs(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

describe("Phase 1B adverse lifecycle", () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values
        ('${ownerId}'), ('${adminId}'), ('${memberId}'), ('${outsiderId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Adverse Factory', 'adverse-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other Factory', 'other-adverse', '${outsiderId}');

      insert into public.organization_members (organization_id, user_id, role, created_by) values
        ('${organizationId}', '${adminId}', 'admin', '${ownerId}'),
        ('${organizationId}', '${memberId}', 'member', '${ownerId}');

      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');

      insert into public.connections (
        id, organization_id, name, provider, status, external_account_label, secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'surgeservicesllc', 'env://GITHUB_APP', '${ownerId}'
      );

      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id, app_slug,
        account_id, account_login, account_type, target_type, repository_selection,
        status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', ${EXTERNAL_INSTALLATION},
        4582606, 'surge-softwarefactory-next', 800001, 'surgeservicesllc', 'User', 'User',
        'selected', 'active', now(), '${ownerId}'
      );

      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id, owner_login, name,
        full_name, default_branch, html_url, private, visibility, selected, github_updated_at
      ) values (
        '${repositoryId}', '${organizationId}', '${installationId}', 600001, 'surgeservicesllc',
        'SoftwareFactory', 'surgeservicesllc/SoftwareFactory', 'main',
        'https://github.com/surgeservicesllc/SoftwareFactory', true, 'private', true, now()
      );
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("treats an expired owner approval as no approval at all", async () => {
    await db.exec("reset role");
    const { rows: taskRows } = await db.query<{ id: string }>(
      `insert into public.tasks (organization_id, project_id, title, status, risk_level, created_by)
       values ($1::uuid, $2::uuid, 'RED work', 'backlog', 'red'::public.risk_level, $3::uuid)
       returning id`,
      [organizationId, projectId, ownerId],
    );
    const taskId = taskRows[0].id;

    // The schema refuses an approval created already-approved, so this goes
    // through the real flow: request pending, then decide. Inserting a decided
    // row directly would have tested a state the application can never reach.
    const { rows: approvalRows } = await db.query<{ id: string }>(
      `insert into public.approvals (
         organization_id, project_id, task_id, kind, status, requested_by, requested_at, expires_at, request_reason
       ) values (
         $1::uuid, $4::uuid, $2::uuid, 'red_task_execution'::public.approval_kind,
         'pending'::public.approval_status, $3::uuid, now() - interval '3 hours',
         now() - interval '1 hour', 'RED execution approval for the expiry test'
       ) returning id`,
      [organizationId, taskId, ownerId, projectId],
    );
    await actAs(db, ownerId);
    await db.query(
      `select public.decide_approval($1::uuid, 'approved'::public.approval_status, 'ok')`,
      [approvalRows[0].id],
    );
    await db.exec("reset role");

    const { rows } = await db.query<{ valid: boolean }>(
      `select public.has_valid_owner_approval($1::uuid) as valid`, [taskId],
    );
    expect(rows[0].valid).toBe(false);

    // The same approval, still in date, is valid — so the test is measuring
    // expiry rather than some unrelated refusal.
    await db.query(
      `update public.approvals set expires_at = now() + interval '1 hour' where task_id = $1::uuid`,
      [taskId],
    );
    const { rows: live } = await db.query<{ valid: boolean }>(
      `select public.has_valid_owner_approval($1::uuid) as valid`, [taskId],
    );
    expect(live[0].valid).toBe(true);
  });

  it("refuses an approval decided by someone who is not an owner", async () => {
    await db.exec("reset role");
    const { rows: taskRows } = await db.query<{ id: string }>(
      `insert into public.tasks (organization_id, project_id, title, status, risk_level, created_by)
       values ($1::uuid, $2::uuid, 'RED work admin-approved', 'backlog', 'red'::public.risk_level, $3::uuid)
       returning id`,
      [organizationId, projectId, ownerId],
    );
    const { rows: approvalRows } = await db.query<{ id: string }>(
      `insert into public.approvals (
         organization_id, project_id, task_id, kind, status, requested_by, requested_at, request_reason
       ) values ($1::uuid, $4::uuid, $2::uuid, 'red_task_execution'::public.approval_kind,
         'pending'::public.approval_status, $3::uuid, now(), 'RED execution approval decided by an administrator') returning id`,
      [organizationId, taskRows[0].id, ownerId, projectId],
    );
    // The guarantee is stronger than "an administrator's approval does not
    // count": the administrator cannot record the decision at all. Refusing at
    // the decision point means no approved-looking row ever exists to be
    // misread by some later reader that forgets to check who decided it.
    await actAs(db, adminId);
    await expect(
      db.query(
        `select public.decide_approval($1::uuid, 'approved'::public.approval_status, 'looks fine')`,
        [approvalRows[0].id],
      ),
    ).rejects.toThrow(/only an organization owner may decide/i);

    await db.exec("reset role");
    const { rows } = await db.query<{ valid: boolean }>(
      `select public.has_valid_owner_approval($1::uuid) as valid`, [taskRows[0].id],
    );
    expect(rows[0].valid).toBe(false);
  });

  it("records connection loss without destroying the installation history", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{ mark_github_connection_lost: boolean }>(
      `select public.mark_github_connection_lost($1::uuid, $2::uuid, 'installation_revoked')`,
      [ownerId, connectionId],
    );
    expect(rows[0].mark_github_connection_lost).toBe(true);

    const { rows: connection } = await db.query<{ status: string }>(
      `select status::text as status from public.connections where id = $1::uuid`, [connectionId],
    );
    expect(connection[0].status).not.toBe("connected");

    // The installation row survives. Losing a connection is not the same as
    // never having had one, and the difference is the audit trail.
    const { rows: installation } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.github_installations where id = $1::uuid`, [installationId],
    );
    expect(installation[0].n).toBe(1);

    // The loss is recorded as activity, so an operator can see when the
    // integration stopped working rather than only that it is not working now.
    const { rows: audit } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.activity_events where organization_id = $1::uuid`,
      [organizationId],
    );
    expect(audit[0].n).toBeGreaterThan(0);
  });

  it("re-applies loss to the same end state, and reports false only for a connection it cannot find", async () => {
    await db.exec("reset role");
    // The real contract, which is not the one assumed when this was written:
    // the return value says "I found the connection and applied loss", not
    // "this was a fresh transition". Calling twice converges on the same state
    // rather than erroring, which is what a repeated revocation notice needs.
    const { rows: again } = await db.query<{ mark_github_connection_lost: boolean }>(
      `select public.mark_github_connection_lost($1::uuid, $2::uuid, 'installation_revoked')`,
      [ownerId, connectionId],
    );
    expect(again[0].mark_github_connection_lost).toBe(true);

    const { rows: state } = await db.query<{ status: string; error_message: string }>(
      `select status::text as status, error_message from public.connections where id = $1::uuid`,
      [connectionId],
    );
    expect(state[0]).toMatchObject({ status: "error", error_message: "GitHub Connection Lost" });

    // Repositories are deselected rather than deleted, so a later reconnect has
    // history to reconcile against instead of starting blind.
    const { rows: repositories } = await db.query<{ selected: boolean }>(
      `select selected from public.github_repositories where id = $1::uuid`, [repositoryId],
    );
    expect(repositories[0].selected).toBe(false);

    // A connection that does not exist is the one false case.
    const { rows: missing } = await db.query<{ mark_github_connection_lost: boolean }>(
      `select public.mark_github_connection_lost($1::uuid, gen_random_uuid(), 'installation_revoked')`,
      [ownerId],
    );
    expect(missing[0].mark_github_connection_lost).toBe(false);
  });

  it("refuses to disconnect against a mismatched installation id", async () => {
    await db.exec("reset role");
    // The guard exists so a stale client cannot disconnect an installation that
    // has since been replaced — the id it names is the one it believes in.
    await expect(
      db.query(
        `select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)`,
        [ownerId, connectionId, 999999],
      ),
    ).rejects.toThrow();
  });

  it("preserves the connection row and its history through an explicit disconnect", async () => {
    await db.exec("reset role");
    await db.query(`update public.connections set status = 'connected' where id = $1::uuid`, [connectionId]);
    await db.query(`update public.github_installations set status = 'active' where id = $1::uuid`, [installationId]);

    const { rows } = await db.query<{ disconnect_github_connection: number }>(
      `select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)`,
      [ownerId, connectionId, EXTERNAL_INSTALLATION],
    );
    expect(rows[0].disconnect_github_connection).toBeGreaterThanOrEqual(0);

    // Rows are retained rather than deleted: an integration that was once
    // connected and is now not is a different fact from one that never existed,
    // and only the retained row can tell them apart afterwards.
    const { rows: kept } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.connections where id = $1::uuid`, [connectionId],
    );
    expect(kept[0].n).toBe(1);
    const { rows: repositories } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.github_repositories where id = $1::uuid`, [repositoryId],
    );
    expect(repositories[0].n).toBe(1);
  });

  it("keeps every one of those paths closed to another organization", async () => {
    await actAs(db, outsiderId);

    // Reads see nothing.
    expect((await db.query(`select 1 from public.connections where id = $1::uuid`, [connectionId])).rows)
      .toHaveLength(0);
    expect((await db.query(`select 1 from public.github_installations where id = $1::uuid`, [installationId])).rows)
      .toHaveLength(0);
    expect((await db.query(`select 1 from public.github_repositories where id = $1::uuid`, [repositoryId])).rows)
      .toHaveLength(0);

    // And the privileged functions refuse rather than silently doing nothing —
    // a no-op would look identical to success from the caller's side.
    await expect(
      db.query(`select public.mark_github_connection_lost($1::uuid, $2::uuid, 'installation_revoked')`,
        [outsiderId, connectionId]),
    ).rejects.toThrow();
    await expect(
      db.query(`select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)`,
        [outsiderId, connectionId, EXTERNAL_INSTALLATION]),
    ).rejects.toThrow();
  });

  it("denies an anonymous caller every GitHub table outright", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");

    for (const table of ["connections", "github_installations", "github_repositories", "github_change_requests"]) {
      await expect(db.query(`select 1 from public.${table}`), table).rejects.toThrow(/permission denied/i);
    }
    await db.exec("reset role");
  });

  it("lets a member read the connection but never mutate it", async () => {
    await actAs(db, memberId);
    // A member can see that a connection exists — that is not privileged.
    expect((await db.query(`select 1 from public.connections where id = $1::uuid`, [connectionId])).rows.length)
      .toBeGreaterThan(0);

    // Direct writes are closed to the browser role entirely, whatever the
    // member's organization role: mutation goes through audited functions.
    await expect(
      db.query(`update public.connections set status = 'connected' where id = $1::uuid`, [connectionId]),
    ).rejects.toThrow();
  });
});
