// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830001400_branches_org_sales.sql";

/**
 * Pest/IPM (ADR-190) against the real migration chain: the scan ledger's
 * immutability is a missing grant, device state deriving from the ledger is
 * a trigger, the install scan existing from birth is a trigger, one barcode
 * per organization is a unique index, and a corrective action arriving with
 * its timestamp is a CHECK. Schema promises, all of them.
 */

const acmeOwner = "00000000-0000-4000-8000-0000000a0001";
const rivalOwner = "00000000-0000-4000-8000-0000000a0002";
const acmeOrg = "10000000-0000-4000-8000-0000000a0001";
const rivalOrg = "10000000-0000-4000-8000-0000000a0002";

describe("the pest/IPM core", { timeout: 240_000 }, () => {
  let db: PGlite;
  let accountId = "";
  let propertyId = "";
  let rivalAccountId = "";
  let rivalPropertyId = "";

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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(latestMigration);
    for (const file of migrationFiles) {
      // Hosted-style default privileges before the CRM window, as in the
      // other CRM chain suites.
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

    await as(acmeOwner);
    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Harborview Foods', 'commercial', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    accountId = account.rows[0].id;
    const property = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Distribution Center', '14 Dock Road') returning id`,
      [acmeOrg, accountId],
    );
    propertyId = property.rows[0].id;
    await reset();

    await as(rivalOwner);
    const rivalAccount = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Rival Client', 'commercial', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    rivalAccountId = rivalAccount.rows[0].id;
    const rivalProperty = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Rival Site', '9 Other Road') returning id`,
      [rivalOrg, rivalAccountId],
    );
    rivalPropertyId = rivalProperty.rows[0].id;
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("a station is born with its install scan, and its state follows the ledger", async () => {
    await as(acmeOwner);
    const device = await db.query<{ id: string; status: string }>(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode, location_note, created_by)
       values ($1, $2, $3, 'Station 01', 'bait_station', 'TEST-ST-0001', 'North fence, post 1', $4)
       returning id, status::text`,
      [acmeOrg, accountId, propertyId, acmeOwner],
    );
    const deviceId = device.rows[0].id;
    expect(device.rows[0].status).toBe("active");

    const birth = await db.query<{ event: string; location_note: string | null; actor_user_id: string | null }>(
      "select event::text, location_note, actor_user_id from public.crm_device_events where device_id = $1",
      [deviceId],
    );
    expect(birth.rows).toEqual([
      { event: "install", location_note: "North fence, post 1", actor_user_id: acmeOwner },
    ]);

    // A move relocates through the ledger; a remove closes through it.
    await db.query(
      `insert into public.crm_device_events (organization_id, device_id, event, location_note, actor_user_id)
       values ($1, $2, 'move', 'Dock door 7, interior right', $3)`,
      [acmeOrg, deviceId, acmeOwner],
    );
    const moved = await db.query<{ location_note: string | null; status: string }>(
      "select location_note, status::text from public.crm_devices where id = $1",
      [deviceId],
    );
    expect(moved.rows[0]).toEqual({ location_note: "Dock door 7, interior right", status: "active" });

    await db.query(
      `insert into public.crm_device_events (organization_id, device_id, event, actor_user_id)
       values ($1, $2, 'remove', $3)`,
      [acmeOrg, deviceId, acmeOwner],
    );
    const removed = await db.query<{ status: string; removed_at: string | null }>(
      "select status::text, removed_at from public.crm_devices where id = $1",
      [deviceId],
    );
    expect(removed.rows[0].status).toBe("removed");
    expect(removed.rows[0].removed_at).not.toBeNull();

    // Reinstall through the ledger reactivates.
    await db.query(
      `insert into public.crm_device_events (organization_id, device_id, event, actor_user_id)
       values ($1, $2, 'install', $3)`,
      [acmeOrg, deviceId, acmeOwner],
    );
    const back = await db.query<{ status: string; removed_at: string | null }>(
      "select status::text, removed_at from public.crm_devices where id = $1",
      [deviceId],
    );
    expect(back.rows[0]).toEqual({ status: "active", removed_at: null });
    await reset();
  });

  it("keeps the scan ledger append-only and one barcode per organization", async () => {
    await as(acmeOwner);
    const scan = await db.query<{ id: string }>(
      `select events.id from public.crm_device_events events
        join public.crm_devices devices on devices.id = events.device_id
       where devices.barcode = 'TEST-ST-0001' limit 1`,
    );
    await expect(db.query(
      "update public.crm_device_events set note = 'A different past.' where id = $1",
      [scan.rows[0].id],
    )).rejects.toThrow(/permission denied/);
    await expect(db.query(
      "delete from public.crm_device_events where id = $1",
      [scan.rows[0].id],
    )).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.crm_devices where barcode = 'TEST-ST-0001'"))
      .rejects.toThrow(/permission denied/);

    // The same barcode cannot name a second station here…
    await expect(db.query(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode, created_by)
       values ($1, $2, $3, 'Duplicate', 'bait_station', 'TEST-ST-0001', $4)`,
      [acmeOrg, accountId, propertyId, acmeOwner],
    )).rejects.toThrow(/crm_devices_org_barcode_key|duplicate key/);
    await reset();

    // …but another organization may reuse it freely.
    await as(rivalOwner);
    const reused = await db.query<{ id: string }>(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode, created_by)
       values ($1, $2, $3, 'Rival station', 'snap_trap', 'TEST-ST-0001', $4) returning id`,
      [rivalOrg, rivalAccountId, rivalPropertyId, rivalOwner],
    );
    expect(reused.rows[0].id).toBeTruthy();
    await reset();
  });

  it("a corrective action arrives with its timestamp, or not at all", async () => {
    await as(acmeOwner);
    const sighting = await db.query<{ id: string }>(
      `insert into public.crm_pest_sightings
         (organization_id, account_id, property_id, pest, severity, created_by)
       values ($1, $2, $3, 'House mouse', 'high', $4) returning id`,
      [acmeOrg, accountId, propertyId, acmeOwner],
    );
    const sightingId = sighting.rows[0].id;

    await expect(db.query(
      "update public.crm_pest_sightings set corrected_at = now() where id = $1",
      [sightingId],
    )).rejects.toThrow(/crm_pest_sightings_corrected_iff_action/);

    await db.query(
      `update public.crm_pest_sightings
          set corrective_action = 'Multi-catch moved to dock door 7; exclusion sweep booked.', corrected_at = now()
        where id = $1`,
      [sightingId],
    );
    const resolved = await db.query<{ corrected: boolean }>(
      "select (corrected_at is not null) as corrected from public.crm_pest_sightings where id = $1",
      [sightingId],
    );
    expect(resolved.rows[0].corrected).toBe(true);

    await expect(db.query("delete from public.crm_pest_sightings where id = $1", [sightingId]))
      .rejects.toThrow(/permission denied/);
    await reset();
  });

  it("keeps tenants apart and shuts anon and service_role out", async () => {
    await as(rivalOwner);
    const seen = await db.query<{ devices: number; scans: number; sightings: number }>(
      `select
         (select count(*)::integer from public.crm_devices where organization_id = $1) as devices,
         (select count(*)::integer from public.crm_device_events where organization_id = $1) as scans,
         (select count(*)::integer from public.crm_pest_sightings where organization_id = $1) as sightings`,
      [acmeOrg],
    );
    expect(seen.rows[0]).toEqual({ devices: 0, scans: 0, sightings: 0 });
    // A rival cannot hang a device in THEIR org off an Acme property.
    await expect(db.query(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode, created_by)
       values ($1, $2, $3, 'Intruder', 'bait_station', 'TEST-ST-9999', $4)`,
      [rivalOrg, rivalAccountId, propertyId, rivalOwner],
    )).rejects.toThrow(/foreign key|not present/i);
    await reset();

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    for (const role of ["anon", "service_role"]) {
      await db.exec(`set role ${role}`);
      for (const table of ["crm_devices", "crm_device_events", "crm_pest_sightings"]) {
        await expect(db.query(`select count(*) from public.${table}`))
          .rejects.toThrow(/permission denied/);
      }
      await db.exec("reset role");
    }
  });
});
