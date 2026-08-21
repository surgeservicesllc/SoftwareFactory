// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Selecting a pipeline for a project, checked against the real migration
 * chain.
 *
 * The behaviour the owner asked for is that pressing Use *sticks*: many
 * templates can be selected, the selection survives, and it is readable back
 * on another surface. Sticking is only worth anything if it also fails
 * closed, so the same suite proves an unrelated member cannot select, a
 * plain member cannot select, and anonymous can neither read nor write.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000004a1";
const memberId = "00000000-0000-4000-8000-0000000004a2";
const outsiderId = "00000000-0000-4000-8000-0000000004a3";
const organizationId = "10000000-0000-4000-8000-0000000004b1";
const otherOrganizationId = "10000000-0000-4000-8000-0000000004b2";
const projectId = "40000000-0000-4000-8000-0000000004c1";
const secondProjectId = "40000000-0000-4000-8000-0000000004c2";
const archivedProjectId = "40000000-0000-4000-8000-0000000004c3";
const outsideProjectId = "40000000-0000-4000-8000-0000000004c4";

type SelectionRow = {
  pipeline_id: string;
  pipeline_template_key: string;
  pipeline_template_id: string | null;
  pipeline_created: boolean;
};

describe("project pipeline selection", () => {
  let db: PGlite;

  async function asUser(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function asAnonymous() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");
  }

  async function asSuperuser() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }

  async function select(organization: string, project: string, key: string) {
    return db.query<SelectionRow>(
      "select * from public.select_project_pipeline($1, $2, $3)",
      [organization, project, key],
    );
  }

  async function deselect(organization: string, project: string, key: string) {
    return db.query<{ pipeline_removed: boolean }>(
      "select * from public.deselect_project_pipeline($1, $2, $3)",
      [organization, project, key],
    );
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
    for (const migrationFile of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Pipeline Tenant', 'pipeline-tenant', '${ownerId}'),
        ('${otherOrganizationId}', 'Other Tenant', 'other-pipeline-tenant', '${outsiderId}');
      insert into public.organization_members (organization_id, user_id, role) values
        ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
      insert into public.projects (id, organization_id, name, status, github_repository, default_branch, created_by) values
        ('${projectId}', '${organizationId}', 'Factory One', 'active', 'tenant/one', 'main', '${ownerId}'),
        ('${secondProjectId}', '${organizationId}', 'Factory Two', 'active', 'tenant/two', 'main', '${ownerId}'),
        ('${archivedProjectId}', '${organizationId}', 'Retired', 'archived', 'tenant/retired', 'main', '${ownerId}'),
        ('${outsideProjectId}', '${otherOrganizationId}', 'Elsewhere', 'active', 'other/app', 'main', '${outsiderId}');
    `);
    await db.exec("reset role");
  }, 240_000);

  afterAll(async () => {
    await db.close();
  });

  it("records a built-in selection with no template row and reports that it created one", async () => {
    await asUser(ownerId);
    const first = await select(organizationId, projectId, "production_readiness");

    expect(first.rows[0]?.pipeline_created).toBe(true);
    expect(first.rows[0]?.pipeline_template_key).toBe("production_readiness");
    // A built-in lives in source, versioned by review. There is no row for it
    // to point at, and inventing one would make code look like data.
    expect(first.rows[0]?.pipeline_template_id).toBeNull();
  });

  it("keeps many selections for one project, which is the point of the toggle", async () => {
    await asUser(ownerId);
    await select(organizationId, projectId, "security_audit");
    await select(organizationId, projectId, "rls_audit");

    const listed = await db.query<{ pipeline_template_key: string }>(
      "select pipeline_template_key from public.list_project_pipelines($1) where pipeline_project_id = $2",
      [organizationId, projectId],
    );
    expect(listed.rows.map((row) => row.pipeline_template_key).sort()).toEqual([
      "production_readiness",
      "rls_audit",
      "security_audit",
    ]);
  });

  it("treats a second press of Use as the same intention, not an error", async () => {
    await asUser(ownerId);
    const again = await select(organizationId, projectId, "security_audit");

    expect(again.rows[0]?.pipeline_created).toBe(false);
    const count = await db.query<{ total: number }>(
      "select count(*)::int as total from public.list_project_pipelines($1) where pipeline_project_id = $2 and pipeline_template_key = 'security_audit'",
      [organizationId, projectId],
    );
    expect(count.rows[0]?.total).toBe(1);
  });

  it("writes one activity event per real change and none for a repeat", async () => {
    await asSuperuser();
    const events = await db.query<{ event_type: string; entity_type: string }>(
      `select event_type::text as event_type, entity_type
       from public.activity_events
       where project_id = $1 and event_type::text like 'pipeline.%'
       order by occurred_at asc`,
      [projectId],
    );
    expect(events.rows).toHaveLength(3);
    expect(events.rows.every((row) => row.entity_type === "project_pipeline")).toBe(true);
    expect(events.rows.every((row) => row.event_type === "pipeline.selected")).toBe(true);
  });

  it("scopes a selection to its own project", async () => {
    await asUser(ownerId);
    await select(organizationId, secondProjectId, "bug_sweep");

    const listed = await db.query<{ pipeline_project_id: string; pipeline_template_key: string }>(
      "select pipeline_project_id, pipeline_template_key from public.list_project_pipelines($1)",
      [organizationId],
    );
    const forSecond = listed.rows.filter((row) => row.pipeline_project_id === secondProjectId);
    expect(forSecond.map((row) => row.pipeline_template_key)).toEqual(["bug_sweep"]);
    expect(listed.rows.filter((row) => row.pipeline_project_id === projectId)).toHaveLength(3);
  });

  it("removes a selection and says so, and says nothing changed when it was not selected", async () => {
    await asUser(ownerId);
    const removed = await deselect(organizationId, projectId, "rls_audit");
    expect(removed.rows[0]?.pipeline_removed).toBe(true);

    const absent = await deselect(organizationId, projectId, "rls_audit");
    expect(absent.rows[0]?.pipeline_removed).toBe(false);

    await asSuperuser();
    const events = await db.query<{ total: number }>(
      `select count(*)::int as total from public.activity_events
       where project_id = $1 and event_type::text = 'pipeline.deselected'`,
      [projectId],
    );
    expect(events.rows[0]?.total).toBe(1);
  });

  it("resolves a custom template to its row so deleting the template takes the selection with it", async () => {
    await asUser(ownerId);
    const created = await db.query<{ template_id: string }>(
      `select template_id from public.create_pipeline_template(
         $1, 'house_style_audit', 'House style audit', 'Checks the things this house cares about.',
         'AUDIT', 'review', $2::jsonb, 'DIAMOND'::public.graph_topology
       )`,
      [organizationId, JSON.stringify([{ id: "area_1", job: "Check naming and comment density against the surrounding code." }])],
    );
    const templateId = created.rows[0]?.template_id ?? "";
    expect(templateId).not.toBe("");

    const selected = await select(organizationId, projectId, "house_style_audit");
    expect(selected.rows[0]?.pipeline_template_id).toBe(templateId);

    const named = await db.query<{ pipeline_template_name: string | null }>(
      "select pipeline_template_name from public.list_project_pipelines($1) where pipeline_template_key = 'house_style_audit'",
      [organizationId],
    );
    expect(named.rows[0]?.pipeline_template_name).toBe("House style audit");

    await db.query("select public.delete_pipeline_template($1, $2)", [organizationId, templateId]);
    const afterDelete = await db.query<{ total: number }>(
      "select count(*)::int as total from public.list_project_pipelines($1) where pipeline_template_key = 'house_style_audit'",
      [organizationId],
    );
    // The template is gone, so the selection pointing at it is gone too. A
    // selection naming a template that no longer exists is a dangling claim.
    expect(afterDelete.rows[0]?.total).toBe(0);
  });

  it("refuses an archived project, which cannot change what it runs", async () => {
    await asUser(ownerId);
    await expect(select(organizationId, archivedProjectId, "bug_sweep")).rejects.toThrow(
      /archived project cannot change its pipelines/i,
    );
  });

  it("refuses a project id that does not belong to the organization it was given", async () => {
    await asUser(ownerId);
    // `can_manage_project` reads the project's *own* organization, so the
    // pair still has to be checked or a caller could attribute a selection
    // across a tenant boundary.
    await expect(select(otherOrganizationId, projectId, "bug_sweep")).rejects.toThrow(
      /project was not found/i,
    );
  });

  it("refuses a member who is not an owner or administrator", async () => {
    await asUser(memberId);
    await expect(select(organizationId, projectId, "test_coverage")).rejects.toThrow(
      /owner or administrator access is required/i,
    );
    await expect(deselect(organizationId, projectId, "security_audit")).rejects.toThrow(
      /owner or administrator access is required/i,
    );
  });

  it("lets that same member read what the owner selected", async () => {
    await asUser(memberId);
    const listed = await db.query<{ pipeline_template_key: string }>(
      "select pipeline_template_key from public.list_project_pipelines($1) where pipeline_project_id = $2",
      [organizationId, projectId],
    );
    expect(listed.rows.map((row) => row.pipeline_template_key).sort()).toEqual([
      "production_readiness",
      "security_audit",
    ]);
  });

  it("refuses an unrelated user entirely, in both directions", async () => {
    await asUser(outsiderId);
    await expect(select(organizationId, projectId, "bug_sweep")).rejects.toThrow(
      /owner or administrator access is required/i,
    );
    await expect(
      db.query("select * from public.list_project_pipelines($1)", [organizationId]),
    ).rejects.toThrow(/organization membership is required/i);
  });

  it("refuses anonymous, and gives it no table to read either", async () => {
    await asAnonymous();
    await expect(select(organizationId, projectId, "bug_sweep")).rejects.toThrow();
    await expect(
      db.query("select * from public.list_project_pipelines($1)", [organizationId]),
    ).rejects.toThrow();
    await expect(db.query("select * from public.project_pipelines")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("gives no direct write path to a browser role, only the audited function", async () => {
    await asUser(ownerId);
    await expect(
      db.query(
        `insert into public.project_pipelines (organization_id, project_id, template_key, selected_by)
         values ($1, $2, 'smuggled_in', $3)`,
        [organizationId, projectId, ownerId],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a template key that is not a key", async () => {
    await asUser(ownerId);
    await expect(select(organizationId, projectId, "Not A Key")).rejects.toThrow(
      /template key is 1-80 characters/i,
    );
  });

  it("keeps an archived project's selections as the record of what it ran", async () => {
    // A project is never deleted here — the append-only activity trail
    // restricts it, and archive_project is the supported end of life. So the
    // question a selection has to answer is what archiving does to it, and
    // the answer is nothing: it is history, and history is not edited.
    await asUser(ownerId);
    await select(organizationId, secondProjectId, "code_review");
    await db.query("select * from public.archive_project($1, $2)", [secondProjectId, "retired by the owner"]);

    const kept = await db.query<{ pipeline_template_key: string }>(
      "select pipeline_template_key from public.list_project_pipelines($1) where pipeline_project_id = $2",
      [organizationId, secondProjectId],
    );
    expect(kept.rows.map((row) => row.pipeline_template_key).sort()).toEqual([
      "bug_sweep",
      "code_review",
    ]);
    await expect(select(organizationId, secondProjectId, "test_coverage")).rejects.toThrow(
      /archived project cannot change its pipelines/i,
    );
  });
});
