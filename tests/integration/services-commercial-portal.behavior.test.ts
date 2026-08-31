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
 * The commercial portal view (ADR-203) against the real migration chain.
 *
 * Increment 10 proved a portal user sees one account. This suite is about
 * what that account is allowed to contain: stations, scan history, open
 * conditions, the safety library and inspection history — the contents of
 * an audit binder. Two things are on trial throughout.
 *
 * The first is the tenant boundary, again, because every projection here
 * is new and each one is a new chance to get it wrong.
 *
 * The second is honesty. A compliance binder is precisely where a
 * comfortable zero does damage: "0 activity" on a station nobody scanned
 * reads as a clean site, and it is not one. Several tests below exist only
 * to assert null where the tempting answer is 0 or false.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000c101";
const rivalOwner = "00000000-0000-4000-8000-00000000c102";
const acmeOrg = "10000000-0000-4000-8000-00000000c101";
const rivalOrg = "10000000-0000-4000-8000-00000000c102";

const customerLogin = "00000000-0000-4000-8000-00000000c111";
const rivalCustomerLogin = "00000000-0000-4000-8000-00000000c112";
const strangerLogin = "00000000-0000-4000-8000-00000000c113";

describe("the commercial portal view", { timeout: 240_000 }, () => {
  let db: PGlite;

  let acmeAccount = "";
  let rivalAccount = "";
  let plantSite = "";
  let depotSite = "";
  let rivalSite = "";
  let scannedStation = "";
  let quietStation = "";
  let unmeteredStation = "";
  let acmeTechnician = "";
  let baitProduct = "";
  let unlistedProduct = "";

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
      -- Real Supabase grants this; the shim did not, and the portal's
      -- accept flow reads auth.users as its definer owner.
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
      insert into auth.users (id, email) values
        ('${customerLogin}', 'qa@harborview.example'),
        ('${rivalCustomerLogin}', 'qa@rivalgrocers.example'),
        ('${strangerLogin}', 'nobody@elsewhere.example');
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-commercial', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-commercial', '${rivalOwner}');
    `);
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("stands up a commercial account with two sites, three stations and a scan history", async () => {
    await as(acmeOwner);

    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    acmeAccount = account.rows[0].id;

    const plant = await db.query<{ id: string }>(
      `insert into public.crm_properties
         (organization_id, account_id, label, address, property_type, access_notes)
       values ($1, $2, 'Harborview Plant', '4100 Cannery Row, Portland', 'food processing',
               'Gate code at the guard house')
       returning id`,
      [acmeOrg, acmeAccount],
    );
    plantSite = plant.rows[0].id;

    const depot = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Depot', '9 Dockside Way, Portland') returning id`,
      [acmeOrg, acmeAccount],
    );
    depotSite = depot.rows[0].id;

    const technician = await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Ada', 'Fernsby', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    acmeTechnician = technician.rows[0].id;

    // A station that gets scanned, with a threshold to be measured against.
    const scanned = await db.query<{ id: string }>(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode,
          location_note, activity_threshold, installed_at, created_by)
       values ($1, $2, $3, 'RB-01 Dock Door', 'bait_station', 'HV-RB-0001',
               'Exterior, north dock', 5, now() - interval '400 days', $4)
       returning id`,
      [acmeOrg, acmeAccount, plantSite, acmeOwner],
    );
    scannedStation = scanned.rows[0].id;

    // A station scanned but never counted — the trap for a comfortable zero.
    const quiet = await db.query<{ id: string }>(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode,
          activity_threshold, installed_at, created_by)
       values ($1, $2, $3, 'ILT-02 Prep', 'insect_light_trap', 'HV-ILT-0002',
               10, now() - interval '200 days', $4)
       returning id`,
      [acmeOrg, acmeAccount, plantSite, acmeOwner],
    );
    quietStation = quiet.rows[0].id;

    // A station with a real count and NO threshold: it is not "under" one.
    const unmetered = await db.query<{ id: string }>(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode,
          installed_at, created_by)
       values ($1, $2, $3, 'MC-03 Receiving', 'multi_catch', 'HV-MC-0003',
               now() - interval '90 days', $4)
       returning id`,
      [acmeOrg, acmeAccount, depotSite, acmeOwner],
    );
    unmeteredStation = unmetered.rows[0].id;

    await reset();
    expect([scannedStation, quietStation, unmeteredStation]).toHaveLength(3);
  });

  it("records scans, a sighting, an application and a completed inspection", async () => {
    await as(acmeOwner);

    // Two scans on the metered station: the newer one is over its threshold.
    await db.query(
      `insert into public.crm_device_events
         (organization_id, device_id, event, condition, activity_count, pest_observed, recorded_at)
       values
         ($1, $2, 'service', 'ok', 1, null, now() - interval '45 days'),
         ($1, $2, 'service', 'ok', 9, 'Norway rat', now() - interval '5 days')`,
      [acmeOrg, scannedStation],
    );
    // Scanned, condition recorded, but nobody wrote a number down.
    await db.query(
      `insert into public.crm_device_events
         (organization_id, device_id, event, condition, recorded_at)
       values ($1, $2, 'service', 'ok', now() - interval '6 days')`,
      [acmeOrg, quietStation],
    );
    // A real count with no threshold behind it.
    await db.query(
      `insert into public.crm_device_events
         (organization_id, device_id, event, condition, activity_count, recorded_at)
       values ($1, $2, 'service', 'ok', 3, now() - interval '7 days')`,
      [acmeOrg, unmeteredStation],
    );

    // One open sighting and one already corrected.
    await db.query(
      `insert into public.crm_pest_sightings
         (organization_id, account_id, property_id, pest, severity, location_note,
          sighted_at, created_by)
       values ($1, $2, $3, 'German cockroach', 'high', 'Prep line drain',
               now() - interval '3 days', $4)`,
      [acmeOrg, acmeAccount, plantSite, acmeOwner],
    );
    await db.query(
      `insert into public.crm_pest_sightings
         (organization_id, account_id, property_id, pest, severity, sighted_at,
          corrective_action, corrected_at, created_by)
       values ($1, $2, $3, 'Pantry moth', 'low', now() - interval '60 days',
               'Sanitation and pheromone monitors', now() - interval '55 days', $4)`,
      [acmeOrg, acmeAccount, plantSite, acmeOwner],
    );

    const applied = await db.query<{ id: string }>(
      `insert into public.crm_products
         (organization_id, name, epa_registration_number, active_ingredient, signal_word,
          sds_url, restricted_use, created_by)
       values ($1, 'Contrac Blox', '90001-1', 'Bromadiolone', 'CAUTION',
               'https://labels.example/contrac-sds.pdf', false, $2)
       returning id`,
      [acmeOrg, acmeOwner],
    );
    baitProduct = applied.rows[0].id;

    // Stocked but never applied at this customer's sites.
    const unlisted = await db.query<{ id: string }>(
      `insert into public.crm_products (organization_id, name, created_by)
       values ($1, 'Termidor SC', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    unlistedProduct = unlisted.rows[0].id;

    await db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, product_id, technician_id, device_id,
          method, target_pest, quantity, unit, applied_at, created_by)
       values ($1, $2, $3, $4, $5, $6, 'bait', 'Norway rat', 4, 'oz',
               now() - interval '5 days', $7)`,
      [acmeOrg, acmeAccount, plantSite, baitProduct, acmeTechnician, scannedStation, acmeOwner],
    );

    const template = await db.query<{ id: string }>(
      `insert into public.crm_form_templates (organization_id, name, kind, created_by)
       values ($1, 'Quarterly AIB Inspection', 'inspection', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const templateId = template.rows[0].id;

    await db.query(
      `insert into public.crm_form_instances
         (organization_id, template_id, account_id, property_id, status, assigned_at,
          completed_at, signed_by_name, signed_at, signature_path, notes, created_by)
       values ($1, $2, $3, $4, 'completed', now() - interval '31 days',
               now() - interval '30 days', 'M. Okonkwo', now() - interval '30 days',
               'signatures/harborview/q2.png', 'Two findings, both closed on site.', $5)`,
      [acmeOrg, templateId, acmeAccount, plantSite, acmeOwner],
    );
    // Assigned but never performed: it has nothing to report.
    await db.query(
      `insert into public.crm_form_instances
         (organization_id, template_id, account_id, property_id, status, created_by)
       values ($1, $2, $3, $4, 'assigned', $5)`,
      [acmeOrg, templateId, acmeAccount, plantSite, acmeOwner],
    );

    await db.query(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, status, service_type,
          scheduled_start, scheduled_end, completed_at, completion_notes, instructions, created_by)
       values ($1, $2, $3, $4, 'completed', 'Quarterly IPM',
               now() - interval '5 days', now() - interval '5 days' + interval '2 hours',
               now() - interval '5 days' + interval '90 minutes',
               'Rebaited the north dock line.', 'Guard house holds the key.', $5)`,
      [acmeOrg, acmeAccount, plantSite, acmeTechnician, acmeOwner],
    );
    await db.query(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, status, service_type,
          scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, 'scheduled', 'Quarterly IPM',
               now() + interval '20 days', now() + interval '20 days' + interval '2 hours', $4)`,
      [acmeOrg, acmeAccount, plantSite, acmeOwner],
    );

    await db.query(
      `insert into public.crm_portal_users
         (organization_id, account_id, email, role, created_by)
       values ($1, $2, 'qa@harborview.example', 'viewer', $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );
    await reset();

    await as(customerLogin);
    await db.query("select public.crm_portal_accept_invitation()");
    await reset();

    expect(unlistedProduct).not.toBe(baitProduct);
  });

  it("stands up the rival tenant with its own station, product and inspection", async () => {
    await as(rivalOwner);
    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Rival Grocers', 'commercial', 'customer', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    rivalAccount = account.rows[0].id;

    const site = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Rival Distribution Center', '77 Sideline Ave, Tacoma') returning id`,
      [rivalOrg, rivalAccount],
    );
    rivalSite = site.rows[0].id;

    const device = await db.query<{ id: string }>(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode,
          activity_threshold, created_by)
       values ($1, $2, $3, 'RG-01', 'bait_station', 'RG-RB-0001', 2, $4) returning id`,
      [rivalOrg, rivalAccount, rivalSite, rivalOwner],
    );
    await db.query(
      `insert into public.crm_device_events
         (organization_id, device_id, event, condition, activity_count, recorded_at)
       values ($1, $2, 'service', 'damaged', 40, now() - interval '2 days')`,
      [rivalOrg, device.rows[0].id],
    );
    await db.query(
      `insert into public.crm_pest_sightings
         (organization_id, account_id, property_id, pest, sighted_at, created_by)
       values ($1, $2, $3, 'House mouse', now() - interval '1 day', $4)`,
      [rivalOrg, rivalAccount, rivalSite, rivalOwner],
    );
    await db.query(
      `insert into public.crm_portal_users
         (organization_id, account_id, email, created_by)
       values ($1, $2, 'qa@rivalgrocers.example', $3)`,
      [rivalOrg, rivalAccount, rivalOwner],
    );
    await reset();

    await as(rivalCustomerLogin);
    await db.query("select public.crm_portal_accept_invitation()");
    await reset();

    expect(rivalAccount).not.toBe(acmeAccount);
  });

  it("lists the caller's own sites, with the counts that belong to each", async () => {
    await as(customerLogin);
    const sites = await db.query<{
      id: string;
      label: string;
      address: string;
      property_type: string | null;
      active_devices: number;
      open_sightings: number;
      last_visit_at: Date | null;
      next_visit_at: Date | null;
    }>("select * from public.crm_portal_sites()");

    expect(sites.rows.map((row) => row.label)).toEqual([
      "Harborview Depot",
      "Harborview Plant",
    ]);

    const plant = sites.rows.find((row) => row.id === plantSite);
    expect(plant?.active_devices).toBe(2);
    // The corrected sighting is closed and is not counted as open.
    expect(plant?.open_sightings).toBe(1);
    expect(plant?.last_visit_at).not.toBeNull();
    expect(plant?.next_visit_at).not.toBeNull();
    expect(plant?.property_type).toBe("food processing");

    const depot = sites.rows.find((row) => row.id === depotSite);
    expect(depot?.active_devices).toBe(1);
    expect(depot?.open_sightings).toBe(0);
    // Nothing has ever been scheduled at the depot, so there is no visit —
    // not a visit at the beginning of time.
    expect(depot?.last_visit_at).toBeNull();
    expect(depot?.next_visit_at).toBeNull();

    // The site's access notes are the branch's dispatch instructions and
    // are simply not in the projection.
    expect(Object.keys(sites.rows[0])).not.toContain("access_notes");
    await reset();
  });

  it("reports a station's last scan from the ledger, and refuses to invent one", async () => {
    await as(customerLogin);
    const devices = await db.query<{
      id: string;
      label: string;
      barcode: string;
      last_service_at: Date | null;
      last_activity_count: number | null;
      last_pest_observed: string | null;
      over_threshold: boolean | null;
      activity_threshold: number | null;
    }>("select * from public.crm_portal_devices()");

    expect(devices.rows).toHaveLength(3);

    const scanned = devices.rows.find((row) => row.id === scannedStation);
    // The LATEST scan, not the first and not a sum of both.
    expect(scanned?.last_activity_count).toBe(9);
    expect(scanned?.last_pest_observed).toBe("Norway rat");
    expect(scanned?.over_threshold).toBe(true);
    expect(scanned?.barcode).toBe("HV-RB-0001");

    // Scanned, but no number written down: null, never 0.
    const quiet = devices.rows.find((row) => row.id === quietStation);
    expect(quiet?.last_service_at).not.toBeNull();
    expect(quiet?.last_activity_count).toBeNull();
    expect(quiet?.over_threshold).toBeNull();

    // A real count with no threshold to measure it against is not "under"
    // one; there is no question to answer.
    const unmetered = devices.rows.find((row) => row.id === unmeteredStation);
    expect(unmetered?.last_activity_count).toBe(3);
    expect(unmetered?.activity_threshold).toBeNull();
    expect(unmetered?.over_threshold).toBeNull();

    const depotOnly = await db.query("select * from public.crm_portal_devices($1)", [depotSite]);
    expect(depotOnly.rows).toHaveLength(1);
    await reset();
  });

  it("shows a scan count beside every trend cell, so an empty month cannot read as a clean one", async () => {
    await as(customerLogin);
    const trend = await db.query<{
      month: Date;
      device_type: string;
      scans: number;
      scans_with_count: number;
      activity_total: string | null;
      stations_flagged: number;
    }>("select * from public.crm_portal_device_trend(12)");

    const lightTrap = trend.rows.find((row) => row.device_type === "insect_light_trap");
    // One scan happened. Nobody counted. The cell says both.
    expect(lightTrap?.scans).toBe(1);
    expect(lightTrap?.scans_with_count).toBe(0);
    expect(lightTrap?.activity_total).toBeNull();
    expect(lightTrap?.stations_flagged).toBe(0);

    // The function already returns newest month first, so the head of the
    // bait rows is the most recent month.
    const bait = trend.rows.filter((row) => row.device_type === "bait_station")[0];
    expect(Number(bait?.activity_total)).toBe(9);
    expect(bait?.stations_flagged).toBe(1);

    // The window is bounded, and a nonsense request is clamped rather than
    // turned into an unbounded scan.
    const clamped = await db.query("select * from public.crm_portal_device_trend(9999)");
    expect(clamped.rows.length).toBeGreaterThan(0);
    await reset();
  });

  it("puts open sightings and failing stations on one list, and leaves closed ones off it", async () => {
    await as(customerLogin);
    const conditions = await db.query<{
      kind: string;
      source_id: string;
      property_label: string;
      headline: string;
      severity: string;
      reported_by_customer: boolean;
    }>("select * from public.crm_portal_conditions()");

    const headlines = conditions.rows.map((row) => row.headline);
    expect(headlines).toContain("German cockroach");
    // Corrected 55 days ago; it is history, not an open condition.
    expect(headlines).not.toContain("Pantry moth");
    // Over its threshold on the most recent scan.
    expect(headlines).toContain("RB-01 Dock Door");
    // Scanned "ok" with no count, and under no threshold: not a condition.
    expect(headlines).not.toContain("ILT-02 Prep");
    expect(headlines).not.toContain("MC-03 Receiving");

    const roach = conditions.rows.find((row) => row.headline === "German cockroach");
    expect(roach?.kind).toBe("sighting");
    expect(roach?.severity).toBe("high");
    expect(roach?.reported_by_customer).toBe(false);
    await reset();
  });

  it("lists only the products actually applied at this customer's sites", async () => {
    await as(customerLogin);
    const library = await db.query<{
      product_id: string;
      name: string;
      epa_registration_number: string | null;
      sds_url: string | null;
      applications: number;
      last_applied_at: Date | null;
    }>("select * from public.crm_portal_safety_library()");

    expect(library.rows).toHaveLength(1);
    expect(library.rows[0].name).toBe("Contrac Blox");
    expect(library.rows[0].epa_registration_number).toBe("90001-1");
    expect(library.rows[0].sds_url).toBe("https://labels.example/contrac-sds.pdf");
    expect(library.rows[0].applications).toBe(1);
    // Stocked by the branch but never applied here.
    expect(library.rows.map((row) => row.product_id)).not.toContain(unlistedProduct);
    await reset();
  });

  it("shows completed inspections, says a signature exists, and never hands over its path", async () => {
    await as(customerLogin);
    const inspections = await db.query<{
      template_name: string;
      template_kind: string;
      property_label: string;
      has_signature: boolean;
      signed_by_name: string | null;
      notes: string | null;
    }>("select * from public.crm_portal_inspections()");

    expect(inspections.rows).toHaveLength(1);
    expect(inspections.rows[0].template_name).toBe("Quarterly AIB Inspection");
    expect(inspections.rows[0].template_kind).toBe("inspection");
    expect(inspections.rows[0].property_label).toBe("Harborview Plant");
    expect(inspections.rows[0].has_signature).toBe(true);
    expect(inspections.rows[0].signed_by_name).toBe("M. Okonkwo");
    // The storage path is not the customer's to hold.
    expect(Object.keys(inspections.rows[0])).not.toContain("signature_path");
    await reset();
  });

  it("lets the customer report a sighting against their own site, and stamps who did", async () => {
    await as(customerLogin);
    const reported = await db.query<{ id: string }>(
      `select public.crm_portal_report_sighting($1, 'Fruit fly', 'moderate',
         'Bar sink, room 2', 'Seen each morning this week') as id`,
      [depotSite],
    );
    expect(reported.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);

    const conditions = await db.query<{ headline: string; reported_by_customer: boolean }>(
      "select * from public.crm_portal_conditions()",
    );
    const fly = conditions.rows.find((row) => row.headline === "Fruit fly");
    expect(fly?.reported_by_customer).toBe(true);
    await reset();

    // Staff see the same row, and can tell where it came from.
    await as(acmeOwner);
    const staffView = await db.query<{ pest: string; reported_by_portal_user_id: string | null }>(
      "select pest, reported_by_portal_user_id from public.crm_pest_sightings where pest = 'Fruit fly'",
    );
    expect(staffView.rows).toHaveLength(1);
    expect(staffView.rows[0].reported_by_portal_user_id).not.toBeNull();
    await reset();
  });

  it("refuses a sighting reported against somebody else's site", async () => {
    await as(customerLogin);
    await expect(
      db.query("select public.crm_portal_report_sighting($1, 'Fruit fly')", [rivalSite]),
    ).rejects.toThrow(/that site is not on this account/);
    await expect(
      db.query("select public.crm_portal_report_sighting(null, 'Fruit fly')"),
    ).rejects.toThrow(/that site is not on this account/);
    await reset();
  });

  it("shows the rival's portal user the rival's binder and nothing of Acme's", async () => {
    await as(rivalCustomerLogin);

    const sites = await db.query<{ label: string }>("select * from public.crm_portal_sites()");
    expect(sites.rows.map((row) => row.label)).toEqual(["Rival Distribution Center"]);

    const devices = await db.query<{ barcode: string }>("select * from public.crm_portal_devices()");
    expect(devices.rows.map((row) => row.barcode)).toEqual(["RG-RB-0001"]);

    // Naming Acme's site id explicitly buys nothing: the filter narrows a
    // set that was already the caller's own.
    const reach = await db.query("select * from public.crm_portal_devices($1)", [plantSite]);
    expect(reach.rows).toHaveLength(0);

    const conditions = await db.query<{ headline: string }>(
      "select * from public.crm_portal_conditions()",
    );
    expect(conditions.rows.map((row) => row.headline).sort()).toEqual([
      "House mouse",
      "RG-01",
    ]);

    // Acme applied a product; the rival's library is empty, not Acme's.
    const library = await db.query("select * from public.crm_portal_safety_library()");
    expect(library.rows).toHaveLength(0);

    const inspections = await db.query("select * from public.crm_portal_inspections()");
    expect(inspections.rows).toHaveLength(0);
    await reset();
  });

  it("gives a signed-in stranger with no portal link nothing at all", async () => {
    await as(strangerLogin);
    for (const call of [
      "select * from public.crm_portal_sites()",
      "select * from public.crm_portal_devices()",
      "select * from public.crm_portal_device_trend(12)",
      "select * from public.crm_portal_conditions()",
      "select * from public.crm_portal_safety_library()",
      "select * from public.crm_portal_inspections()",
    ]) {
      const result = await db.query(call);
      expect(result.rows).toHaveLength(0);
    }
    await expect(
      db.query("select public.crm_portal_report_sighting($1, 'Fruit fly')", [plantSite]),
    ).rejects.toThrow(/no portal access/);
    await reset();
  });

  it("closes the binder the moment the login is deactivated", async () => {
    await as(acmeOwner);
    await db.query(
      "update public.crm_portal_users set active = false where account_id = $1",
      [acmeAccount],
    );
    await reset();

    await as(customerLogin);
    const sites = await db.query("select * from public.crm_portal_sites()");
    expect(sites.rows).toHaveLength(0);
    const devices = await db.query("select * from public.crm_portal_devices()");
    expect(devices.rows).toHaveLength(0);
    await expect(
      db.query("select public.crm_portal_report_sighting($1, 'Fruit fly')", [plantSite]),
    ).rejects.toThrow(/no portal access/);
    await reset();

    await as(acmeOwner);
    await db.query(
      "update public.crm_portal_users set active = true where account_id = $1",
      [acmeAccount],
    );
    await reset();
  });

  it("keeps the resolver unreachable, so no caller can name an account", async () => {
    await as(customerLogin);
    await expect(
      db.query("select * from public.crm_portal_account_for($1)", [rivalCustomerLogin]),
    ).rejects.toThrow(/permission denied/i);
    await reset();
  });
});
