// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Archiving a run, and the end of a report's life, against the real schema.
 *
 * The distinction these tests are built around is that archive and delete are
 * not two words for one thing:
 *
 *   Archiving is reversible, destroys nothing, and is available to an
 *   administrator. It answers "take this out of my way".
 *
 *   Deleting removes the row, is owner-only, requires a reason, and is recorded
 *   before it happens. It answers "this should not exist".
 *
 * A implementation that treated them as synonyms would pass a test that only
 * checked the row disappeared from a list, so these check what survived.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000005a1";
const adminId = "00000000-0000-4000-8000-0000000005a2";
const memberId = "00000000-0000-4000-8000-0000000005a3";
const organizationId = "10000000-0000-4000-8000-0000000005a1";
const projectId = "20000000-0000-4000-8000-0000000005a1";
const agentId = "60000000-0000-4000-8000-0000000005a1";
const taskId = "70000000-0000-4000-8000-0000000005a1";
const runId = "90000000-0000-4000-8000-0000000005a1";
const reportId = "a0000000-0000-4000-8000-0000000005a1";

let db: PGlite;

async function actAs(userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function seed(runStatus = "failed", reportStatus = "published") {
  await db.exec("reset role");
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${adminId}'), ('${memberId}');
    insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Lifecycle Factory', 'lifecycle-factory', '${ownerId}');
    insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${adminId}', 'admin'),
             ('${organizationId}', '${memberId}', 'member');
    insert into public.projects (id, organization_id, name, status, created_by)
      values ('${projectId}', '${organizationId}', 'Storefront', 'active', '${ownerId}');
    insert into public.agents (id, organization_id, name, role, status, created_by)
      values ('${agentId}', '${organizationId}', 'QA', 'qa', 'idle', '${ownerId}');
    insert into public.tasks (
      id, organization_id, project_id, assigned_agent_id, title, status, risk_level, created_by
    ) values (
      '${taskId}', '${organizationId}', '${projectId}', '${agentId}',
      'Audit the checkout copy', 'completed', 'green', '${ownerId}'
    );
    insert into public.agent_runs (
      id, organization_id, project_id, task_id, agent_id, status, provider, model,
      risk_level, base_branch, attempt_number, max_attempts, started_at, completed_at
    ) values (
      '${runId}', '${organizationId}', '${projectId}', '${taskId}', '${agentId}',
      '${runStatus}', 'openai', 'gpt-5.3-codex', 'green', 'main', 1, 2,
      now() - interval '5 minutes', now() - interval '1 minute'
    );
    insert into public.reports (
      id, organization_id, project_id, generated_by_agent_id, type, status,
      title, summary, published_at
    ) values (
      '${reportId}', '${organizationId}', '${projectId}', '${agentId}', 'quality',
      '${reportStatus}', 'Checkout copy audit', 'One finding, resolved.',
      ${reportStatus === "published" ? "now()" : "null"}
    );
  `);
}

describe("run archiving and report lifecycle", { timeout: 180_000 }, () => {
  beforeEach(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);
    const migrations = (await readdir(migrationsRoot))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    for (const migration of migrations) {
      await db.exec(await readFile(resolve(migrationsRoot, migration), "utf8"));
    }
  });

  afterEach(async () => {
    await db.close();
  });

  it("archives a finished run without destroying anything", async () => {
    await seed();
    await actAs(adminId);
    const { rows } = await db.query<{ archived_at: string | null }>(
      "select archived_at from public.set_agent_run_archived($1::uuid,$2::uuid,true,$3)",
      [organizationId, runId, "Dealt with"],
    );
    expect(rows[0].archived_at).not.toBeNull();

    await db.exec("reset role");
    // The row is still there. Archiving is a visibility decision, not a delete.
    const survived = await db.query("select 1 from public.agent_runs where id = $1", [runId]);
    expect(survived.rows).toHaveLength(1);
  });

  it("keeps the run's triage when archiving it", async () => {
    await seed();
    await actAs(ownerId);
    await db.query(
      "select * from public.update_agent_run_review($1::uuid,$2::uuid,'resolved',$3)",
      [organizationId, runId, "Re-ran and it passed."],
    );
    await db.query(
      "select * from public.set_agent_run_archived($1::uuid,$2::uuid,true,null)",
      [organizationId, runId],
    );

    await db.exec("reset role");
    const { rows } = await db.query<{ review_note: string; review_status: string }>(
      "select review_status, review_note from public.agent_runs where id = $1",
      [runId],
    );
    // The reason archived_at is its own column rather than a review status:
    // a run can be resolved *and* archived, and archiving must not rewrite
    // what a person decided.
    expect(rows[0]).toMatchObject({ review_status: "resolved" });
    expect(rows[0].review_note).toContain("passed");
  });

  it("takes an archived run out of the default list and puts it back", async () => {
    await seed();
    await actAs(ownerId);
    const before = await db.query("select id from public.list_agent_runs($1::uuid, 50)", [
      organizationId,
    ]);
    expect(before.rows).toHaveLength(1);

    await db.query(
      "select * from public.set_agent_run_archived($1::uuid,$2::uuid,true,null)",
      [organizationId, runId],
    );
    const during = await db.query("select id from public.list_agent_runs($1::uuid, 50)", [
      organizationId,
    ]);
    expect(during.rows).toHaveLength(0);

    // Still reachable when asked for, which is what makes it reversible rather
    // than a soft delete nobody can undo.
    const included = await db.query(
      "select id from public.list_agent_runs($1::uuid, 50, true)",
      [organizationId],
    );
    expect(included.rows).toHaveLength(1);

    await db.query(
      "select * from public.set_agent_run_archived($1::uuid,$2::uuid,false,null)",
      [organizationId, runId],
    );
    const after = await db.query("select id from public.list_agent_runs($1::uuid, 50)", [
      organizationId,
    ]);
    expect(after.rows).toHaveLength(1);
  });

  it("refuses to archive work that has not finished", async () => {
    await seed("running");
    await actAs(ownerId);
    // Hiding a live run would hide the thing most worth watching.
    await expect(
      db.query("select * from public.set_agent_run_archived($1::uuid,$2::uuid,true,null)", [
        organizationId, runId,
      ]),
    ).rejects.toThrow(/has not finished; cancel it/);
  });

  it("refuses run archiving to a plain member", async () => {
    await seed();
    await actAs(memberId);
    await expect(
      db.query("select * from public.set_agent_run_archived($1::uuid,$2::uuid,true,null)", [
        organizationId, runId,
      ]),
    ).rejects.toThrow(/owner or administrator/);
  });

  it("archives a report and restores it to the status it actually held", async () => {
    await seed("failed", "published");
    await actAs(adminId);
    const { rows: archived } = await db.query<{ status: string }>(
      "select status::text from public.set_report_archived($1::uuid,$2::uuid,true,null)",
      [organizationId, reportId],
    );
    expect(archived[0].status).toBe("archived");

    const { rows: restored } = await db.query<{ status: string }>(
      "select status::text from public.set_report_archived($1::uuid,$2::uuid,false,null)",
      [organizationId, reportId],
    );
    // Read from published_at rather than guessed: restoring must not quietly
    // demote a published report to a draft.
    expect(restored[0].status).toBe("published");
  });

  it("restores an unpublished report to draft, not to published", async () => {
    await seed("failed", "draft");
    await actAs(ownerId);
    await db.query("select * from public.set_report_archived($1::uuid,$2::uuid,true,null)", [
      organizationId, reportId,
    ]);
    const { rows } = await db.query<{ status: string }>(
      "select status::text from public.set_report_archived($1::uuid,$2::uuid,false,null)",
      [organizationId, reportId],
    );
    expect(rows[0].status).toBe("draft");
  });

  it("deletes a report, and the record of the deletion outlives it", async () => {
    await seed();
    await actAs(ownerId);
    await db.query("select * from public.delete_report($1::uuid,$2::uuid,$3)", [
      organizationId, reportId, "Superseded by the consolidated audit",
    ]);

    await db.exec("reset role");
    const gone = await db.query("select 1 from public.reports where id = $1", [reportId]);
    expect(gone.rows).toHaveLength(0);

    const { rows } = await db.query<{ entity_id: string; metadata: Record<string, unknown> }>(
      `select entity_id::text, metadata from public.activity_events
       where event_type = 'report.deleted'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_id).toBe(reportId);
    expect(rows[0].metadata).toMatchObject({
      reason: "Superseded by the consolidated audit",
      title: "Checkout copy audit",
    });
  });

  it("refuses report deletion without a reason, and to anyone but the owner", async () => {
    await seed();
    await actAs(ownerId);
    await expect(
      db.query("select * from public.delete_report($1::uuid,$2::uuid,$3)", [
        organizationId, reportId, "  ",
      ]),
    ).rejects.toThrow(/reason is required/);

    for (const userId of [adminId, memberId]) {
      await actAs(userId);
      await expect(
        db.query("select * from public.delete_report($1::uuid,$2::uuid,$3)", [
          organizationId, reportId, "Not mine to delete",
        ]),
        `${userId} must not delete`,
      ).rejects.toThrow(/only an organization owner/);
    }

    await db.exec("reset role");
    const survived = await db.query("select 1 from public.reports where id = $1", [reportId]);
    expect(survived.rows).toHaveLength(1);
  });

  it("clears archived reports only, leaving everything else alone", async () => {
    await seed("failed", "published");
    await db.exec("reset role");
    await db.query(
      `insert into public.reports (organization_id, project_id, type, status, title)
       values ($1, $2, 'quality', 'archived', 'Old audit one'),
              ($1, $2, 'quality', 'archived', 'Old audit two')`,
      [organizationId, projectId],
    );

    await actAs(ownerId);
    const { rows } = await db.query<{ deleted_count: number; kept_count: number }>(
      "select deleted_count, kept_count from public.delete_archived_reports($1::uuid,$2)",
      [organizationId, "Clearing the archive"],
    );
    expect(rows[0]).toEqual({ deleted_count: 2, kept_count: 0 });

    await db.exec("reset role");
    const remaining = await db.query<{ status: string; title: string }>(
      "select title, status::text from public.reports",
    );
    // The published report is untouched. "Clear" must not quietly mean "and
    // the ones nobody triaged".
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0]).toMatchObject({
      status: "published",
      title: "Checkout copy audit",
    });
  });

  it("grants service_role nothing on any of the four functions", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<Record<string, boolean>>(`
      select
        pg_catalog.has_function_privilege('service_role',
          'public.set_agent_run_archived(uuid,uuid,boolean,text)', 'EXECUTE') as archive_run,
        pg_catalog.has_function_privilege('service_role',
          'public.set_report_archived(uuid,uuid,boolean,text)', 'EXECUTE') as archive_report,
        pg_catalog.has_function_privilege('service_role',
          'public.delete_report(uuid,uuid,text)', 'EXECUTE') as delete_report,
        pg_catalog.has_function_privilege('service_role',
          'public.delete_archived_reports(uuid,text)', 'EXECUTE') as clear_reports
    `);
    expect(rows[0]).toEqual({
      archive_report: false,
      archive_run: false,
      clear_reports: false,
      delete_report: false,
    });
  });
});
