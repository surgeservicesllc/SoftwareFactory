// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Phase 2B foundation, against the real migrated schema.
 *
 * The defect being closed: `task_dependencies` rejected a self-edge and a
 * duplicate, but not a cycle. A→B→A satisfied every constraint, and because
 * readiness is computed rather than stored, the graph would simply never become
 * ready again — with no row anywhere saying why.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000b0001";
const outsiderId = "00000000-0000-4000-8000-0000000b0002";
const organizationId = "10000000-0000-4000-8000-0000000b0001";
const projectId = "40000000-0000-4000-8000-0000000b0001";

async function actAs(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function makeTask(db: PGlite, title: string): Promise<string> {
  await db.exec("reset role");
  const { rows } = await db.query<{ id: string }>(
    `insert into public.tasks (organization_id, project_id, title, status, created_by)
     values ($1::uuid, $2::uuid, $3, 'backlog', $4::uuid) returning id`,
    [organizationId, projectId, title, ownerId],
  );
  return rows[0].id;
}

async function addDependency(db: PGlite, taskId: string, dependsOn: string) {
  await db.exec("reset role");
  return db.query(
    `insert into public.task_dependencies (organization_id, task_id, depends_on_task_id, created_by)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [organizationId, taskId, dependsOn, ownerId],
  );
}

describe("Phase 2B task graph and handoffs", () => {
  let db: PGlite;
  let a = "";
  let b = "";
  let c = "";

  beforeAll(async () => {
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

    const migrationFiles = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    expect(migrationFiles).toContain("20260814001000_phase2b_task_graph_and_handoffs.sql");
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Team Factory', 'team-factory', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');
    `);

    a = await makeTask(db, "Design");
    b = await makeTask(db, "Build");
    c = await makeTask(db, "Verify");
  });

  afterAll(async () => {
    await db.close();
  });

  it("accepts an acyclic chain", async () => {
    await addDependency(db, b, a);
    await addDependency(db, c, b);
    const { rows } = await db.query(`select count(*)::int as n from public.task_dependencies`);
    expect(rows[0]).toMatchObject({ n: 2 });
  });

  it("refuses the edge that would close a multi-hop cycle", async () => {
    // A→B→C exists. Making A depend on C closes the loop, and nothing in the
    // graph could ever become ready again.
    await expect(addDependency(db, a, c)).rejects.toThrow(/cycle/i);
  });

  it("still refuses a self-edge and a duplicate", async () => {
    // A self-edge is now reported as a cycle rather than by the CHECK
    // constraint, because a BEFORE trigger runs first — and a self-edge is a
    // cycle, so that message is the more useful of the two. Both refusals are
    // real; the assertion accepts either rather than pinning the mechanism.
    await expect(addDependency(db, a, a)).rejects.toThrow(/cycle|task_dependencies_distinct|violates check/i);
    await expect(addDependency(db, b, a)).rejects.toThrow(/task_dependencies_unique|duplicate key/i);
  });

  it("names a prerequisite that can never complete, instead of counting it as waiting", async () => {
    await db.exec("reset role");
    const dead = await makeTask(db, "Abandoned");
    const dependent = await makeTask(db, "Waiting on abandoned");
    await addDependency(db, dependent, dead);
    await db.query(`update public.tasks set status = 'cancelled' where id = $1::uuid`, [dead]);

    // Unmet still counts it, which is correct — it is not satisfied.
    const { rows: unmet } = await db.query<{ unmet: number }>(
      `select public.task_dependencies_unmet($1::uuid) as unmet`, [dependent],
    );
    expect(unmet[0].unmet).toBe(1);

    // But a cancelled prerequisite will never complete, so this is a permanent
    // block rather than ordinary waiting, and the two must be distinguishable.
    const { rows: stuck } = await db.query<{ blocking_title: string; blocking_status: string }>(
      `select blocking_title, blocking_status::text as blocking_status
       from public.task_dependencies_unsatisfiable($1::uuid)`, [dependent],
    );
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ blocking_title: "Abandoned", blocking_status: "cancelled" });

    // A task merely waiting on in-progress work is not reported as stuck.
    const { rows: notStuck } = await db.query(
      `select 1 from public.task_dependencies_unsatisfiable($1::uuid)`, [c],
    );
    expect(notStuck).toHaveLength(0);
  });

  it("computes readiness so no caller has to reimplement it", async () => {
    await db.exec("reset role");
    // B depends on A, which is not done.
    const { rows: blocked } = await db.query<{ unmet: number }>(
      `select public.task_dependencies_unmet($1::uuid) as unmet`, [b],
    );
    expect(blocked[0].unmet).toBe(1);

    await db.query(`update public.tasks set status = 'completed' where id = $1::uuid`, [a]);
    const { rows: ready } = await db.query<{ unmet: number }>(
      `select public.task_dependencies_unmet($1::uuid) as unmet`, [b],
    );
    expect(ready[0].unmet).toBe(0);

    // A has no prerequisites at all, so it was always ready.
    const { rows: root } = await db.query<{ unmet: number }>(
      `select public.task_dependencies_unmet($1::uuid) as unmet`, [a],
    );
    expect(root[0].unmet).toBe(0);
  });

  it("records a handoff between two different roles", async () => {
    await actAs(db, ownerId);
    const { rows } = await db.query<{ record_agent_handoff: string }>(
      `select public.record_agent_handoff(
         $1::uuid, 'backend'::public.agent_role, 'qa'::public.agent_role,
         'Implemented the endpoint and its tests.',
         'Verify the error paths against the acceptance criteria.',
         '["chose an additive migration"]'::jsonb, '["lib/api.ts"]'::jsonb)`,
      [b],
    );
    expect(rows[0].record_agent_handoff).toBeTruthy();
  });

  it("refuses a handoff to the same role, which would satisfy review with nobody independent", async () => {
    await actAs(db, ownerId);
    await expect(
      db.query(
        `select public.record_agent_handoff($1::uuid, 'qa'::public.agent_role, 'qa'::public.agent_role,
           'Reviewed my own work.', 'Ship it.')`,
        [b],
      ),
    ).rejects.toThrow(/agent_handoffs_distinct_roles|violates check/i);
  });

  it("refuses credential-shaped text in a handoff summary", async () => {
    await actAs(db, ownerId);
    await expect(
      db.query(
        `select public.record_agent_handoff($1::uuid, 'backend'::public.agent_role, 'qa'::public.agent_role,
           $2::text, 'Continue.')`,
        [b, `the key is sk-ant-api03-${"a".repeat(64)}`],
      ),
    ).rejects.toThrow(/not_sensitive|text_has_likely_secret|violates check/i);
  });

  it("keeps handoffs append-only", async () => {
    await db.exec("reset role");
    await expect(
      db.query(`update public.agent_handoffs set summary = 'rewritten'`),
    ).rejects.toThrow(/append-only/i);
  });

  it("locks a path prefix, and conflicts on overlap in both directions", async () => {
    await actAs(db, ownerId);
    const { rows: first } = await db.query<{ lock_id: string; acquired: boolean }>(
      `select lock_id, acquired from public.acquire_work_lock($1::uuid, 'lib/operations', $2::uuid, 'backend'::public.agent_role)`,
      [projectId, b],
    );
    expect(first[0].acquired).toBe(true);

    // A nested path is the same subsystem, so it must conflict.
    const { rows: nested } = await db.query<{ acquired: boolean; conflicting_prefix: string }>(
      `select acquired, conflicting_prefix from public.acquire_work_lock($1::uuid, 'lib/operations/probe.ts', $2::uuid, 'qa'::public.agent_role)`,
      [projectId, c],
    );
    expect(nested[0]).toMatchObject({ acquired: false, conflicting_prefix: "lib/operations" });

    // And the reverse: a parent of a held path overlaps it too.
    const { rows: parent } = await db.query<{ acquired: boolean }>(
      `select acquired from public.acquire_work_lock($1::uuid, 'lib', $2::uuid, 'qa'::public.agent_role)`,
      [projectId, c],
    );
    expect(parent[0].acquired).toBe(false);

    // An unrelated subsystem is free.
    const { rows: other } = await db.query<{ acquired: boolean }>(
      `select acquired from public.acquire_work_lock($1::uuid, 'components', $2::uuid, 'frontend'::public.agent_role)`,
      [projectId, c],
    );
    expect(other[0].acquired).toBe(true);

    // Releasing frees the prefix; releasing twice is not an error.
    expect((await db.query<{ release_work_lock: boolean }>(
      `select public.release_work_lock($1::uuid)`, [first[0].lock_id],
    )).rows[0].release_work_lock).toBe(true);
    expect((await db.query<{ release_work_lock: boolean }>(
      `select public.release_work_lock($1::uuid)`, [first[0].lock_id],
    )).rows[0].release_work_lock).toBe(false);

    const { rows: reacquired } = await db.query<{ acquired: boolean }>(
      `select acquired from public.acquire_work_lock($1::uuid, 'lib/operations', $2::uuid, 'qa'::public.agent_role)`,
      [projectId, c],
    );
    expect(reacquired[0].acquired).toBe(true);
  });

  it("refuses a lock path that reaches outside the repository", async () => {
    await actAs(db, ownerId);
    for (const bad of ["/etc/passwd", "lib/../../etc"]) {
      await expect(
        db.query(
          `select acquired from public.acquire_work_lock($1::uuid, $2::text, $3::uuid, 'backend'::public.agent_role)`,
          [projectId, bad, b],
        ),
        bad,
      ).rejects.toThrow(/violates check|work_locks_path_prefix_check/i);
    }
  });

  it("shows nothing to another organization and grants service_role nothing", async () => {
    await actAs(db, outsiderId);
    expect((await db.query(`select 1 from public.agent_handoffs`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.work_locks`)).rows).toHaveLength(0);

    await db.exec("reset role");
    const { rows } = await db.query(
      `select table_name from information_schema.role_table_grants
       where grantee = 'service_role' and table_name in ('agent_handoffs', 'work_locks')`,
    );
    expect(rows).toHaveLength(0);
  });
});
