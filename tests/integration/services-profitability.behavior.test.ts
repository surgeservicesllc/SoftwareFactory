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
 * Job profitability (ADR-231) against the real chain.
 *
 * The function prints its inputs and counts its unknowns. Revenue is the
 * visit's non-void invoices; labour is finished timesheets or, said so,
 * the scheduled window; chemicals are applications priced off their lot.
 * A margin is null — never zero — whenever any of those is unknown, so
 * "we lost money" and "we do not know" stay different answers. The window
 * is honoured, a rival sees nothing, and a negative cost is refused.
 */

const acmeOwner = "00000000-0000-4000-8000-000000031001";
const rivalOwner = "00000000-0000-4000-8000-000000031002";
const acmeOrg = "10000000-0000-4000-8000-000000031001";
const rivalOrg = "10000000-0000-4000-8000-000000031002";

type ProfitRow = {
  work_order_id: string;
  service_type: string;
  technician_name: string | null;
  revenue_cents: string | null;
  invoice_count: number;
  labour_minutes: number;
  labour_basis: string;
  hourly_cost_cents: number | null;
  labour_cost_cents: string | null;
  chemical_cost_cents: string;
  applications: number;
  uncosted_applications: number;
  margin_cents: string | null;
  margin_bps: number | null;
};

describe("job profitability: printed inputs, counted unknowns", { timeout: 240_000 }, () => {
  let db: PGlite;
  let accountId = "";
  let propertyId = "";
  let costedTech = "";
  let uncostedTech = "";
  let productId = "";
  let costedLot = "";
  let uncostedLot = "";
  const visits: Record<string, string> = {};

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function profitability(org: string, days = 90): Promise<ProfitRow[]> {
    const { rows } = await db.query<ProfitRow>(
      `select work_order_id, service_type, technician_name,
              revenue_cents::text as revenue_cents, invoice_count,
              labour_minutes, labour_basis, hourly_cost_cents,
              labour_cost_cents::text as labour_cost_cents,
              chemical_cost_cents::text as chemical_cost_cents,
              applications, uncosted_applications,
              margin_cents::text as margin_cents, margin_bps
         from public.crm_visit_profitability($1, $2)`,
      [org, days],
    );
    return rows;
  }

  async function completedVisit(
    serviceType: string,
    technicianId: string,
    windowMinutes: number,
  ): Promise<string> {
    return (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type,
          scheduled_start, scheduled_end, status, created_by)
       values ($1, $2, $3, $4, $5, now() - interval '1 day',
               now() - interval '1 day' + make_interval(mins => $6), 'completed', $7)
       returning id`,
      [acmeOrg, accountId, propertyId, technicianId, serviceType, windowMinutes, acmeOwner],
    )).rows[0].id;
  }

  async function invoice(number: string, workOrderId: string, subtotal: number, status = "open") {
    const voidColumns = status === "void" ? ", voided_at, void_reason" : "";
    const voidValues = status === "void" ? ", now(), 'Raised twice.'" : "";
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, work_order_id, number, status,
          subtotal_cents, tax_cents, total_cents, issued_on, created_by${voidColumns})
       values ($1, $2, $3, $4, $5, $6, 0, $6, current_date, $7${voidValues})`,
      [acmeOrg, accountId, workOrderId, number, status, subtotal, acmeOwner],
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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-profit', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-profit', '${rivalOwner}');
    `);

    await as(acmeOwner);
    accountId = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    propertyId = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview plant', '1 Loaf Lane') returning id`,
      [acmeOrg, accountId],
    )).rows[0].id;

    // One technician whose hourly cost is known ($40.00), one whose is not.
    costedTech = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, hourly_cost_cents, created_by)
       values ($1, 'Rosa', 'Vega', 4000, $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    uncostedTech = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Tom', 'Hale', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;

    // One product, two lots: one received at $1.50 an ounce, one whose cost
    // nobody entered.
    productId = (await db.query<{ id: string }>(
      `insert into public.crm_products (organization_id, name, default_unit, created_by)
       values ($1, 'Termidor SC', 'oz', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    costedLot = (await db.query<{ id: string }>(
      `insert into public.crm_product_lots
         (organization_id, product_id, lot_number, unit, quantity_received, quantity_remaining,
          unit_cost_cents, created_by)
       values ($1, $2, 'LOT-COSTED', 'oz', 100, 100, 150, $3) returning id`,
      [acmeOrg, productId, acmeOwner],
    )).rows[0].id;
    uncostedLot = (await db.query<{ id: string }>(
      `insert into public.crm_product_lots
         (organization_id, product_id, lot_number, unit, quantity_received, quantity_remaining, created_by)
       values ($1, $2, 'LOT-UNKNOWN', 'oz', 100, 100, $3) returning id`,
      [acmeOrg, productId, acmeOwner],
    )).rows[0].id;

    // Visit A: everything known. 90-minute shift with a 15-minute break
    // (75 min × $40/h = $50.00), 2 oz off the costed lot ($3.00), a $486.00
    // invoice — and a voided duplicate that must not count.
    visits.known = await completedVisit("Termite treatment", costedTech, 120);
    await db.query(
      `insert into public.crm_timesheets
         (organization_id, technician_id, work_order_id, started_at, ended_at, break_minutes, created_by)
       values ($1, $2, $3, now() - interval '3 hours', now() - interval '90 minutes', 15, $4)`,
      [acmeOrg, costedTech, visits.known, acmeOwner],
    );
    await db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, work_order_id, product_id, lot_id, technician_id,
          method, quantity, unit, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, 'perimeter', 2, 'oz', $8)`,
      [acmeOrg, accountId, propertyId, visits.known, productId, costedLot, costedTech, acmeOwner],
    );
    await invoice("INV-P-1001", visits.known, 48_600);
    await invoice("INV-P-1002", visits.known, 48_600, "void");

    // Visit B: no timesheet, so the 60-minute window stands in and says so.
    visits.window = await completedVisit("General pest", costedTech, 60);
    await invoice("INV-P-1003", visits.window, 10_000);

    // Visit C: the technician's hourly cost is unknown.
    visits.noRate = await completedVisit("Rodent", uncostedTech, 60);
    await invoice("INV-P-1004", visits.noRate, 5_000);

    // Visit D: an application off a lot with no cost on it.
    visits.uncosted = await completedVisit("Ant treatment", costedTech, 60);
    await db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, work_order_id, product_id, lot_id, technician_id,
          method, quantity, unit, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, 'spot', 1, 'oz', $8)`,
      [acmeOrg, accountId, propertyId, visits.uncosted, productId, uncostedLot, costedTech, acmeOwner],
    );
    await invoice("INV-P-1005", visits.uncosted, 7_000);

    // Visit E: completed, never invoiced.
    visits.unbilled = await completedVisit("Wasp removal", costedTech, 60);

    // Visit F: completed 200 days ago, outside the default window.
    visits.old = await completedVisit("Bed bug heat", costedTech, 60);
    await db.query(
      `update public.crm_work_orders set completed_at = now() - interval '200 days' where id = $1`,
      [visits.old],
    );
    await invoice("INV-P-1006", visits.old, 20_000);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("computes a visit whose every input is known, excluding void invoices", async () => {
    await as(acmeOwner);
    const rows = await profitability(acmeOrg);
    const known = rows.find((row) => row.work_order_id === visits.known);
    expect(known).toMatchObject({
      service_type: "Termite treatment",
      technician_name: "Rosa Vega",
      revenue_cents: "48600",
      invoice_count: 1,
      labour_minutes: 75,
      labour_basis: "timesheet",
      hourly_cost_cents: 4000,
      labour_cost_cents: "5000",
      chemical_cost_cents: "300",
      applications: 1,
      uncosted_applications: 0,
      margin_cents: "43300",
      margin_bps: 8909,
    });
  });

  it("uses the scheduled window when no shift was clocked, and says so", async () => {
    await as(acmeOwner);
    const rows = await profitability(acmeOrg);
    const window = rows.find((row) => row.work_order_id === visits.window);
    expect(window).toMatchObject({
      labour_minutes: 60,
      labour_basis: "window",
      labour_cost_cents: "4000",
      chemical_cost_cents: "0",
      applications: 0,
      margin_cents: "6000",
      margin_bps: 6000,
    });
  });

  it("leaves the margin null — not zero — for each kind of unknown", async () => {
    await as(acmeOwner);
    const rows = await profitability(acmeOrg);

    const noRate = rows.find((row) => row.work_order_id === visits.noRate);
    expect(noRate).toMatchObject({
      revenue_cents: "5000",
      hourly_cost_cents: null,
      labour_cost_cents: null,
      margin_cents: null,
      margin_bps: null,
    });

    const uncosted = rows.find((row) => row.work_order_id === visits.uncosted);
    expect(uncosted).toMatchObject({
      revenue_cents: "7000",
      labour_cost_cents: "4000",
      applications: 1,
      uncosted_applications: 1,
      chemical_cost_cents: "0",
      margin_cents: null,
      margin_bps: null,
    });

    const unbilled = rows.find((row) => row.work_order_id === visits.unbilled);
    expect(unbilled).toMatchObject({
      revenue_cents: null,
      invoice_count: 0,
      labour_cost_cents: "4000",
      margin_cents: null,
      margin_bps: null,
    });
  });

  it("orders the thinnest known margin first and honours the window", async () => {
    await as(acmeOwner);
    const rows = await profitability(acmeOrg);
    expect(rows.map((row) => row.work_order_id)).not.toContain(visits.old);
    expect(rows.slice(0, 2).map((row) => row.work_order_id)).toEqual([visits.window, visits.known]);
    expect(rows.slice(2).every((row) => row.margin_cents === null)).toBe(true);

    const yearRows = await profitability(acmeOrg, 365);
    expect(yearRows.map((row) => row.work_order_id)).toContain(visits.old);
    expect(yearRows.find((row) => row.work_order_id === visits.old)).toMatchObject({
      revenue_cents: "20000",
      margin_cents: "16000",
    });
  });

  it("shows a rival nothing, and only authenticated callers may run it", async () => {
    await as(rivalOwner);
    expect(await profitability(acmeOrg)).toHaveLength(0);
    expect(await profitability(rivalOrg)).toHaveLength(0);

    await db.exec("reset role");
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service_role: boolean }>(
      `select has_function_privilege('anon', 'public.crm_visit_profitability(uuid, integer)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.crm_visit_profitability(uuid, integer)', 'execute') as authenticated,
              has_function_privilege('service_role', 'public.crm_visit_profitability(uuid, integer)', 'execute') as service_role`,
    );
    expect(rows[0]).toEqual({ anon: false, authenticated: true, service_role: false });
  });

  it("refuses a negative or absurd cost on either input", async () => {
    await as(acmeOwner);
    await expect(db.query(
      `update public.crm_technicians set hourly_cost_cents = -1 where id = $1`,
      [costedTech],
    )).rejects.toThrow(/crm_technicians_hourly_cost_cents_check/);
    await expect(db.query(
      `update public.crm_product_lots set unit_cost_cents = 100000001 where id = $1`,
      [costedLot],
    )).rejects.toThrow(/crm_product_lots_unit_cost_cents_check/);

    // Clearing a cost is allowed: "unknown" is an honest answer.
    await db.query(`update public.crm_technicians set hourly_cost_cents = null where id = $1`, [costedTech]);
    const rows = await profitability(acmeOrg);
    expect(rows.find((row) => row.work_order_id === visits.known)?.margin_cents).toBeNull();
    await db.query(`update public.crm_technicians set hourly_cost_cents = 4000 where id = $1`, [costedTech]);
  });
});
