// @vitest-environment node

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSeed } from "@/lib/services/seed-runner";
import { SEED_RECORD_FLOOR, buildSeedReport, formatSeedReport } from "@/lib/services/seed-validation";
import { generateOperations, generateSeedDataset } from "@/lib/services/seed-generator";
import { pgliteSupabaseClient } from "../support/pglite-supabase-client";
import { LATEST_MIGRATION } from "../support/latest-migration";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = LATEST_MIGRATION;

/**
 * The full-scale seed, run for real.
 *
 * The production seeder and the production validator execute unmodified
 * against real PostgreSQL carrying the real migration chain — every CHECK,
 * every foreign key, every trigger, the append-only grants. What this
 * suite proves is not that the generator produced plausible objects, but
 * that the database accepted them and that the resulting book satisfies
 * the goal's floor: 250+ rows per table, every optional column populated,
 * broad enum coverage, and not one orphan.
 *
 * The report it prints is the deliverable the goal asks for.
 */

const owner = "00000000-0000-4000-8000-00000000f001";
const org = "10000000-0000-4000-8000-00000000f001";

describe("the full-scale CRM seed", { timeout: 900_000 }, () => {
  let db: PGlite;
  let client: SupabaseClient;

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
      values ('${org}', 'Seed Org', 'seed-org', '${owner}');
    `);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec("set role authenticated");

    client = pgliteSupabaseClient(db) as unknown as SupabaseClient;
  }, 900_000);

  afterAll(async () => {
    await db?.close();
  });

  it("seeds the whole relational book through the product's own writes", async () => {
    const outcome = await runSeed(client, org, owner, "full");
    if ("error" in outcome) {
      throw new Error(`Seed failed: ${outcome.error.message}`);
    }
    const seeded = outcome.seeded;

    // Every table the product writes clears the floor.
    for (const [name, count] of Object.entries(seeded)) {
      expect(count, `${name} seeded ${count}`).toBeGreaterThanOrEqual(SEED_RECORD_FLOOR);
    }
  });

  it("passes its own audit: counts, relationships, optional fields, enum spread, orphans", async () => {
    const report = await buildSeedReport(client, org);
    /*
     * The table-by-table report is the deliverable, so it is written where
     * it survives the run: to SEED_REPORT_PATH when a caller names one
     * (CI, or a person capturing it), and to stdout directly — a passing
     * vitest run swallows console output, and a report nobody can read is
     * not a report.
     */
    const rendered = formatSeedReport(report);
    process.stdout.write(`\n${rendered}\n`);
    const target = process.env.SEED_REPORT_PATH;
    if (target) await writeFile(target, `${rendered}\n`, "utf8");

    const failing = report.tables.filter((table) => !table.pass);
    expect(
      failing.map((table) => `${table.table}: ${table.notes.join("; ") || "below floor or orphaned"}`),
    ).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.totals.tables).toBe(42);
  });

  it("earned its history through the database, not by forging system rows", async () => {
    // Status changes, stage moves, completions and applications are all
    // trigger-written. If the seeder had inserted them by hand, the actor
    // and shape would not line up with the machinery's own.
    const system = await db.query<{ kind: string; count: number }>(
      `select kind::text, count(*)::integer as count
         from public.crm_timeline_events
        where organization_id = $1 and kind in ('status_change', 'service')
        group by kind order by kind`,
      [org],
    );
    const byKind = new Map(system.rows.map((row) => [row.kind, row.count]));
    expect(byKind.get("status_change") ?? 0).toBeGreaterThan(0);
    expect(byKind.get("service") ?? 0).toBeGreaterThan(0);

    // The service events are the two real writers: completions name their
    // property, applications name their method.
    const shapes = await db.query<{ completions: number; applications: number }>(
      `select
         count(*) filter (where detail like 'Property: %')::integer as completions,
         count(*) filter (where summary like 'Applied %')::integer as applications
       from public.crm_timeline_events
      where organization_id = $1 and kind = 'service'`,
      [org],
    );
    expect(shapes.rows[0].completions).toBeGreaterThan(0);
    expect(shapes.rows[0].applications).toBeGreaterThan(0);

    // Lots really moved: at least one has been drawn below what arrived.
    const drawn = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.crm_product_lots
        where organization_id = $1 and quantity_remaining < quantity_received`,
      [org],
    );
    expect(drawn.rows[0].count).toBeGreaterThan(0);

    // Stations carry their install scan plus their service history.
    const ledger = await db.query<{ devices: number; installs: number }>(
      `select
         (select count(*)::integer from public.crm_devices where organization_id = $1) as devices,
         (select count(*)::integer from public.crm_device_events
           where organization_id = $1 and event = 'install') as installs`,
      [org],
    );
    expect(ledger.rows[0].installs).toBe(ledger.rows[0].devices);
  });

  it("covers the lifecycle spread a real book shows", async () => {
    const statuses = await db.query<{ status: string; count: number }>(
      `select status::text, count(*)::integer as count from public.crm_accounts
        where organization_id = $1 group by status order by status`,
      [org],
    );
    const byStatus = new Map(statuses.rows.map((row) => [row.status, row.count]));
    for (const status of ["lead", "prospect", "customer", "inactive"]) {
      expect(byStatus.get(status) ?? 0, `${status} accounts`).toBeGreaterThan(0);
    }

    const stages = await db.query<{ stage: string }>(
      `select distinct stage::text from public.crm_opportunities where organization_id = $1`,
      [org],
    );
    // Every pipeline stage is represented, won and lost included.
    expect(stages.rows.length).toBeGreaterThanOrEqual(6);

    const visitStatuses = await db.query<{ status: string }>(
      `select distinct status::text from public.crm_work_orders where organization_id = $1`,
      [org],
    );
    expect(visitStatuses.rows.length).toBeGreaterThanOrEqual(4);

    // Residential and commercial both, across multiple years of history.
    const kinds = await db.query<{ kind: string; count: number }>(
      `select kind::text, count(*)::integer as count from public.crm_accounts
        where organization_id = $1 group by kind`,
      [org],
    );
    expect(kinds.rows.length).toBe(2);
    for (const row of kinds.rows) expect(row.count).toBeGreaterThan(20);

    const span = await db.query<{ years: number }>(
      `select (extract(epoch from (max(occurred_at) - min(occurred_at))) / 31557600)::numeric(6,2)::float8 as years
         from public.crm_timeline_events where organization_id = $1`,
      [org],
    );
    expect(span.rows[0].years).toBeGreaterThan(1);
  });

  it("generates identically on a second run, so a reseed is controlled", async () => {
    // Determinism is what makes the seed idempotent in practice: the same
    // natural keys collide with the database's unique constraints instead
    // of silently doubling the book.
    const first = generateSeedDataset("full");
    const second = generateSeedDataset("full");
    expect(second.accounts.map((account) => account.name))
      .toEqual(first.accounts.map((account) => account.name));
    expect(second.products.map((product) => product.epaRegistrationNumber))
      .toEqual(first.products.map((product) => product.epaRegistrationNumber));

    const firstOperations = generateOperations(first.accounts[7], first);
    const secondOperations = generateOperations(second.accounts[7], second);
    expect(secondOperations.devices.map((device) => device.barcode))
      .toEqual(firstOperations.devices.map((device) => device.barcode));

    // And a re-seed into the same workspace is refused by the database
    // rather than quietly duplicating: the barcode is already taken.
    const barcode = firstOperations.devices[0]?.barcode;
    if (barcode) {
      const account = await db.query<{ id: string; property_id: string }>(
        `select devices.account_id as id, devices.property_id
           from public.crm_devices devices
          where devices.organization_id = $1 and devices.barcode = $2`,
        [org, barcode],
      );
      await expect(db.query(
        `insert into public.crm_devices
           (organization_id, account_id, property_id, label, device_type, barcode, created_by)
         values ($1, $2, $3, 'Duplicate', 'bait_station', $4, $5)`,
        [org, account.rows[0].id, account.rows[0].property_id, barcode, owner],
      )).rejects.toThrow(/duplicate key|crm_devices_org_barcode_key/);
    }
  });
});
