// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Phase 1D decision visibility, against the real migrated schema.
 *
 * `autonomy_decisions` recorded every decision and nothing read it. An
 * append-only trail no surface can show is storage, not auditability, so these
 * assert the read path exists and reports the things that matter: why a
 * decision was refused, whether an approval was independent, and that the
 * interlocks travel beside the flags.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000f001";
const otherAuthorId = "00000000-0000-4000-8000-00000000f002";
const outsiderId = "00000000-0000-4000-8000-00000000f003";
const organizationId = "10000000-0000-4000-8000-00000000f001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000f002";
const projectId = "40000000-0000-4000-8000-00000000f001";

async function assumeRole(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("Phase 1D decision visibility", { timeout: 120_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${otherAuthorId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Loop Factory', 'loop-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other', 'other-loop', '${outsiderId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');

      insert into public.autonomy_decisions
        (organization_id, project_id, action, decision, risk, blockers, reached_stage,
         policy_version, author_id, approver_id)
      values
        ('${organizationId}', '${projectId}', 'merge', 'NOT_APPROVED', 'yellow',
         array['MERGE_EXECUTOR_NOT_CONNECTED'], 'merge', 'v1', '${ownerId}', null),
        ('${organizationId}', '${projectId}', 'deploy', 'OWNER_APPROVAL_REQUIRED', 'red',
         array['OWNER_APPROVAL_REQUIRED','DEPLOY_EXECUTOR_NOT_CONNECTED'], 'deploy', 'v1',
         '${ownerId}', null),
        ('${organizationId}', '${projectId}', 'review', 'APPROVED_AUTOMATICALLY', 'green',
         array[]::text[], 'review', 'v1', '${otherAuthorId}', '${ownerId}');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("makes the audit trail readable, newest first", async () => {
    await assumeRole(db, ownerId);
    const { rows } = await db.query<{ action: string; decision: string; blockers: string[] }>(
      "select action, decision, blockers from public.list_autonomy_decisions($1::uuid, 50)",
      [organizationId],
    );
    await resetRole(db);

    expect(rows).toHaveLength(3);
    // Refusals carry their reason, which is the entire point of recording them.
    const merge = rows.find((r) => r.action === "merge");
    expect(merge?.decision).toBe("NOT_APPROVED");
    expect(merge?.blockers).toContain("MERGE_EXECUTOR_NOT_CONNECTED");
  });

  it("says whether an approval was independent, without naming who", async () => {
    await assumeRole(db, ownerId);
    const { rows } = await db.query<{
      action: string; had_author: boolean; had_approver: boolean; independent_approval: boolean;
    }>(
      `select action, had_author, had_approver, independent_approval
         from public.list_autonomy_decisions($1::uuid, 50)`,
      [organizationId],
    );
    await resetRole(db);

    const approved = rows.find((r) => r.action === "review");
    // The rule the phase turns on, surfaced rather than left to be inferred.
    expect(approved).toMatchObject({
      had_author: true, had_approver: true, independent_approval: true,
    });

    const refused = rows.find((r) => r.action === "merge");
    expect(refused).toMatchObject({ had_approver: false, independent_approval: false });
  });

  it("never carries an approver or author identity to the caller", async () => {
    await assumeRole(db, ownerId);
    const { rows } = await db.query<Record<string, unknown>>(
      "select * from public.list_autonomy_decisions($1::uuid, 50)",
      [organizationId],
    );
    await resetRole(db);

    // Identities stay on the row for a targeted audit; a list does not need
    // them, and shipping them invites building a UI that shows them.
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(ownerId);
    expect(serialized).not.toContain(otherAuthorId);
    expect(Object.keys(rows[0])).not.toContain("author_id");
    expect(Object.keys(rows[0])).not.toContain("approver_id");
  });

  it("reports the interlocks beside the flags", async () => {
    await assumeRole(db, ownerId);
    const { rows } = await db.query<{
      project_name: string; kill_switch_active: boolean; executor_connected: boolean;
      enabled_action_count: number; total_action_count: number; decisions_recorded: number;
    }>("select * from public.list_autonomy_status($1::uuid, 50)", [organizationId]);
    await resetRole(db);

    expect(rows).toHaveLength(1);
    // Nine OFF actions without these two beside them could read as "ready but
    // idle" instead of "nothing could run".
    expect(rows[0]).toMatchObject({
      project_name: "Storefront",
      kill_switch_active: true,
      executor_connected: false,
      enabled_action_count: 0,
      total_action_count: 9,
      decisions_recorded: 3,
    });
  });

  it("cannot be made to report an enabled action, because none can be enabled", async () => {
    await resetRole(db);

    // The stronger fact, found by trying: the database refuses to turn an
    // action on at all. Enabling one is a RED action needing its own
    // owner-approved migration, and the constraint enforces that rather than
    // trusting callers. An earlier version of this test swallowed the error
    // and then asserted zero, which would have passed either way.
    await expect(db.query(
      "update public.projects set auto_review = true where id = $1",
      [projectId],
    )).rejects.toThrow();

    await assumeRole(db, ownerId);
    const { rows } = await db.query<{ enabled_action_count: number }>(
      "select enabled_action_count from public.list_autonomy_status($1::uuid, 50)",
      [organizationId],
    );
    await resetRole(db);

    expect(rows[0].enabled_action_count).toBe(0);

    // And the row itself never moved.
    const stored = await db.query<{ auto_review: boolean }>(
      "select auto_review from public.projects where id = $1",
      [projectId],
    );
    expect(stored.rows[0].auto_review).toBe(false);
  });

  it("refuses another organization's caller", async () => {
    await assumeRole(db, outsiderId);
    await expect(db.query(
      "select * from public.list_autonomy_decisions($1::uuid, 50)",
      [organizationId],
    )).rejects.toThrow(/membership is required/);
    await expect(db.query(
      "select * from public.list_autonomy_status($1::uuid, 50)",
      [organizationId],
    )).rejects.toThrow(/membership is required/);
    await resetRole(db);
  });

  it("bounds the page and is unreachable by the machine role", async () => {
    await assumeRole(db, ownerId);
    const { rows } = await db.query<{ count: string }>(
      "select count(*) as count from public.list_autonomy_decisions($1::uuid, 100000)",
      [organizationId],
    );
    expect(Number(rows[0].count)).toBeLessThanOrEqual(100);
    await resetRole(db);

    await db.exec("set role service_role");
    await expect(db.query(
      "select * from public.list_autonomy_decisions($1::uuid, 50)",
      [organizationId],
    )).rejects.toThrow(/permission denied/i);
    await resetRole(db);
  });

  it("reading the trail cannot change what the loop may do", async () => {
    await assumeRole(db, ownerId);
    const before = await db.query<{ enabled_action_count: number; kill_switch_active: boolean }>(
      "select enabled_action_count, kill_switch_active from public.list_autonomy_status($1::uuid, 50)",
      [organizationId],
    );
    await db.query("select * from public.list_autonomy_decisions($1::uuid, 50)", [organizationId]);
    const after = await db.query<{ enabled_action_count: number; kill_switch_active: boolean }>(
      "select enabled_action_count, kill_switch_active from public.list_autonomy_status($1::uuid, 50)",
      [organizationId],
    );
    await resetRole(db);

    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0].kill_switch_active).toBe(true);
  });
});
