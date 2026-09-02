// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "../support/latest-migration";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

/**
 * The schedule bends (ADR-239) against the real chain: a bulk edit returns
 * one outcome per visit and the rest of the batch goes through; a project
 * is one visit per working day inside its span, counted live; cancelling
 * a project cancels what is not done and the timeline records each one.
 */

const acmeOwner = "00000000-0000-4000-8000-000000039001";
const rivalOwner = "00000000-0000-4000-8000-000000039002";
const acmeOrg = "10000000-0000-4000-8000-000000039001";
const rivalOrg = "10000000-0000-4000-8000-000000039002";

describe("bulk visit edit and multi-day projects", { timeout: 240_000 }, () => {
  let db: PGlite;
  let account = ""; let property = ""; let rosa = ""; let sam = ""; let branch = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function rejects(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("expected the statement to be rejected");
  }

  async function visit(day: string, technician: string | null, status = "scheduled") {
    return (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type, scheduled_start, scheduled_end, status, completed_at, created_by)
       values ($1, $2, $3, $4, 'General pest', ($5 || 'T09:00:00Z')::timestamptz, ($5 || 'T10:00:00Z')::timestamptz, $6::public.crm_work_order_status,
               case when $6 = 'completed' then ($5 || 'T10:00:00Z')::timestamptz else null end, $7)
       returning id`, [acmeOrg, account, property, technician, day, status, acmeOwner])).rows[0].id;
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        email text,
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
      grant usage on schema auth to anon, authenticated, service_role;
    `);
    const migrationFiles = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    expect(migrationFiles.at(-1)).toBe(LATEST_MIGRATION);
    for (const file of migrationFiles) {
      if (file === "20260830000500_services_crm_foundation.sql") {
        await db.exec(`
          alter default privileges in schema public grant all privileges on tables to authenticated;
          alter default privileges in schema public grant all privileges on tables to service_role;
        `);
      }
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }
    await db.exec(`
      insert into auth.users (id) values ('${acmeOwner}'), ('${rivalOwner}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${acmeOrg}', 'Acme Pest', 'acme-pest-bends', '${acmeOwner}'),
             ('${rivalOrg}', 'Rival Pest', 'rival-pest-bends', '${rivalOwner}');
    `);
    await as(acmeOwner);
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    property = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Plant', '1 Loaf Lane') returning id`, [acmeOrg, account])).rows[0].id;
    branch = (await db.query<{ id: string }>(
      `insert into public.crm_branches (organization_id, name, code, created_by) values ($1, 'North', 'NORTH', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    rosa = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Rosa', 'Vega', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    sam = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Sam', 'Ortiz', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
  });

  afterAll(async () => { await db?.close(); });

  it("edits many visits at once and answers for each: applied, completed-not-changed, on-a-route, not-found", async () => {
    await as(acmeOwner);
    const plain = await visit("2026-10-06", rosa);
    const done = await visit("2026-10-06", rosa, "completed");
    const routed = await visit("2026-10-06", rosa);
    const route = (await db.query<{ id: string }>(
      `insert into public.crm_routes (organization_id, technician_id, branch_id, route_date, name, created_by)
       values ($1, $2, $3, '2026-10-06', 'Tuesday north', $4) returning id`, [acmeOrg, rosa, branch, acmeOwner])).rows[0].id;
    await db.query(
      `insert into public.crm_route_stops (organization_id, route_id, work_order_id, position, created_by) values ($1, $2, $3, 1, $4)`,
      [acmeOrg, route, routed, acmeOwner]);
    const ghost = "80000000-0000-4000-8000-000000039999";

    const rows = (await db.query<{ work_order_id: string; applied: boolean; reason: string | null; technician_id: string | null; scheduled_start: string; status: string }>(
      `select * from public.crm_work_orders_bulk_edit($1, $2::uuid[], true, $3, 1, null)`,
      [acmeOrg, [plain, done, routed, ghost], sam])).rows;
    expect(rows.map((row) => [row.work_order_id, row.applied, row.reason])).toEqual([
      [plain, true, null],
      [done, false, "completed; not changed"],
      [routed, false, 'on route "Tuesday north" for 2026-10-06; take it off the route first'],
      [ghost, false, "not found in this workspace"],
    ]);
    expect(rows[0].technician_id).toBe(sam);
    expect(new Date(rows[0].scheduled_start).toISOString()).toBe("2026-10-07T09:00:00.000Z");

    // A status change alone leaves a routed visit where it is, and is recorded.
    const cancelled = (await db.query<{ applied: boolean; status: string }>(
      `select applied, status from public.crm_work_orders_bulk_edit($1, $2::uuid[], false, null, 0, 'cancelled')`,
      [acmeOrg, [routed]])).rows[0];
    expect(cancelled).toEqual({ applied: true, status: "cancelled" });
    expect((await db.query(`select 1 from public.crm_timeline_events where account_id = $1 and summary = 'Work order cancelled: General pest.'`, [account])).rows).toHaveLength(1);

    expect(await rejects(() => db.query(`select * from public.crm_work_orders_bulk_edit($1, $2::uuid[], false, null, 0, 'completed')`, [acmeOrg, [plain]]))).toMatch(/one at a time/);
    expect(await rejects(() => db.query(`select * from public.crm_work_orders_bulk_edit($1, $2::uuid[], false, null, 0, null)`, [acmeOrg, [plain]]))).toMatch(/nothing to change/);
    expect(await rejects(() => db.query(`select * from public.crm_work_orders_bulk_edit($1, '{}'::uuid[], true, null, 0, null)`, [acmeOrg]))).toMatch(/between one and two hundred/);

    // A rival editing acme's visits sees them as not found — RLS, not the function.
    await as(rivalOwner);
    expect((await db.query<{ reason: string }>(`select reason from public.crm_work_orders_bulk_edit($1, $2::uuid[], true, null, 0, null)`, [acmeOrg, [plain]])).rows[0].reason).toBe("not found in this workspace");
  });

  it("creates a project as one visit per working day, counts it live, and cancels what is not done", async () => {
    await as(acmeOwner);
    // Monday 2026-10-12 to Sunday 2026-10-18: five working days.
    const created = (await db.query<{ project_id: string; visits: number }>(
      `select * from public.crm_project_create($1, $2, $3, 'Plant fumigation', 'Fumigation', $4, '2026-10-12', '2026-10-18', '07:00', '15:30', false, 'Tent up Monday.')`,
      [acmeOrg, account, property, rosa])).rows[0];
    expect(created.visits).toBe(5);
    const days = (await db.query<{ day: string; technician_id: string; service_type: string }>(
      `select (scheduled_start at time zone 'UTC')::date::text as day, technician_id, service_type from public.crm_work_orders where project_id = $1 order by scheduled_start`, [created.project_id])).rows;
    expect(days.map((row) => row.day)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(days.every((row) => row.technician_id === rosa && row.service_type === "Fumigation")).toBe(true);
    const window = (await db.query<{ start: string; finish: string }>(
      `select to_char(scheduled_start at time zone 'UTC', 'HH24:MI') as start, to_char(scheduled_end at time zone 'UTC', 'HH24:MI') as finish from public.crm_work_orders where project_id = $1 limit 1`, [created.project_id])).rows[0];
    expect(window).toEqual({ start: "07:00", finish: "15:30" });

    // Weekends included: seven days. A span longer than 31 days, a weekend-only span without weekends, and an inverted window are refused.
    const weekend = (await db.query<{ visits: number }>(
      `select visits from public.crm_project_create($1, $2, $3, 'Weekend job', 'Fumigation', null, '2026-10-12', '2026-10-18', '07:00', '15:30', true)`, [acmeOrg, account, property])).rows[0];
    expect(weekend.visits).toBe(7);
    expect(await rejects(() => db.query(`select * from public.crm_project_create($1, $2, $3, 'Too long', 'Fumigation', null, '2026-10-01', '2026-11-15', '07:00', '15:30', false)`, [acmeOrg, account, property]))).toMatch(/crm_projects_span/);
    expect(await rejects(() => db.query(`select * from public.crm_project_create($1, $2, $3, 'Sat-Sun', 'Fumigation', null, '2026-10-17', '2026-10-18', '07:00', '15:30', false)`, [acmeOrg, account, property]))).toMatch(/no working day/);
    expect(await rejects(() => db.query(`select * from public.crm_project_create($1, $2, $3, 'Backwards', 'Fumigation', null, '2026-10-12', '2026-10-12', '15:00', '07:00', false)`, [acmeOrg, account, property]))).toMatch(/crm_projects_window/);

    // Progress, live: complete day one, cancel day two by bulk edit.
    const first = (await db.query<{ id: string }>(`select id from public.crm_work_orders where project_id = $1 order by scheduled_start limit 2`, [created.project_id])).rows;
    await db.query(`update public.crm_work_orders set status = 'completed', completed_at = now() where id = $1`, [first[0].id]);
    await db.query(`select * from public.crm_work_orders_bulk_edit($1, $2::uuid[], false, null, 0, 'cancelled')`, [acmeOrg, [first[1].id]]);
    let progress = (await db.query<{ name: string; days: number; completed: number; cancelled: number; remaining: number; next_day: string; state: string; technician_name: string; account_name: string; property_label: string }>(
      `select name, days, completed, cancelled, remaining, next_day::text, state, technician_name, account_name, property_label from public.crm_project_progress($1) order by name`, [acmeOrg])).rows;
    expect(progress.find((row) => row.name === "Plant fumigation")).toMatchObject({
      days: 5, completed: 1, cancelled: 1, remaining: 3, next_day: "2026-10-14", state: "active",
      technician_name: "Rosa Vega", account_name: "Harborview Foods", property_label: "Plant",
    });
    expect(progress.find((row) => row.name === "Weekend job")).toMatchObject({ days: 7, remaining: 7, state: "planned", technician_name: null });

    // Cancelling the project cancels the three left, records each, and leaves the completed day alone.
    const cancelledCount = (await db.query<{ n: number }>(`select public.crm_project_cancel($1, $2) as n`, [acmeOrg, created.project_id])).rows[0].n;
    expect(Number(cancelledCount)).toBe(3);
    progress = (await db.query<typeof progress[number]>(`select name, days, completed, cancelled, remaining, next_day::text, state, technician_name, account_name, property_label from public.crm_project_progress($1) order by name`, [acmeOrg])).rows;
    expect(progress.find((row) => row.name === "Plant fumigation")).toMatchObject({ completed: 1, cancelled: 4, remaining: 0, next_day: null, state: "cancelled" });
    expect((await db.query(`select 1 from public.crm_timeline_events where account_id = $1 and summary = 'Work order cancelled: Fumigation.'`, [account])).rows).toHaveLength(4);
    expect(await rejects(() => db.query(`select public.crm_project_cancel($1, $2)`, [acmeOrg, created.project_id]))).toMatch(/already cancelled/);

    // A rival sees no project.
    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_project_progress($1)`, [acmeOrg])).rows).toHaveLength(0);
  });

  it("fences the table and grants the functions to authenticated only", async () => {
    await db.exec("reset role");
    const fence = (await db.query<{ rls: boolean; forced: boolean }>(
      `select c.relrowsecurity as rls, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'crm_projects'`)).rows[0];
    expect(fence).toEqual({ rls: true, forced: true });
    const grants = (await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'crm_projects' and grantee in ('anon', 'authenticated', 'service_role') order by 1, 2`)).rows;
    expect(grants.map((row) => `${row.grantee}:${row.privilege_type}`)).toEqual(["authenticated:DELETE", "authenticated:INSERT", "authenticated:SELECT", "authenticated:UPDATE"]);
    const functions = (await db.query<{ name: string; definer: boolean; anon: boolean; authenticated: boolean; service: boolean }>(
      `select p.proname as name, p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('crm_work_orders_bulk_edit', 'crm_project_create', 'crm_project_progress', 'crm_project_cancel') order by 1`)).rows;
    expect(functions).toEqual([
      { name: "crm_project_cancel", definer: false, anon: false, authenticated: true, service: false },
      { name: "crm_project_create", definer: false, anon: false, authenticated: true, service: false },
      { name: "crm_project_progress", definer: false, anon: false, authenticated: true, service: false },
      { name: "crm_work_orders_bulk_edit", definer: false, anon: false, authenticated: true, service: false },
    ]);
  });
});
