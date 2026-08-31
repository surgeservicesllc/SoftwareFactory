// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * Choosing which GitHub repository an existing project connects to, against
 * the real migrated schema.
 *
 * `connect_github_project` binds a repository at project creation and is
 * unchanged. These tests defend the boundary of the two functions added for
 * projects that already exist: only an owner or administrator may move the
 * link, the one-non-archived-project-per-repository rule survives a relink and
 * names the project that holds the repository, a pending change reservation
 * freezes the binding, and every transition writes immutable activity
 * evidence.
 */


const ownerId = "00000000-0000-4000-8000-0000000000c1";
const memberId = "00000000-0000-4000-8000-0000000000c2";
const organizationId = "10000000-0000-4000-8000-0000000000c1";
const connectionId = "20000000-0000-4000-8000-0000000000c1";
const installationId = "30000000-0000-4000-8000-0000000000c1";
const repositoryAlphaId = "40000000-0000-4000-8000-0000000000c1";
const repositoryBetaId = "40000000-0000-4000-8000-0000000000c2";
const projectOneId = "50000000-0000-4000-8000-0000000000c1";
const projectTwoId = "50000000-0000-4000-8000-0000000000c2";

const externalAlpha = 610001;
const externalBeta = 610002;

async function assumeRole(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("project repository picker functions", { timeout: 180_000 }, () => {
  let db: PGlite;

  async function setRepository(
    userId: string,
    projectId: string,
    externalRepositoryId: number,
  ) {
    await assumeRole(db, userId);
    try {
      return await db.query<{
        connection_id: string;
        default_branch: string;
        github_repository: string;
        github_repository_id: string;
        project_id: string;
        project_name: string;
      }>(
        "select * from public.set_project_github_repository($1,$2,$3,$4)",
        [organizationId, projectId, connectionId, externalRepositoryId],
      );
    } finally {
      await resetRole(db);
    }
  }

  async function unlinkRepository(userId: string, projectId: string) {
    await assumeRole(db, userId);
    try {
      return await db.query<{
        previous_connection_id: string | null;
        previous_github_repository: string | null;
        previous_github_repository_id: string | null;
        project_id: string;
      }>(
        "select * from public.unlink_project_github_repository($1,$2)",
        [organizationId, projectId],
      );
    } finally {
      await resetRole(db);
    }
  }

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-picker', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;

      insert into public.connections (
        id, organization_id, name, provider, status, external_account_label,
        secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'Factory GitHub', 'github',
        'connected', 'factory', 'env://GITHUB_APP_CONFIGURATIONS', '${ownerId}'
      );

      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}',
        910001, 710001, 'factory-app', 810001, 'factory', 'Organization',
        'Organization', 'selected', 'active', now(), '${ownerId}'
      );

      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id, owner_login,
        name, full_name, default_branch, html_url, private, visibility,
        selected, github_updated_at
      ) values
        (
          '${repositoryAlphaId}', '${organizationId}', '${installationId}',
          ${externalAlpha}, 'factory', 'alpha', 'factory/alpha', 'main',
          'https://github.com/factory/alpha', true, 'private', true, now()
        ),
        (
          '${repositoryBetaId}', '${organizationId}', '${installationId}',
          ${externalBeta}, 'factory', 'beta', 'factory/beta', 'trunk',
          'https://github.com/factory/beta', true, 'private', true, now()
        );

      insert into public.projects (
        id, organization_id, name, status, default_branch, created_by
      ) values
        ('${projectOneId}', '${organizationId}', 'Project One', 'active', 'main', '${ownerId}'),
        ('${projectTwoId}', '${organizationId}', 'Project Two', 'active', 'main', '${ownerId}');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("keeps both functions unreachable for anon, public, and service_role", async () => {
    const { rows } = await db.query<Record<string, boolean>>(`
      select
        has_function_privilege('authenticated', 'public.set_project_github_repository(uuid,uuid,uuid,bigint)', 'EXECUTE') as authenticated_set,
        has_function_privilege('anon', 'public.set_project_github_repository(uuid,uuid,uuid,bigint)', 'EXECUTE') as anon_set,
        has_function_privilege('public', 'public.set_project_github_repository(uuid,uuid,uuid,bigint)', 'EXECUTE') as public_set,
        has_function_privilege('service_role', 'public.set_project_github_repository(uuid,uuid,uuid,bigint)', 'EXECUTE') as service_set,
        has_function_privilege('authenticated', 'public.unlink_project_github_repository(uuid,uuid)', 'EXECUTE') as authenticated_unlink,
        has_function_privilege('anon', 'public.unlink_project_github_repository(uuid,uuid)', 'EXECUTE') as anon_unlink,
        has_function_privilege('public', 'public.unlink_project_github_repository(uuid,uuid)', 'EXECUTE') as public_unlink,
        has_function_privilege('service_role', 'public.unlink_project_github_repository(uuid,uuid)', 'EXECUTE') as service_unlink
    `);
    expect(rows[0]).toEqual({
      anon_set: false,
      anon_unlink: false,
      authenticated_set: true,
      authenticated_unlink: true,
      public_set: false,
      public_unlink: false,
      service_set: false,
      service_unlink: false,
    });
  });

  it("refuses a plain member for both link and unlink", async () => {
    await expect(setRepository(memberId, projectOneId, externalAlpha))
      .rejects.toMatchObject({ code: "42501" });
    await expect(unlinkRepository(memberId, projectOneId))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("links an existing project to a repository and records the evidence", async () => {
    const result = await setRepository(ownerId, projectOneId, externalAlpha);
    expect(result.rows).toEqual([{
      connection_id: connectionId,
      default_branch: "main",
      github_repository: "factory/alpha",
      github_repository_id: repositoryAlphaId,
      project_id: projectOneId,
      project_name: "Project One",
    }]);

    const project = await db.query<{ default_branch: string; github_repository: string }>(
      "select github_repository, default_branch from public.projects where id = $1",
      [projectOneId],
    );
    expect(project.rows).toEqual([{ default_branch: "main", github_repository: "factory/alpha" }]);

    const link = await db.query<{ github_repository_id: string; is_primary: boolean }>(
      "select github_repository_id, is_primary from public.project_connections where project_id = $1",
      [projectOneId],
    );
    expect(link.rows).toEqual([{ github_repository_id: repositoryAlphaId, is_primary: true }]);

    const events = await db.query<{ transition: string }>(
      `select metadata ->> 'state_transition' as transition
       from public.activity_events
       where project_id = $1 and entity_type = 'project_repository_link'
       order by created_at`,
      [projectOneId],
    );
    expect(events.rows).toEqual([{ transition: "linked" }]);
  });

  it("refuses to link a repository another active project holds, naming that project", async () => {
    await expect(setRepository(ownerId, projectTwoId, externalAlpha)).rejects.toMatchObject({
      code: "55000",
      message: 'that repository is already linked to project "Project One"',
    });
  });

  it("changes the linked repository in place, freeing the previous one", async () => {
    const relinked = await setRepository(ownerId, projectOneId, externalBeta);
    expect(relinked.rows[0]).toMatchObject({
      default_branch: "trunk",
      github_repository: "factory/beta",
      github_repository_id: repositoryBetaId,
    });

    // Still exactly one link row for the project, now pointing at beta.
    const links = await db.query<{ github_repository_id: string }>(
      "select github_repository_id from public.project_connections where project_id = $1",
      [projectOneId],
    );
    expect(links.rows).toEqual([{ github_repository_id: repositoryBetaId }]);

    // Alpha is free, so the second project may take it now.
    const second = await setRepository(ownerId, projectTwoId, externalAlpha);
    expect(second.rows[0]).toMatchObject({ github_repository: "factory/alpha" });

    const relinkEvents = await db.query<{ transition: string }>(
      `select metadata ->> 'state_transition' as transition
       from public.activity_events
       where project_id = $1 and entity_type = 'project_repository_link'
       order by created_at`,
      [projectOneId],
    );
    expect(relinkEvents.rows).toEqual([{ transition: "linked" }, { transition: "relinked" }]);
  });

  it("freezes the binding while a change reservation is pending", async () => {
    await db.query(
      `insert into public.github_change_requests (
        organization_id, project_id, connection_id, repository_id,
        idempotency_key, execution_nonce, content_sha256, path,
        expected_blob_sha, base_branch, title, commit_message, created_by
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        organizationId,
        projectTwoId,
        connectionId,
        repositoryAlphaId,
        "picker-pending-001",
        "70000000-0000-4000-8000-0000000000c1",
        "a".repeat(64),
        "README.md",
        "b".repeat(40),
        "main",
        "Pending reservation",
        "Pending reservation",
        ownerId,
      ],
    );

    await expect(setRepository(ownerId, projectTwoId, externalBeta)).rejects.toMatchObject({
      code: "55000",
      message: "project has a pending GitHub change request; finish or fail it before changing the repository",
    });
    await expect(unlinkRepository(ownerId, projectTwoId)).rejects.toMatchObject({
      code: "55000",
      message: "project has a pending GitHub change request; finish or fail it before unlinking the repository",
    });

    await db.query(
      "update public.github_change_requests set status = 'failed' where idempotency_key = $1",
      ["picker-pending-001"],
    );
  });

  it("unlinks the repository, preserves history, and refuses a second unlink", async () => {
    const unlinked = await unlinkRepository(ownerId, projectOneId);
    expect(unlinked.rows[0]).toMatchObject({
      previous_connection_id: connectionId,
      previous_github_repository: "factory/beta",
      previous_github_repository_id: repositoryBetaId,
      project_id: projectOneId,
    });

    const project = await db.query<{ github_repository: string | null }>(
      "select github_repository from public.projects where id = $1",
      [projectOneId],
    );
    expect(project.rows).toEqual([{ github_repository: null }]);

    const links = await db.query(
      "select id from public.project_connections where project_id = $1",
      [projectOneId],
    );
    expect(links.rows).toEqual([]);

    const events = await db.query<{ transition: string }>(
      `select metadata ->> 'state_transition' as transition
       from public.activity_events
       where project_id = $1 and entity_type = 'project_repository_link'
       order by created_at`,
      [projectOneId],
    );
    expect(events.rows).toEqual([
      { transition: "linked" },
      { transition: "relinked" },
      { transition: "unlinked" },
    ]);

    await expect(unlinkRepository(ownerId, projectOneId)).rejects.toMatchObject({
      code: "55000",
      message: "project has no linked GitHub repository",
    });
  });

  it("refuses to move the link of an archived project", async () => {
    await db.query("update public.projects set status = 'archived' where id = $1", [projectOneId]);
    await expect(setRepository(ownerId, projectOneId, externalBeta)).rejects.toMatchObject({
      code: "55000",
      message: "an archived project cannot change its GitHub repository",
    });
    await db.query("update public.projects set status = 'active' where id = $1", [projectOneId]);
  });
});
