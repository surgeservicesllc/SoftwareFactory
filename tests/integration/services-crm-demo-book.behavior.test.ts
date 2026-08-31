// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEMO_BOOK,
  DEMO_COMPLIANCE_RULES,
  DEMO_PRODUCTS,
  DEMO_SOURCE,
  DEMO_TECHNICIANS,
  demoBookTotals,
} from "@/lib/services/demo-data";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830001700_customer_portal.sql";

/**
 * The Demo Data book, replayed against the real migration chain move for
 * move, exactly as the seeder replays it through the client: accounts in as
 * leads, statuses walked so the trigger writes the history, contacts and
 * properties attached, opportunities walked through their stage paths,
 * manual events recorded. If any seeded string oversteps a CHECK — a
 * 33-character phone, a 301-character summary, a note the secret detector
 * dislikes — the production seed would 500, and this is where that fails
 * first.
 */

const owner = "00000000-0000-4000-8000-0000000e0001";
const org = "10000000-0000-4000-8000-0000000e0001";

describe("the Demo Data book against the real schema", { timeout: 240_000 }, () => {
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
      insert into auth.users (id) values ('${owner}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${org}', 'Demo Seed Org', 'demo-seed-org', '${owner}');
    `);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec("set role authenticated");
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("inserts whole and earns its history through the triggers", async () => {
    const technicianIds: string[] = [];
    for (const technician of DEMO_TECHNICIANS) {
      const inserted = await db.query<{ id: string }>(
        `insert into public.crm_technicians
           (organization_id, first_name, last_name, phone, license_number, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [org, technician.firstName, technician.lastName, technician.phone,
         technician.licenseNumber, owner],
      );
      technicianIds.push(inserted.rows[0].id);
    }

    const productIds: string[] = [];
    const lotIds: string[][] = [];
    for (const product of DEMO_PRODUCTS) {
      const insertedProduct = await db.query<{ id: string }>(
        `insert into public.crm_products
           (organization_id, name, epa_registration_number, active_ingredient, signal_word, restricted_use, default_unit, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [org, product.name, product.epaRegistrationNumber, product.activeIngredient,
         product.signalWord ?? null, product.restrictedUse ?? false, product.defaultUnit, owner],
      );
      productIds.push(insertedProduct.rows[0].id);
      const lots: string[] = [];
      for (const lot of product.lots) {
        const insertedLot = await db.query<{ id: string }>(
          `insert into public.crm_product_lots
             (organization_id, product_id, lot_number, unit, quantity_received, quantity_remaining, received_on, created_by)
           values ($1, $2, $3, $4, $5, $5, $6, $7) returning id`,
          [org, insertedProduct.rows[0].id, lot.lotNumber, product.defaultUnit, lot.quantity,
           new Date(Date.now() - lot.receivedDaysAgo * 86_400_000).toISOString().slice(0, 10), owner],
        );
        lots.push(insertedLot.rows[0].id);
      }
      lotIds.push(lots);
    }
    for (const rule of DEMO_COMPLIANCE_RULES) {
      await db.query(
        `insert into public.crm_compliance_rules
           (organization_id, jurisdiction, label, retention_years, requires_applicator_license,
            requires_target_pest, requires_application_rate, requires_treated_area, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [org, rule.jurisdiction, rule.label, rule.retentionYears, rule.requiresApplicatorLicense,
         rule.requiresTargetPest, rule.requiresApplicationRate, rule.requiresTreatedArea, owner],
      );
    }

    const accountIds = new Map<string, string>();
    for (const account of DEMO_BOOK) {
      const inserted = await db.query<{ id: string }>(
        `insert into public.crm_accounts
           (organization_id, name, kind, status, email, phone, source, billing_address, notes, created_by)
         values ($1, $2, $3, 'lead', $4, $5, $6, $7, $8, $9) returning id`,
        [org, account.name, account.kind, account.email, account.phone, DEMO_SOURCE,
         account.billingAddress, account.notes ?? null, owner],
      );
      const accountId = inserted.rows[0].id;
      accountIds.set(account.name, accountId);

      for (const status of account.statusPath) {
        await db.query("update public.crm_accounts set status = $1 where id = $2", [status, accountId]);
      }
      for (const [index, contact] of account.contacts.entries()) {
        await db.query(
          `insert into public.crm_contacts
             (organization_id, account_id, first_name, last_name, role, email, phone, is_primary)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [org, accountId, contact.firstName, contact.lastName, contact.role ?? null,
           contact.email ?? null, contact.phone ?? null, index === 0],
        );
      }
      const propertyIds = new Map<string, string>();
      for (const property of account.properties) {
        const insertedProperty = await db.query<{ id: string }>(
          `insert into public.crm_properties
             (organization_id, account_id, label, address, property_type, access_notes)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [org, accountId, property.label, property.address,
           property.propertyType ?? null, property.accessNotes ?? null],
        );
        propertyIds.set(property.label, insertedProperty.rows[0].id);
      }
      for (const plan of account.plans ?? []) {
        await db.query(
          `insert into public.crm_service_plans
             (organization_id, account_id, property_id, service_type, recurrence, next_due, technician_id, value_cents, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [org, accountId, propertyIds.get(plan.propertyLabel), plan.serviceType, plan.recurrence,
           new Date(Date.now() + plan.dueInDays * 86_400_000).toISOString().slice(0, 10),
           plan.technicianIndex === undefined ? null : technicianIds[plan.technicianIndex],
           plan.valueCents ?? null, owner],
        );
      }
      for (const visit of account.visits ?? []) {
        const day = new Date(Date.now() + visit.inDays * 86_400_000).toISOString().slice(0, 10);
        const insertedVisit = await db.query<{ id: string }>(
          `insert into public.crm_work_orders
             (organization_id, account_id, property_id, technician_id, service_type, scheduled_start, scheduled_end, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [org, accountId, propertyIds.get(visit.propertyLabel),
           technicianIds[visit.technicianIndex], visit.serviceType,
           `${day}T09:00:00Z`,
           `${day}T${String(9 + visit.durationHours).padStart(2, "0")}:00:00Z`, owner],
        );
        for (const status of visit.statusPath) {
          await db.query(
            `update public.crm_work_orders
                set status = $1, completion_notes = coalesce($2, completion_notes)
              where id = $3`,
            [status,
             status === "completed" ? visit.completionNotes ?? null : null,
             insertedVisit.rows[0].id],
          );
        }
      }
      for (const device of account.devices ?? []) {
        const insertedDevice = await db.query<{ id: string }>(
          `insert into public.crm_devices
             (organization_id, account_id, property_id, label, device_type, barcode, location_note, activity_threshold, installed_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [org, accountId, propertyIds.get(device.propertyLabel), device.label, device.deviceType,
           device.barcode, device.locationNote ?? null, device.activityThreshold ?? null,
           new Date(Date.now() - device.installedDaysAgo * 86_400_000).toISOString(), owner],
        );
        for (const scan of device.scans) {
          await db.query(
            `insert into public.crm_device_events
               (organization_id, device_id, event, condition, activity_count, pest_observed, location_note, note, recorded_at, actor_user_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [org, insertedDevice.rows[0].id, scan.event, scan.condition ?? null,
             scan.activityCount ?? null, scan.pestObserved ?? null, scan.locationNote ?? null,
             scan.note ?? null,
             new Date(Date.now() - scan.daysAgo * 86_400_000).toISOString(), owner],
          );
        }
      }
      for (const sighting of account.sightings ?? []) {
        const insertedSighting = await db.query<{ id: string }>(
          `insert into public.crm_pest_sightings
             (organization_id, account_id, property_id, pest, severity, location_note, note, sighted_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [org, accountId, propertyIds.get(sighting.propertyLabel), sighting.pest, sighting.severity,
           sighting.locationNote ?? null, sighting.note ?? null,
           new Date(Date.now() - sighting.daysAgo * 86_400_000).toISOString(), owner],
        );
        if (sighting.correctiveAction) {
          await db.query(
            `update public.crm_pest_sightings
                set corrective_action = $1, corrected_at = $2 where id = $3`,
            [sighting.correctiveAction,
             new Date(Date.now() - (sighting.correctedDaysAgo ?? sighting.daysAgo) * 86_400_000).toISOString(),
             insertedSighting.rows[0].id],
          );
        }
      }
      for (const application of account.applications ?? []) {
        await db.query(
          `insert into public.crm_applications
             (organization_id, account_id, property_id, product_id, lot_id, technician_id,
              applicator_license, method, quantity, unit, target_pest, application_rate,
              treated_area, note, applied_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [org, accountId, propertyIds.get(application.propertyLabel),
           productIds[application.productIndex],
           application.lotIndex === undefined
             ? null
             : lotIds[application.productIndex][application.lotIndex],
           technicianIds[application.technicianIndex],
           DEMO_TECHNICIANS[application.technicianIndex].licenseNumber,
           application.method, application.quantity, application.unit,
           application.targetPest ?? null, application.applicationRate ?? null,
           application.treatedArea ?? null, application.note ?? null,
           new Date(Date.now() - application.daysAgo * 86_400_000).toISOString(), owner],
        );
      }
      for (const opportunity of account.opportunities) {
        const insertedOpportunity = await db.query<{ id: string }>(
          `insert into public.crm_opportunities
             (organization_id, account_id, name, stage, value_cents, expected_close_date, created_by)
           values ($1, $2, $3, 'new', $4, $5, $6) returning id`,
          [org, accountId, opportunity.name, opportunity.valueCents,
           opportunity.expectedInDays === undefined
             ? null
             : new Date(Date.now() + opportunity.expectedInDays * 86_400_000).toISOString().slice(0, 10),
           owner],
        );
        for (const stage of opportunity.stagePath) {
          await db.query(
            `update public.crm_opportunities
                set stage = $1, lost_reason = $2 where id = $3`,
            [stage, stage === "lost" ? opportunity.lostReason ?? null : null,
             insertedOpportunity.rows[0].id],
          );
        }
      }
      for (const event of account.events) {
        await db.query(
          `insert into public.crm_timeline_events
             (organization_id, account_id, kind, summary, detail, occurred_at, actor_user_id)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [org, accountId, event.kind, event.summary, event.detail ?? null,
           new Date(Date.now() - event.daysAgo * 86_400_000).toISOString(), owner],
        );
      }
    }

    const totals = demoBookTotals();
    const counted = await db.query<{ accounts: number; contacts: number; properties: number; opportunities: number; technicians: number; plans: number; work_orders: number; products: number; lots: number; applications: number; rules: number; devices: number; device_events: number; sightings: number; events: number }>(
      `select
         (select count(*)::integer from public.crm_accounts where organization_id = $1) as accounts,
         (select count(*)::integer from public.crm_contacts where organization_id = $1) as contacts,
         (select count(*)::integer from public.crm_properties where organization_id = $1) as properties,
         (select count(*)::integer from public.crm_opportunities where organization_id = $1) as opportunities,
         (select count(*)::integer from public.crm_technicians where organization_id = $1) as technicians,
         (select count(*)::integer from public.crm_service_plans where organization_id = $1) as plans,
         (select count(*)::integer from public.crm_work_orders where organization_id = $1) as work_orders,
         (select count(*)::integer from public.crm_products where organization_id = $1) as products,
         (select count(*)::integer from public.crm_product_lots where organization_id = $1) as lots,
         (select count(*)::integer from public.crm_applications where organization_id = $1) as applications,
         (select count(*)::integer from public.crm_compliance_rules where organization_id = $1) as rules,
         (select count(*)::integer from public.crm_devices where organization_id = $1) as devices,
         (select count(*)::integer from public.crm_device_events where organization_id = $1) as device_events,
         (select count(*)::integer from public.crm_pest_sightings where organization_id = $1) as sightings,
         (select count(*)::integer from public.crm_timeline_events where organization_id = $1) as events`,
      [org],
    );
    expect(counted.rows[0]).toEqual({
      accounts: totals.accounts,
      contacts: totals.contacts,
      properties: totals.properties,
      opportunities: totals.opportunities,
      technicians: DEMO_TECHNICIANS.length,
      plans: totals.plans,
      work_orders: totals.workOrders,
      products: DEMO_PRODUCTS.length,
      lots: DEMO_PRODUCTS.reduce((sum, product) => sum + product.lots.length, 0),
      applications: totals.applications,
      rules: DEMO_COMPLIANCE_RULES.length,
      devices: totals.devices,
      device_events: totals.devices + totals.deviceScans,
      sightings: totals.sightings,
      // Manual events plus one trigger-written line per status move, stage
      // move, and visit outcome.
      // Manual entries, plus one trigger line per status move, stage move,
      // visit outcome and application.
      events:
        totals.manualEvents
        + totals.statusMoves
        + totals.stageMoves
        + totals.visitOutcomes
        + totals.applications,
    });

    /*
     * Two machineries write 'service' history, and both told their story:
     * a finished visit reads as a completion naming its property, and a
     * pesticide application reads as what was applied, with its method.
     * Counting them apart is what proves neither swallowed the other.
     */
    const serviceEvents = await db.query<{ count: number; completions: number; applications: number }>(
      `select count(*)::integer as count,
              count(*) filter (where detail like 'Property: %')::integer as completions,
              count(*) filter (where summary like 'Applied %' and detail like 'Method: %')::integer as applications
         from public.crm_timeline_events
        where organization_id = $1 and kind = 'service'`,
      [org],
    );
    const completions = DEMO_BOOK.flatMap((account) => account.visits ?? [])
      .filter((visit) => visit.statusPath.includes("completed")).length;
    expect(serviceEvents.rows[0].completions).toBe(completions);
    expect(serviceEvents.rows[0].applications).toBe(totals.applications);
    expect(serviceEvents.rows[0].count).toBe(completions + totals.applications);
  });

  it("every seeded row is labeled and fictional, and the machinery closed what should be closed", async () => {
    const labels = await db.query<{ unlabeled: number; realish: number }>(
      `select
         count(*) filter (where source is distinct from '${DEMO_SOURCE}')::integer as unlabeled,
         count(*) filter (where email not like '%.example' or phone not like '(555)%')::integer as realish
       from public.crm_accounts where organization_id = $1`,
      [org],
    );
    expect(labels.rows[0]).toEqual({ unlabeled: 0, realish: 0 });

    const closed = await db.query<{ open_closed: number; closed_open: number; lost_without_detail: number }>(
      `select
         count(*) filter (where stage in ('won', 'lost') and closed_at is null)::integer as open_closed,
         count(*) filter (where stage not in ('won', 'lost') and closed_at is not null)::integer as closed_open,
         count(*) filter (where stage = 'lost' and lost_reason is null)::integer as lost_without_detail
       from public.crm_opportunities where organization_id = $1`,
      [org],
    );
    expect(closed.rows[0]).toEqual({ open_closed: 0, closed_open: 0, lost_without_detail: 0 });

    // One spot check that the trigger history reads as the story: the
    // Whitfield account walked lead → prospect → customer → inactive.
    const journey = await db.query<{ summary: string }>(
      `select events.summary
         from public.crm_timeline_events events
         join public.crm_accounts accounts
           on accounts.id = events.account_id
        where accounts.name = 'The Whitfield Bungalow'
          and events.kind = 'status_change'
          and events.summary like 'Status changed%'
        order by events.recorded_at`,
    );
    expect(journey.rows.map((row) => row.summary)).toEqual([
      "Status changed: lead → prospect.",
      "Status changed: prospect → customer.",
      "Status changed: customer → inactive.",
    ]);
  });
});
