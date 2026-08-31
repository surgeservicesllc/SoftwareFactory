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
 * Multi-unit properties (ADR-215) against the real chain.
 *
 * A 200-unit block used to be one row and two hundred service points. The
 * thing that makes the unit level real rather than decorative is the
 * COMPOSITE reference: a work order at Harborview cannot name a unit of
 * Fairview, because rows point at (organization, property, unit).
 *
 * Getting that wrong is how multi-unit becomes a reporting feature that
 * quietly attributes a treatment to the wrong home, so most of this suite
 * is about the wrong door rather than the right one.
 */

const acmeOwner = "00000000-0000-4000-8000-000000014001";
const rivalOwner = "00000000-0000-4000-8000-000000014002";
const acmeOrg = "10000000-0000-4000-8000-000000014001";
const rivalOrg = "10000000-0000-4000-8000-000000014002";

describe("multi-unit properties", { timeout: 240_000 }, () => {
  let db: PGlite;

  let account = "";
  let harborview = "";
  let fairview = "";
  let technician = "";
  let unit4b = "";
  let fairviewUnit = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function addUnit(property: string, label: string, occupant: string | null = null) {
    const created = await db.query<{ id: string }>(
      `insert into public.crm_property_units
         (organization_id, property_id, label, unit_type, occupant_name, created_by)
       values ($1, $2, $3, 'apartment', $4, $5) returning id`,
      [acmeOrg, property, label, occupant, acmeOwner],
    );
    return created.rows[0].id;
  }

  async function completedVisit(property: string, unit: string | null, at: string) {
    return db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, unit_id, technician_id, status,
          service_type, scheduled_start, scheduled_end, completed_at, created_by)
       values ($1, $2, $3, $4, $5, 'completed', 'Unit treatment', $6,
               ($6::timestamptz + interval '1 hour'), $6, $7) returning id`,
      [acmeOrg, account, property, unit, technician, at, acmeOwner],
    );
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
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${acmeOwner}'), ('${rivalOwner}');
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-units', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-units', '${rivalOwner}');
    `);

    await as(acmeOwner);
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Residences', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    harborview = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Block A', '4100 Cannery Row') returning id`,
      [acmeOrg, account],
    )).rows[0].id;
    fairview = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Fairview Block B', '80 Fairview Lane') returning id`,
      [acmeOrg, account],
    )).rows[0].id;
    technician = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Ada', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;

    unit4b = await addUnit(harborview, "4B", "M. Okafor");
    // Never serviced on purpose: the coverage reader has to surface it.
    await addUnit(harborview, "5A");
    fairviewUnit = await addUnit(fairview, "1A");
  });

  afterAll(async () => {
    await db?.close();
  });

  it("will not let a visit name a unit of a different property", async () => {
    await as(acmeOwner);
    // The whole feature turns on this. Without it multi-unit is a label
    // that can attribute a treatment to the wrong home.
    await expect(
      completedVisit(harborview, fairviewUnit, "2026-06-01T09:00:00Z"),
    ).rejects.toThrow(/crm_work_orders_unit_same_property/);
  });

  it("will not let a station or a sighting sit in another property's unit", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_devices
           (organization_id, account_id, property_id, unit_id, label, device_type, barcode, created_by)
         values ($1, $2, $3, $4, 'Kitchen station', 'bait_station', 'UNIT-0001', $5)`,
        [acmeOrg, account, harborview, fairviewUnit, acmeOwner],
      ),
    ).rejects.toThrow(/crm_devices_unit_same_property/);

    await expect(
      db.query(
        `insert into public.crm_pest_sightings
           (organization_id, account_id, property_id, unit_id, pest, severity, created_by)
         values ($1, $2, $3, $4, 'German cockroach', 'moderate', $5)`,
        [acmeOrg, account, harborview, fairviewUnit, acmeOwner],
      ),
    ).rejects.toThrow(/crm_pest_sightings_unit_same_property/);
  });

  it("treats one door as one row, however it is typed", async () => {
    await as(acmeOwner);
    await expect(addUnit(harborview, "4b")).rejects.toThrow(/crm_property_units_label_key/);
    // The same number in a different building is a different door.
    await expect(addUnit(fairview, "4B")).resolves.toBeTruthy();
  });

  it("names the doors that were missed, never-serviced first", async () => {
    await as(acmeOwner);
    await completedVisit(harborview, unit4b, "2026-06-01T09:00:00Z");

    const coverage = await db.query<{
      unit_label: string; last_serviced_at: string | null; visits_in_window: string;
    }>("select * from public.crm_property_unit_coverage($1, '2026-01-01')", [harborview]);

    // 5A has never been entered, so it sorts above the one that went fine —
    // burying it under the treated units is how it gets missed twice.
    expect(coverage.rows[0].unit_label).toBe("5A");
    expect(coverage.rows[0].last_serviced_at).toBeNull();
    expect(coverage.rows[1].unit_label).toBe("4B");
    expect(Number(coverage.rows[1].visits_in_window)).toBe(1);
  });

  it("counts a unit's own stations and open sightings, not the building's", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, unit_id, label, device_type, barcode, created_by)
       values ($1, $2, $3, $4, 'Under sink', 'bait_station', 'UNIT-4B-01', $5)`,
      [acmeOrg, account, harborview, unit4b, acmeOwner],
    );
    await db.query(
      `insert into public.crm_pest_sightings
         (organization_id, account_id, property_id, unit_id, pest, severity, created_by)
       values ($1, $2, $3, $4, 'German cockroach', 'moderate', $5)`,
      [acmeOrg, account, harborview, unit4b, acmeOwner],
    );
    // A station in the building but in no unit belongs to neither door.
    await db.query(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode, created_by)
       values ($1, $2, $3, 'Boiler room', 'bait_station', 'UNIT-COMMON-1', $4)`,
      [acmeOrg, account, harborview, acmeOwner],
    );

    const coverage = await db.query<{
      unit_label: string; active_stations: string; open_sightings: string;
    }>("select * from public.crm_property_unit_coverage($1, '2026-01-01')", [harborview]);

    const fourB = coverage.rows.find((row) => row.unit_label === "4B");
    const fiveA = coverage.rows.find((row) => row.unit_label === "5A");
    expect(Number(fourB?.active_stations)).toBe(1);
    expect(Number(fourB?.open_sightings)).toBe(1);
    expect(Number(fiveA?.active_stations)).toBe(0);
  });

  it("keeps a property with no units working exactly as before", async () => {
    await as(acmeOwner);
    const plain = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Single home', '12 Oak Street') returning id`,
      [acmeOrg, account],
    );
    const visit = await completedVisit(plain.rows[0].id, null, "2026-06-08T09:00:00Z");

    expect(visit.rows[0].id).toBeTruthy();
    const coverage = await db.query(
      "select * from public.crm_property_unit_coverage($1)", [plain.rows[0].id]);
    expect(coverage.rows).toEqual([]);
  });

  it("keeps the work when a door is removed, rather than deleting it with the unit", async () => {
    await as(acmeOwner);
    const doomed = await addUnit(harborview, "9Z");
    const visit = await completedVisit(harborview, doomed, "2026-06-15T09:00:00Z");
    await db.query("delete from public.crm_property_units where id = $1", [doomed]);

    const survivor = await db.query<{ unit_id: string | null }>(
      "select unit_id from public.crm_work_orders where id = $1", [visit.rows[0].id]);
    // The visit happened. Deleting the door does not unmake it.
    expect(survivor.rows).toHaveLength(1);
    expect(survivor.rows[0].unit_id).toBeNull();
  });

  it("keeps one book's doors out of another's", async () => {
    await as(rivalOwner);
    const units = await db.query(
      "select id from public.crm_property_units where property_id = $1", [harborview]);
    const coverage = await db.query(
      "select * from public.crm_property_unit_coverage($1)", [harborview]);

    expect(units.rows).toEqual([]);
    expect(coverage.rows).toEqual([]);
  });

  it("leaves the coverage reader an invoker", async () => {
    await db.exec("reset role");
    const definers = await db.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.proname = 'crm_property_unit_coverage'`,
    );

    expect(definers.rows).toEqual([]);
  });
});
