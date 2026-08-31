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
 * The day route (ADR-220) against the real chain.
 *
 * This suite replays the chain rather than restoring the snapshot, and
 * injects hosted-like default privileges before the CRM foundation, because
 * it asserts that anon and service_role hold NOTHING on the new tables — and
 * a revoke only means something if the grant was there to revoke.
 *
 * What the route exists to prevent is somebody driving to the wrong place:
 * a stop on the wrong day, a visit on two routes, two routes for one
 * technician on one morning.
 */

const acmeOwner = "00000000-0000-4000-8000-000000020001";
const rivalOwner = "00000000-0000-4000-8000-000000020002";
const acmeOrg = "10000000-0000-4000-8000-000000020001";
const rivalOrg = "10000000-0000-4000-8000-000000020002";

describe("the day route", { timeout: 240_000 }, () => {
  let db: PGlite;

  let branch = "";
  let technician = "";
  let otherTechnician = "";
  let account = "";
  let property = "";
  let route = "";
  let visits: string[] = [];

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function newVisit(options: { day?: string; technicianId?: string | null } = {}) {
    const day = options.day ?? "2026-04-14";
    const created = await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, status, service_type,
          scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, $4, 'scheduled', 'Quarterly IPM',
               ($5 || 'T09:00:00Z')::timestamptz, ($5 || 'T11:00:00Z')::timestamptz, $6)
       returning id`,
      [acmeOrg, account, property,
        options.technicianId === undefined ? null : options.technicianId, day, acmeOwner],
    );
    return created.rows[0].id;
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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
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
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-routes', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-routes', '${rivalOwner}');
    `);

    await as(acmeOwner);
    branch = (await db.query<{ id: string }>(
      `insert into public.crm_branches (organization_id, name, code, created_by)
       values ($1, 'Harbor depot', 'HRB', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    technician = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Ada', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    otherTechnician = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Bram', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    property = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Plant', '4100 Cannery Row') returning id`,
      [acmeOrg, account],
    )).rows[0].id;

    route = (await db.query<{ id: string }>(
      `insert into public.crm_routes
         (organization_id, technician_id, branch_id, route_date, name, created_by)
       values ($1, $2, $3, '2026-04-14', 'Tuesday north', $4) returning id`,
      [acmeOrg, technician, branch, acmeOwner],
    )).rows[0].id;

    visits = [await newVisit(), await newVisit(), await newVisit()];
  });

  afterAll(async () => {
    await db?.close();
  });

  it("numbers the stops from one and reads them back in order", async () => {
    await as(acmeOwner);
    const placed = await db.query<{ crm_route_set_order: number }>(
      `select public.crm_route_set_order($1, $2::uuid[])`, [route, visits]);
    expect(placed.rows[0].crm_route_set_order).toBe(3);

    const sheet = await db.query<{ stop_position: number; stop_work_order: string }>(
      `select * from public.crm_route_sheet($1)`, [route]);
    expect(sheet.rows.map((row) => row.stop_position)).toEqual([1, 2, 3]);
    expect(sheet.rows.map((row) => row.stop_work_order)).toEqual(visits);
  });

  it("assigns an unrouted visit to the route's technician", async () => {
    await as(acmeOwner);
    // Putting a visit on a route IS the dispatch. It only ever fills a blank.
    const assigned = await db.query<{ technician_id: string }>(
      `select technician_id from public.crm_work_orders where id = $1`, [visits[0]]);
    expect(assigned.rows[0].technician_id).toBe(technician);
  });

  it("carries the dispatcher's own notes across a reorder", async () => {
    await as(acmeOwner);
    await db.query(
      `update public.crm_route_stops
          set planned_arrival = '2026-04-14T13:30:00Z', note = 'Gate code at the kiosk'
        where route_id = $1 and work_order_id = $2`, [route, visits[2]]);

    // Drag the last stop to the front. Losing what somebody typed on every
    // drag would make the feature unusable.
    await db.query(`select public.crm_route_set_order($1, $2::uuid[])`,
      [route, [visits[2], visits[0], visits[1]]]);

    const moved = await db.query<{ position: number; note: string; planned_arrival: string }>(
      `select position, note, planned_arrival from public.crm_route_stops
        where route_id = $1 and work_order_id = $2`, [route, visits[2]]);
    expect(moved.rows[0].position).toBe(1);
    expect(moved.rows[0].note).toBe("Gate code at the kiosk");
    expect(moved.rows[0].planned_arrival).not.toBeNull();
  });

  it("refuses a stop scheduled for another day, naming both", async () => {
    await as(acmeOwner);
    const wrongDay = await newVisit({ day: "2026-04-15" });
    await expect(
      db.query(`select public.crm_route_set_order($1, $2::uuid[])`,
        [route, [...visits, wrongDay]]),
    ).rejects.toThrow(/scheduled for 2026-04-15 and this route is for 2026-04-14/i);
  });

  it("refuses a visit that belongs to another technician", async () => {
    await as(acmeOwner);
    const someoneElses = await newVisit({ technicianId: otherTechnician });
    await expect(
      db.query(`select public.crm_route_set_order($1, $2::uuid[])`,
        [route, [...visits, someoneElses]]),
    ).rejects.toThrow(/belongs to another technician/i);
  });

  it("refuses the same visit twice in one order", async () => {
    await as(acmeOwner);
    await expect(
      db.query(`select public.crm_route_set_order($1, $2::uuid[])`,
        [route, [visits[0], visits[1], visits[0]]]),
    ).rejects.toThrow(/the same visit appears twice/i);
  });

  it("will not put one visit on two routes", async () => {
    await as(acmeOwner);
    const second = (await db.query<{ id: string }>(
      `insert into public.crm_routes
         (organization_id, technician_id, branch_id, route_date, created_by)
       values ($1, $2, $3, '2026-04-14', $4) returning id`,
      [acmeOrg, otherTechnician, branch, acmeOwner],
    )).rows[0].id;

    // visits[0] is already on the first route and already Ada's.
    await expect(
      db.query(`select public.crm_route_set_order($1, $2::uuid[])`, [second, [visits[0]]]),
    ).rejects.toThrow(/belongs to another technician|crm_route_stops_work_order_key/i);
  });

  it("will not hold two live routes for one technician on one day", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_routes
           (organization_id, technician_id, branch_id, route_date, created_by)
         values ($1, $2, $3, '2026-04-14', $4)`,
        [acmeOrg, technician, branch, acmeOwner]),
    ).rejects.toThrow(/crm_routes_one_per_technician_day_key/i);
  });

  it("will not resequence a route that is finished", async () => {
    await as(acmeOwner);
    const done = (await db.query<{ id: string }>(
      `insert into public.crm_routes
         (organization_id, technician_id, branch_id, route_date, status,
          released_at, completed_at, created_by)
       values ($1, $2, $3, '2026-04-20', 'completed',
               '2026-04-20T07:00:00Z', '2026-04-20T17:00:00Z', $4) returning id`,
      [acmeOrg, technician, branch, acmeOwner],
    )).rows[0].id;

    await expect(
      db.query(`select public.crm_route_set_order($1, $2::uuid[])`, [done, []]),
    ).rejects.toThrow(/a completed route cannot be resequenced/i);
  });

  it("gives anon and service_role nothing, despite hosted defaults", async () => {
    await db.exec("reset role");
    const grants = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('crm_routes', 'crm_route_stops')
          and grantee in ('anon', 'service_role', 'PUBLIC')`);
    // The revoke only means something because the injection above put the
    // hosted-like grants there first.
    expect(grants.rows[0].n).toBe(0);
  });

  it("keeps one workspace's routes out of another's", async () => {
    await as(rivalOwner);
    const visible = await db.query<{ n: number }>(
      `select count(*)::int as n from public.crm_routes`);
    expect(visible.rows[0].n).toBe(0);
  });
});
