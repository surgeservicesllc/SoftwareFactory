// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Clearing the Autonomy list, against real PostgreSQL.
 *
 * The first design deleted projects and met three guards, the last of which
 * says by name that a project's append-only trail makes it permanent and that
 * archiving is the supported end of its life. So the interesting assertions
 * here are the ones proving this took that route instead:
 *
 *   * The list empties, because archived projects are excluded from it.
 *   * Nothing is deleted — the projects, their commands and their activity
 *     rows are all still there afterwards.
 *   * The deletion guard is untouched and still refuses.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000000a1";
const memberId = "00000000-0000-4000-8000-0000000000a2";
const organizationId = "10000000-0000-4000-8000-0000000000a1";

let db: PGlite;

async function asUser(userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1::text, false)", [userId]);
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
    [userId],
  );
}

async function makeProject(name: string): Promise<string> {
  await db.exec("reset role");
  const result = await db.query<{ id: string }>(
    `insert into public.projects (organization_id, name, status, created_by)
     values ($1, $2, 'active', $3) returning id`,
    [organizationId, name, ownerId],
  );
  return result.rows[0].id;
}

async function clearAutonomy(reason = "clearing the autonomy list") {
  return db.query<{ archived_count: number; already_archived: number }>(
    "select * from public.clear_autonomy_projects($1::uuid, $2::text)",
    [organizationId, reason],
  );
}

async function listedProjects(): Promise<string[]> {
  const result = await db.query<{ project_name: string }>(
    "select project_name from public.list_autonomy_status($1::uuid, 50)",
    [organizationId],
  );
  return result.rows.map((row) => row.project_name);
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
  const migrationFiles = (await readdir(migrationsRoot))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  expect(migrationFiles.at(-1)).toBe("20260830001100_grok_planning_failure.sql");
  for (const file of migrationFiles) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Autonomy Clear Co', 'autonomy-clear-co', '${ownerId}');
    insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict (organization_id, user_id) do update set role = 'member';
  `);
}, 240_000);

// Projects cannot be deleted by design, so each case archives what it made
// and the list filter keeps the cases independent.
beforeEach(async () => {
  await db.exec("reset role");
  await db.query(
    `update public.projects set status = 'archived'::public.project_status
      where organization_id = $1 and status <> 'archived'::public.project_status`,
    [organizationId],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("clear_autonomy_projects", () => {
  it("empties the autonomy list without deleting anything", async () => {
    await makeProject("Alpha");
    await makeProject("Beta");

    await asUser(ownerId);
    expect(await listedProjects()).toEqual(["Alpha", "Beta"]);

    const result = await clearAutonomy();
    expect(result.rows[0]).toMatchObject({ archived_count: 2 });

    // The whole point of the control: the section is empty afterwards.
    expect(await listedProjects()).toEqual([]);

    // And the whole point of doing it this way: the rows are still there.
    await db.exec("reset role");
    const rows = await db.query<{ total: number; archived: number }>(`
      select count(*)::int as total,
             count(*) filter (where status = 'archived'::public.project_status)::int as archived
        from public.projects where organization_id = $1`, [organizationId]);
    expect(rows.rows[0]).toEqual({ total: 2, archived: 2 });
  });

  it("counts projects that were already archived rather than claiming to have archived them", async () => {
    await makeProject("Fresh");
    const stale = await makeProject("Stale");
    await db.exec("reset role");
    await db.query(
      "update public.projects set status = 'archived'::public.project_status where id = $1",
      [stale],
    );

    await asUser(ownerId);
    const result = await clearAutonomy();
    // Only "Fresh" was active. `already_archived` also counts projects earlier
    // cases left archived, so it is asserted as a floor rather than an exact
    // number that would depend on test order.
    expect(result.rows[0].archived_count).toBe(1);
    expect(result.rows[0].already_archived).toBeGreaterThanOrEqual(1);
  });

  it("writes the archive reason into an immutable event for each project", async () => {
    await makeProject("Recorded");

    await asUser(ownerId);
    await clearAutonomy("clearing for the audit assertion");

    await db.exec("reset role");
    const events = await db.query<{ total: number }>(`
      select count(*)::int as total from public.activity_events
       where event_type = 'project.archived'::public.activity_event_type
         and organization_id = $1`, [organizationId]);
    expect(events.rows[0].total).toBeGreaterThanOrEqual(1);
  });

  it("refuses a member who does not manage the organization, and a short reason", async () => {
    await makeProject("Protected");

    await asUser(memberId);
    await expect(clearAutonomy()).rejects.toThrow(/only an owner or admin may clear the autonomy list/);

    await asUser(ownerId);
    await expect(clearAutonomy("short")).rejects.toThrow(/at least 10 characters/);

    expect(await listedProjects()).toEqual(["Protected"]);
  });

  it("is callable by a signed-in member only — never anon or service_role", async () => {
    await db.exec("reset role");
    const acl = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(`
      select has_function_privilege('anon', 'public.clear_autonomy_projects(uuid,text)', 'EXECUTE') as anon,
             has_function_privilege('authenticated', 'public.clear_autonomy_projects(uuid,text)', 'EXECUTE') as auth,
             has_function_privilege('service_role', 'public.clear_autonomy_projects(uuid,text)', 'EXECUTE') as service`);
    expect(acl.rows[0]).toEqual({ anon: false, auth: true, service: false });
  });
});

describe("the guards this design deliberately did not touch", () => {
  it("still refuses to delete a project, with the message that names archiving", async () => {
    const projectId = await makeProject("Undeletable");
    await db.exec("reset role");

    await expect(db.query("delete from public.projects where id = $1", [projectId]))
      .rejects.toThrow(/projects cannot be deleted/);
  });

  it("still refuses to mutate an activity event at all", async () => {
    await makeProject("Has a birth event");
    await db.exec("reset role");

    await expect(db.query(
      "update public.activity_events set project_id = null where project_id is not null",
    )).rejects.toThrow(/activity events are append-only/);
    await expect(db.query("delete from public.activity_events"))
      .rejects.toThrow(/activity events are append-only/);
  });
});
