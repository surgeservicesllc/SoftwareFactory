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
 * Invoices built from the visit (ADR-212) against the real chain.
 *
 * An invoice could already NAME a work order while its lines were typed by
 * hand, which made the document a customer receives and the record of what
 * happened two stories that agree only while somebody keeps them agreeing.
 *
 * Four things must be impossible, and each has a test: billing a visit that
 * has not happened, billing one visit twice, restating a document the
 * customer already holds, and printing a quantity that is not the one the
 * compliance log recorded.
 */

const acmeOwner = "00000000-0000-4000-8000-000000012001";
const rivalOwner = "00000000-0000-4000-8000-000000012002";
const acmeOrg = "10000000-0000-4000-8000-000000012001";
const rivalOrg = "10000000-0000-4000-8000-000000012002";

describe("an invoice built from the visit", { timeout: 240_000 }, () => {
  let db: PGlite;

  let account = "";
  let site = "";
  let technician = "";
  let plan = "";
  let product = "";
  let smallDoseProduct = "";
  let visit = "";
  let openVisit = "";
  let rivalAccount = "";
  let invoiceNumber = 0;

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function newInvoice(organization: string, owner: string, forAccount: string, tax = 0) {
    invoiceNumber += 1;
    const created = await db.query<{ id: string; number: string }>(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents,
          total_cents, created_by)
       values ($1, $2, $3, 'draft', 0, $4, $4, $5) returning id, number`,
      [organization, forAccount, `INV-${1000 + invoiceNumber}`, tax, owner],
    );
    return created.rows[0];
  }

  async function completedVisit(serviceType: string, completedAt: string, withPlan = true) {
    const created = await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, plan_id, status,
          service_type, scheduled_start, scheduled_end, completed_at, created_by)
       values ($1, $2, $3, $4, $5, 'completed', $6, $7,
               ($7::timestamptz + interval '2 hours'), $8, $9) returning id`,
      [acmeOrg, account, site, technician, withPlan ? plan : null, serviceType,
        completedAt, completedAt, acmeOwner],
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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-invoice', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-invoice', '${rivalOwner}');
    `);

    await as(acmeOwner);
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    site = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Plant', '4100 Cannery Row') returning id`,
      [acmeOrg, account],
    )).rows[0].id;
    technician = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Ada', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    plan = (await db.query<{ id: string }>(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, created_by)
       values ($1, $2, $3, 'Quarterly IPM', 'quarterly', '2026-04-01', 154000, $4) returning id`,
      [acmeOrg, account, site, acmeOwner],
    )).rows[0].id;
    product = (await db.query<{ id: string }>(
      `insert into public.crm_products
         (organization_id, name, epa_registration_number, default_unit, created_by)
       values ($1, 'Termidor SC', '90000-123', 'fl_oz', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    smallDoseProduct = (await db.query<{ id: string }>(
      `insert into public.crm_products
         (organization_id, name, epa_registration_number, default_unit, created_by)
       values ($1, 'Advion Gel', '90000-456', 'oz', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;

    visit = await completedVisit("Quarterly IPM", "2026-01-12T10:42:00Z");
    openVisit = (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, status, service_type,
          scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, $4, 'dispatched', 'Quarterly IPM',
               '2026-02-12T09:00:00Z', '2026-02-12T11:00:00Z', $5) returning id`,
      [acmeOrg, account, site, technician, acmeOwner],
    )).rows[0].id;

    await as(rivalOwner);
    rivalAccount = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Rival Diner', 'commercial', 'customer', $2) returning id`,
      [rivalOrg, rivalOwner],
    )).rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("puts the service and every chemical on the invoice, and makes the totals agree", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, work_order_id, product_id, technician_id,
          method, target_pest, quantity, unit, applied_at, created_by)
       values ($1, $2, $3, $4, $5, $6, 'perimeter', 'German cockroach', 100.000, 'fl_oz',
               '2026-01-12T10:00:00Z', $7)`,
      [acmeOrg, account, site, visit, product, technician, acmeOwner],
    );
    const invoice = await newInvoice(acmeOrg, acmeOwner, account, 1000);

    const built = await db.query<{
      line_position: number; line_description: string; line_amount_cents: number;
      line_source: string;
    }>("select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, visit]);

    expect(built.rows.map((row) => row.line_source)).toEqual(["work_order", "application"]);
    expect(built.rows[0].line_description).toBe("Quarterly IPM — 12 Jan 2026");
    expect(built.rows[0].line_amount_cents).toBe(154_000);
    expect(built.rows[1].line_description)
      .toBe("Termidor SC — 100 fl_oz for German cockroach (EPA 90000-123)");
    // The material is part of the service; the line says what, not what it cost.
    expect(built.rows[1].line_amount_cents).toBe(0);

    const totals = await db.query<{
      subtotal_cents: number; total_cents: number; work_order_id: string;
    }>("select subtotal_cents, tax_cents, total_cents, work_order_id from public.crm_invoices where id = $1",
      [invoice.id]);
    expect(totals.rows[0].subtotal_cents).toBe(154_000);
    expect(totals.rows[0].total_cents).toBe(155_000);
    expect(totals.rows[0].work_order_id).toBe(visit);
  });

  it("refuses a second build rather than quietly doubling the invoice", async () => {
    await as(acmeOwner);
    const invoice = await newInvoice(acmeOrg, acmeOwner, account);
    const second = await completedVisit("Rodent service", "2026-03-02T14:00:00Z");
    await db.query("select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, second]);

    await expect(
      db.query("select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, second]),
    ).rejects.toThrow(/already built from a visit/);

    const lines = await db.query<{ n: string }>(
      "select count(*) as n from public.crm_invoice_lines where invoice_id = $1", [invoice.id]);
    expect(Number(lines.rows[0].n)).toBe(1);
  });

  it("refuses to bill one visit on two invoices, and says which one already has it", async () => {
    await as(acmeOwner);
    const third = await completedVisit("Perimeter service", "2026-03-09T12:00:00Z");
    const first = await newInvoice(acmeOrg, acmeOwner, account);
    await db.query("select * from public.crm_invoice_lines_from_visit($1, $2)", [first.id, third]);

    const second = await newInvoice(acmeOrg, acmeOwner, account);
    await expect(
      db.query("select * from public.crm_invoice_lines_from_visit($1, $2)", [second.id, third]),
    ).rejects.toThrow(new RegExp(`already billed on invoice ${first.number}`));
  });

  it("will not bill a visit that has not happened", async () => {
    await as(acmeOwner);
    const invoice = await newInvoice(acmeOrg, acmeOwner, account);

    await expect(
      db.query("select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, openVisit]),
    ).rejects.toThrow(/is dispatched — a visit is billed after it happens/);
  });

  it("will not rebuild a document the customer already has", async () => {
    await as(acmeOwner);
    const invoice = await newInvoice(acmeOrg, acmeOwner, account);
    await db.query(
      "update public.crm_invoices set status = 'open', issued_on = '2026-03-01' where id = $1",
      [invoice.id],
    );
    const fourth = await completedVisit("Bait service", "2026-03-16T12:00:00Z");

    await expect(
      db.query("select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, fourth]),
    ).rejects.toThrow(/can no longer be rebuilt from a visit/);
  });

  it("bills the correction, not the mistake it replaced", async () => {
    await as(acmeOwner);
    const fifth = await completedVisit("Interior service", "2026-04-06T11:00:00Z");
    const original = await db.query<{ id: string }>(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, work_order_id, product_id, technician_id,
          method, target_pest, quantity, unit, applied_at, created_by)
       values ($1, $2, $3, $4, $5, $6, 'spot', 'Ant', 12.000, 'fl_oz', '2026-04-06T10:00:00Z', $7)
       returning id`,
      [acmeOrg, account, site, fifth, product, technician, acmeOwner],
    );
    await db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, work_order_id, product_id, technician_id,
          method, target_pest, quantity, unit, applied_at, supersedes_id, created_by)
       values ($1, $2, $3, $4, $5, $6, 'spot', 'Ant', 6.000, 'fl_oz', '2026-04-06T10:00:00Z', $7, $8)`,
      [acmeOrg, account, site, fifth, product, technician, original.rows[0].id, acmeOwner],
    );
    const invoice = await newInvoice(acmeOrg, acmeOwner, account);

    const built = await db.query<{ line_description: string; line_source: string }>(
      "select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, fifth]);

    const chemicals = built.rows.filter((row) => row.line_source === "application");
    expect(chemicals).toHaveLength(1);
    expect(chemicals[0].line_description).toContain("6 fl_oz");
  });

  it("prints the amount the compliance log recorded, not a rounded one", async () => {
    await as(acmeOwner);
    const sixth = await completedVisit("Gel treatment", "2026-04-20T09:30:00Z");
    await db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, work_order_id, product_id, technician_id,
          method, target_pest, quantity, unit, applied_at, created_by)
       values ($1, $2, $3, $4, $5, $6, 'crack_and_crevice', 'Cockroach', 0.125, 'oz',
               '2026-04-20T09:00:00Z', $7)`,
      [acmeOrg, account, site, sixth, smallDoseProduct, technician, acmeOwner],
    );
    const invoice = await newInvoice(acmeOrg, acmeOwner, account);

    const built = await db.query<{
      line_description: string; line_quantity: string; line_source: string;
    }>("select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, sixth]);

    const chemical = built.rows.find((row) => row.line_source === "application");
    // 0.125 in a numeric(12,2) column would have become 0.13.
    expect(chemical?.line_description).toContain("0.125 oz");
    // The line counts one application; the amount lives in the description.
    expect(Number(chemical?.line_quantity)).toBe(1);
  });

  it("prices a one-off visit at zero rather than guessing", async () => {
    await as(acmeOwner);
    const oneOff = await completedVisit("Emergency call-out", "2026-05-04T16:00:00Z", false);
    const invoice = await newInvoice(acmeOrg, acmeOwner, account);

    const built = await db.query<{ line_amount_cents: number }>(
      "select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, oneOff]);

    expect(built.rows[0].line_amount_cents).toBe(0);
  });

  it("keeps hand-typed lines and numbers the generated ones after them", async () => {
    await as(acmeOwner);
    const seventh = await completedVisit("Exterior service", "2026-05-11T10:00:00Z");
    const invoice = await newInvoice(acmeOrg, acmeOwner, account);
    await db.query(
      `insert into public.crm_invoice_lines
         (organization_id, invoice_id, position, description, quantity,
          unit_price_cents, amount_cents)
       values ($1, $2, 1, 'After-hours surcharge', 1, 5000, 5000)`,
      [acmeOrg, invoice.id],
    );

    const built = await db.query<{ line_position: number; line_source: string }>(
      "select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, seventh]);

    expect(built.rows.map((row) => [row.line_position, row.line_source]))
      .toEqual([[1, "manual"], [2, "work_order"]]);
    const totals = await db.query<{ subtotal_cents: number }>(
      "select subtotal_cents from public.crm_invoices where id = $1", [invoice.id]);
    expect(totals.rows[0].subtotal_cents).toBe(159_000);
  });

  it("refuses a visit belonging to a different account than the invoice", async () => {
    await as(acmeOwner);
    const other = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Second Account', 'residential', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const invoice = await newInvoice(acmeOrg, acmeOwner, other.rows[0].id);
    const eighth = await completedVisit("Wrong account", "2026-05-18T10:00:00Z");

    await expect(
      db.query("select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, eighth]),
    ).rejects.toThrow(/different account than this invoice/);
  });

  it("keeps one book's visits out of another's invoices", async () => {
    await as(rivalOwner);
    const invoice = await newInvoice(rivalOrg, rivalOwner, rivalAccount);

    // Acme's visit is not selectable here, so it reads as absent rather
    // than as a permission error that would confirm it exists.
    await expect(
      db.query("select * from public.crm_invoice_lines_from_visit($1, $2)", [invoice.id, visit]),
    ).rejects.toThrow(/no such work order in this workspace/);
  });

  it("leaves the generator an invoker, and invoice lines still undeletable", async () => {
    await db.exec("reset role");
    const definer = await db.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.proname = 'crm_invoice_lines_from_visit'`,
    );
    const deletable = await db.query(
      `select grantee from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'crm_invoice_lines'
          and privilege_type = 'DELETE'
          and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC')`,
    );

    expect(definer.rows).toEqual([]);
    // Generation never needed a delete grant, which is the reason it builds
    // once rather than rebuilding.
    expect(deletable.rows).toEqual([]);
  });
});
