// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LATEST_MIGRATION } from "../support/latest-migration";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = LATEST_MIGRATION;

/**
 * Equipment and fleet (ADR-201) against the real chain.
 *
 * The shape is the IPM station's (ADR-191): an append-only ledger, with
 * state as a projection of it. So the tests that matter are the ones that
 * try to make state and history disagree — a status written around the
 * ledger, an asset with no acquisition behind it, a transfer to nobody
 * recorded as an assignment.
 *
 * Two are specific to fleet, and both are the kind that pass silently if
 * you get them wrong: a meter that runs backwards, and a service schedule
 * that treats "nobody said" as "not due".
 */

const acmeOwner = "00000000-0000-4000-8000-00000000f301";
const rivalOwner = "00000000-0000-4000-8000-00000000f302";
const acmeOrg = "10000000-0000-4000-8000-00000000f301";
const rivalOrg = "10000000-0000-4000-8000-00000000f302";

describe("equipment and fleet", { timeout: 240_000 }, () => {
  let db: PGlite;
  let truck = "";
  let sprayer = "";
  let dana = "";
  let sam = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function reset() {
    await db.exec("reset role");
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
    expect(migrationFiles.at(-1)).toBe(latestMigration);
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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest', '${rivalOwner}');
    `);
    await reset();
  });

  afterAll(async () => {
    await db?.close();
  });

  it("puts an asset on the roster, born with its own acquisition event", async () => {
    await as(acmeOwner);
    const dana_ = await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Dana', 'Okafor', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    dana = dana_.rows[0].id;
    const sam_ = await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Sam', 'Trevino', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    sam = sam_.rows[0].id;

    const created = await db.query<{ id: string }>(
      `insert into public.crm_equipment
         (organization_id, asset_tag, kind, name, make, model, meter_reading, meter_unit,
          meter_read_at, service_interval_days, purchased_on, created_by)
       values ($1, 'TRUCK-04', 'vehicle', 'Service truck 4', 'Ford', 'Transit',
               42000, 'miles', now(), 180, current_date - 400, $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    truck = created.rows[0].id;

    // Nothing predates its own record: the acquisition is written by
    // trigger, not by the caller remembering to.
    const { rows } = await db.query<{ kind: string; meter_reading: string }>(
      `select kind::text, meter_reading::text from public.crm_equipment_events
        where equipment_id = $1`,
      [truck],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("acquired");
    expect(rows[0].meter_reading).toBe("42000.0");

    const spray = await db.query<{ id: string }>(
      `insert into public.crm_equipment
         (organization_id, asset_tag, kind, name, created_by)
       values ($1, 'SPRAY-11', 'sprayer', 'Backpack sprayer 11', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    sprayer = spray.rows[0].id;
    await reset();
  });

  it("refuses a meter that runs backwards, and names both readings", async () => {
    await as(acmeOwner);
    // A transposed digit: 24,000 where 42,000 was recorded. Accepting it
    // would corrupt every service interval computed from it afterwards.
    await expect(
      db.query(
        `insert into public.crm_equipment_events
           (organization_id, equipment_id, kind, meter_reading, created_by)
         values ($1, $2, 'meter_reading', 24000, $3)`,
        [acmeOrg, truck, acmeOwner],
      ),
    ).rejects.toThrow(/a meter does not run backwards: reading 24000.0 is below the recorded 42000.0/);

    // The real reading lands, and the asset carries it.
    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, meter_reading, created_by)
       values ($1, $2, 'meter_reading', 43250, $3)`,
      [acmeOrg, truck, acmeOwner],
    );
    const { rows } = await db.query<{ meter_reading: string; meter_unit: string }>(
      `select meter_reading::text, meter_unit from public.crm_equipment where id = $1`,
      [truck],
    );
    expect(rows[0].meter_reading).toBe("43250.0");
    expect(rows[0].meter_unit).toBe("miles");
    await reset();
  });

  it("assigns and transfers through the ledger, never around it", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, technician_id, created_by)
       values ($1, $2, 'assigned', $3, $4)`,
      [acmeOrg, truck, dana, acmeOwner],
    );
    let state = await db.query<{ assigned_technician_id: string | null }>(
      `select assigned_technician_id from public.crm_equipment where id = $1`,
      [truck],
    );
    expect(state.rows[0].assigned_technician_id).toBe(dana);

    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, technician_id, created_by)
       values ($1, $2, 'assigned', $3, $4)`,
      [acmeOrg, truck, sam, acmeOwner],
    );
    state = await db.query<{ assigned_technician_id: string | null }>(
      `select assigned_technician_id from public.crm_equipment where id = $1`,
      [truck],
    );
    expect(state.rows[0].assigned_technician_id).toBe(sam);

    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, created_by)
       values ($1, $2, 'unassigned', $3)`,
      [acmeOrg, truck, acmeOwner],
    );
    state = await db.query<{ assigned_technician_id: string | null }>(
      `select assigned_technician_id from public.crm_equipment where id = $1`,
      [truck],
    );
    expect(state.rows[0].assigned_technician_id).toBeNull();
    await reset();
  });

  it("refuses an assignment to nobody", async () => {
    await as(acmeOwner);
    // A transfer to nobody is `unassigned`. An `assigned` event with no
    // technician is a row that says something happened without saying to
    // whom.
    await expect(
      db.query(
        `insert into public.crm_equipment_events
           (organization_id, equipment_id, kind, created_by)
         values ($1, $2, 'assigned', $3)`,
        [acmeOrg, truck, acmeOwner],
      ),
    ).rejects.toThrow(/crm_equipment_events_assigned_has_technician/);
    await reset();
  });

  it("moves through repair and back by the ledger", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, vendor, cost_cents, note, created_by)
       values ($1, $2, 'repair_opened', 'Cedar Point Motors', 84000, 'Clutch.', $3)`,
      [acmeOrg, truck, acmeOwner],
    );
    let state = await db.query<{ status: string }>(
      `select status::text from public.crm_equipment where id = $1`,
      [truck],
    );
    expect(state.rows[0].status).toBe("in_repair");

    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, created_by)
       values ($1, $2, 'repair_closed', $3)`,
      [acmeOrg, truck, acmeOwner],
    );
    state = await db.query<{ status: string }>(
      `select status::text from public.crm_equipment where id = $1`,
      [truck],
    );
    expect(state.rows[0].status).toBe("in_service");
    await reset();
  });

  it("reports a service schedule, and calls an asset with no interval unscheduled", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, cost_cents, vendor, created_by)
       values ($1, $2, 'service', 32000, 'Cedar Point Motors', $3)`,
      [acmeOrg, truck, acmeOwner],
    );

    const { rows } = await db.query<{
      asset_tag: string; next_service_due: string | null; days_until_service: number | null; events: number;
    }>(
      `select asset_tag, next_service_due::text, days_until_service, events
         from public.crm_fleet_status() order by asset_tag`,
    );
    const serviced = rows.find((row) => row.asset_tag === "TRUCK-04");
    const unscheduled = rows.find((row) => row.asset_tag === "SPRAY-11");

    // Serviced today on a 180-day interval.
    const expected = await db.query<{ d: string }>(
      "select (current_date + 180)::text as d",
    );
    expect(serviced?.next_service_due).toBe(expected.rows[0].d);
    expect(serviced?.days_until_service).toBe(180);

    // No interval on file. Unscheduled is not "not due", and reporting a
    // date here would be inventing a schedule nobody set.
    expect(unscheduled?.next_service_due).toBeNull();
    expect(unscheduled?.days_until_service).toBeNull();
    await reset();
  });

  it("treats a scheduled asset that was never serviced as due from purchase", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_equipment
         (organization_id, asset_tag, kind, name, service_interval_days, purchased_on, created_by)
       values ($1, 'METER-02', 'meter', 'Moisture meter 2', 90, current_date - 400, $2)`,
      [acmeOrg, acmeOwner],
    );
    const { rows } = await db.query<{ days_until_service: number }>(
      `select days_until_service from public.crm_fleet_status() where asset_tag = 'METER-02'`,
    );
    // Bought 400 days ago on a 90-day schedule and never serviced: overdue
    // since new, which is a real finding rather than a null.
    expect(rows[0].days_until_service).toBe(-310);
    await reset();
  });

  it("closes an asset out, unassigns it, and refuses anything after", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, technician_id, created_by)
       values ($1, $2, 'assigned', $3, $4)`,
      [acmeOrg, sprayer, dana, acmeOwner],
    );
    await db.query(
      `insert into public.crm_equipment_events
         (organization_id, equipment_id, kind, note, created_by)
       values ($1, $2, 'retired', 'Cracked tank.', $3)`,
      [acmeOrg, sprayer, acmeOwner],
    );

    const { rows } = await db.query<{ status: string; assigned_technician_id: string | null; retired_on: string }>(
      `select status::text, assigned_technician_id, retired_on::text
         from public.crm_equipment where id = $1`,
      [sprayer],
    );
    expect(rows[0].status).toBe("retired");
    // Nothing in the field belongs to somebody once it is off the roster.
    expect(rows[0].assigned_technician_id).toBeNull();
    expect(rows[0].retired_on).not.toBeNull();

    await expect(
      db.query(
        `insert into public.crm_equipment_events
           (organization_id, equipment_id, kind, meter_reading, created_by)
         values ($1, $2, 'meter_reading', 5, $3)`,
        [acmeOrg, sprayer, acmeOwner],
      ),
    ).rejects.toThrow(/that asset is retired/);
    await reset();
  });

  it("will not hold a retired asset that still has a date-free status", async () => {
    await as(acmeOwner);
    // status and retired_on agree, or neither is trustworthy.
    await expect(
      db.query(
        `insert into public.crm_equipment
           (organization_id, asset_tag, kind, name, status, created_by)
         values ($1, 'GHOST-01', 'other', 'Ghost', 'retired', $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_equipment_retired_iff_dated/);
    await reset();
  });

  it("refuses half a meter reading", async () => {
    await as(acmeOwner);
    // A number with no unit and no moment is not a reading.
    await expect(
      db.query(
        `insert into public.crm_equipment
           (organization_id, asset_tag, kind, name, meter_reading, created_by)
         values ($1, 'HALF-01', 'vehicle', 'Half', 100, $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_equipment_meter_complete/);
    await reset();
  });

  it("keeps an asset tag unique per company and reusable across companies", async () => {
    await as(acmeOwner);
    // Typed one-handed on a phone, in the case that came out. It is the
    // same sticker, so it must collide rather than create a second asset —
    // and it must reach the index to do so, which an over-strict CHECK
    // would have prevented.
    await expect(
      db.query(
        `insert into public.crm_equipment (organization_id, asset_tag, kind, name, created_by)
         values ($1, 'truck-04', 'vehicle', 'Duplicate', $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_equipment_org_tag_key/);
    await reset();

    // The rival runs a TRUCK-04 too, and that is not our business.
    await as(rivalOwner);
    const theirs = await db.query<{ id: string }>(
      `insert into public.crm_equipment (organization_id, asset_tag, kind, name, created_by)
       values ($1, 'TRUCK-04', 'vehicle', 'Their truck 4', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    expect(theirs.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);

    // And their fleet report shows one asset: ours is invisible.
    const { rows } = await db.query<{ asset_tag: string }>(
      `select asset_tag from public.crm_fleet_status()`,
    );
    expect(rows.map((row) => row.asset_tag)).toEqual(["TRUCK-04"]);
    await reset();
  });

  it("keeps the ledger append-only and the asset undeletable", async () => {
    await reset();
    const { rows } = await db.query<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('crm_equipment', 'crm_equipment_events')
          and grantee in ('anon', 'authenticated', 'service_role')
        order by table_name, privilege_type`,
    );
    expect(rows.every((row) => row.grantee === "authenticated")).toBe(true);
    // The ledger takes rows and gives them back. Nothing else.
    expect(
      rows.filter((row) => row.table_name === "crm_equipment_events").map((row) => row.privilege_type).sort(),
    ).toEqual(["INSERT", "SELECT"]);
    // A truck that leaves the fleet is retired, not deleted.
    expect(
      rows.filter((row) => row.table_name === "crm_equipment").map((row) => row.privilege_type).sort(),
    ).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("gives anon and service_role nothing, and keeps the report an invoker", async () => {
    await reset();
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join unnest(array['anon', 'service_role']) as r(rolname)
        where n.nspname = 'public' and p.proname = 'crm_fleet_status'
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );
    expect(rows).toEqual([]);

    const { rows: definers } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_fleet_status'`,
    );
    expect(definers).toEqual([]);
  });
});
