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
 * The operating dashboards (ADR-199) against the real migration chain.
 *
 * Every function under test is SECURITY INVOKER, so the first thing these
 * tests establish is that a dashboard cannot see further than the person
 * reading it: a rival's revenue must not appear in ours, and the tenant
 * boundary must hold through an aggregate exactly as it holds through a
 * list.
 *
 * The rest is arithmetic honesty, which is the whole reason these live in
 * SQL rather than in a route. A rate over an empty denominator must come
 * back null; a running shift must contribute no worked minutes; a draft
 * invoice must not count as revenue; and a technician who did nothing must
 * still appear, because an empty row is the finding.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000c301";
const rivalOwner = "00000000-0000-4000-8000-00000000c302";
const acmeOrg = "10000000-0000-4000-8000-00000000c301";
const rivalOrg = "10000000-0000-4000-8000-00000000c302";

describe("the operating dashboards", { timeout: 240_000 }, () => {
  let db: PGlite;
  let acmeAccount = "";
  let acmeProperty = "";
  let rivalAccount = "";
  let busyTech = "";
  let idleTech = "";

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
    `);

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(latestMigration);
    for (const file of migrationFiles) {
      // Hosted grants ALL on every new table by default, so the chain is
      // replayed under that posture.
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

  it("builds two tenants with a book each", async () => {
    await as(acmeOwner);
    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    acmeAccount = account.rows[0].id;

    const property = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Main kitchen', '1 Dock Road, Portsview, OR 97001') returning id`,
      [acmeOrg, acmeAccount],
    );
    acmeProperty = property.rows[0].id;

    // An inactive account, so retention has a real denominator rather than
    // a book where nobody ever left.
    await db.query(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Lapsed Diner', 'commercial', 'inactive', $2)`,
      [acmeOrg, acmeOwner],
    );

    const busy = await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Dana', 'Okafor', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    busyTech = busy.rows[0].id;
    const idle = await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Sam', 'Trevino', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    idleTech = idle.rows[0].id;
    await reset();

    await as(rivalOwner);
    const rival = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Rival Grocers', 'commercial', 'customer', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    rivalAccount = rival.rows[0].id;
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents,
          issued_on, created_by)
       values ($1, $2, 'INV-R-1', 'open', 900000, 0, 900000, current_date, $3)`,
      [rivalOrg, rivalAccount, rivalOwner],
    );
    await reset();

    expect(acmeAccount).not.toBe(rivalAccount);
    expect(busyTech).not.toBe(idleTech);
  });

  it("counts issued invoices as revenue and drafts as nothing", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents,
          issued_on, created_by)
       values ($1, $2, 'INV-A-1', 'open', 100000, 0, 100000, current_date, $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );
    // Never issued to anybody, so it is not revenue.
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, created_by)
       values ($1, $2, 'INV-A-DRAFT', 'draft', 500000, 0, 500000, $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );

    const { rows } = await db.query<{ invoiced_cents: string; invoice_count: number }>(
      `select invoiced_cents::text, invoice_count from public.crm_revenue_by_month(1)`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiced_cents).toBe("100000");
    expect(rows[0].invoice_count).toBe(1);
    await reset();
  });

  it("reports a collection rate of null when nothing was invoiced, never zero", async () => {
    await as(acmeOwner);
    // Twelve months back: only the current month carries an invoice, so
    // every earlier month has an empty denominator.
    const { rows } = await db.query<{ month: string; collection_rate_bps: number | null }>(
      `select month::text, collection_rate_bps from public.crm_revenue_by_month(12) order by month`,
    );
    expect(rows).toHaveLength(12);
    for (const row of rows.slice(0, 11)) {
      expect(row.collection_rate_bps, `${row.month} reported a rate over nothing`).toBeNull();
    }
    // The month that WAS billed has a rate, and it is zero because nothing
    // has been collected — a real measurement, unlike the nulls above.
    expect(rows[11].collection_rate_bps).toBe(0);
    await reset();
  });

  it("moves the collection rate when money actually arrives, net of refunds", async () => {
    await as(acmeOwner);
    const invoice = await db.query<{ id: string }>(
      `select id from public.crm_invoices where organization_id = $1 and number = 'INV-A-1'`,
      [acmeOrg],
    );
    await db.query(
      `insert into public.crm_payments
         (organization_id, invoice_id, account_id, amount_cents, method, created_by)
       values ($1, $2, $3, 80000, 'check', $4)`,
      [acmeOrg, invoice.rows[0].id, acmeAccount, acmeOwner],
    );

    const paid = await db.query<{ collected_cents: string; collection_rate_bps: number }>(
      `select collected_cents::text, collection_rate_bps from public.crm_revenue_by_month(1)`,
    );
    expect(paid.rows[0].collected_cents).toBe("80000");
    // 80,000 of 100,000 = 8000 basis points.
    expect(paid.rows[0].collection_rate_bps).toBe(8000);

    const payment = await db.query<{ id: string }>(
      `select id from public.crm_payments where organization_id = $1 limit 1`,
      [acmeOrg],
    );
    await db.query(
      `insert into public.crm_refunds
         (organization_id, payment_id, amount_cents, reason, created_by)
       values ($1, $2, 30000, 'Duplicate charge on the account.', $3)`,
      [acmeOrg, payment.rows[0].id, acmeOwner],
    );

    const refunded = await db.query<{ refunded_cents: string; collection_rate_bps: number }>(
      `select refunded_cents::text, collection_rate_bps from public.crm_revenue_by_month(1)`,
    );
    expect(refunded.rows[0].refunded_cents).toBe("30000");
    // A refund is money that left again, so the rate falls: (80k-30k)/100k.
    expect(refunded.rows[0].collection_rate_bps).toBe(5000);
    await reset();
  });

  it("never shows one tenant another tenant's money", async () => {
    // The rival billed 900,000 in the same month. An invoker function
    // aggregates under the reader's own RLS, so it must not appear.
    await as(acmeOwner);
    const ours = await db.query<{ invoiced_cents: string }>(
      `select invoiced_cents::text from public.crm_revenue_by_month(1)`,
    );
    expect(ours.rows[0].invoiced_cents).toBe("100000");

    await as(rivalOwner);
    const theirs = await db.query<{ invoiced_cents: string }>(
      `select invoiced_cents::text from public.crm_revenue_by_month(1)`,
    );
    expect(theirs.rows[0].invoiced_cents).toBe("900000");
    await reset();
  });

  it("ages a receivable into the bucket its due date puts it in, and names the empty ones", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents,
          issued_on, due_on, created_by)
       values ($1, $2, 'INV-A-OLD', 'open', 45000, 0, 45000,
               current_date - 120, current_date - 100, $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );

    const { rows } = await db.query<{ bucket: string; invoice_count: number; balance_cents: string }>(
      `select bucket, invoice_count, balance_cents::text from public.crm_receivable_aging()`,
    );
    // Every bucket reports itself, empty or not: a missing row reads as
    // "no data" where a zero reads as "nothing overdue".
    expect(rows.map((row) => row.bucket)).toEqual([
      "current", "1-30", "31-60", "61-90", "90+", "undated",
    ]);
    const ninetyPlus = rows.find((row) => row.bucket === "90+");
    expect(ninetyPlus?.invoice_count).toBe(1);
    expect(ninetyPlus?.balance_cents).toBe("45000");
    // INV-A-1 has no due date at all and lands in `undated` rather than
    // being quietly aged as though it were current.
    expect(rows.find((row) => row.bucket === "undated")?.invoice_count).toBe(1);
    expect(rows.find((row) => row.bucket === "31-60")?.invoice_count).toBe(0);
    await reset();
  });

  it("reports retention against the whole book, and the customers nobody serves", async () => {
    await as(acmeOwner);
    const { rows } = await db.query<{
      customers: number; inactive: number; customers_without_plan: number; retention_bps: number;
    }>(
      `select customers, inactive, customers_without_plan, retention_bps
         from public.crm_retention_summary()`,
    );
    expect(rows[0].customers).toBe(1);
    expect(rows[0].inactive).toBe(1);
    // One of two accounts is still a customer.
    expect(rows[0].retention_bps).toBe(5000);
    // And that customer has no active plan, which is the number a branch
    // would rather not look at and therefore the one worth reporting.
    expect(rows[0].customers_without_plan).toBe(1);
    await reset();
  });

  it("returns null retention for a book with nobody in it", async () => {
    await as(rivalOwner);
    await db.query(
      "update public.crm_accounts set status = 'prospect' where organization_id = $1",
      [rivalOrg],
    );
    const { rows } = await db.query<{ retention_bps: number | null; customers: number }>(
      `select retention_bps, customers from public.crm_retention_summary()`,
    );
    expect(rows[0].customers).toBe(0);
    // Nothing to retain is not the same as retaining nothing.
    expect(rows[0].retention_bps).toBeNull();
    await db.query(
      "update public.crm_accounts set status = 'customer' where organization_id = $1",
      [rivalOrg],
    );
    await reset();
  });

  it("keeps the technician who did nothing on the list", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type,
          scheduled_start, scheduled_end, status, created_by)
       values
         ($1, $2, $3, $4, 'General pest', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'completed', $5),
         ($1, $2, $3, $4, 'General pest', now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 'scheduled', $5),
         ($1, $2, $3, $4, 'General pest', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'cancelled', $5)`,
      [acmeOrg, acmeAccount, acmeProperty, busyTech, acmeOwner],
    );

    const { rows } = await db.query<{
      technician_id: string; scheduled: number; completed: number; completion_rate_bps: number | null;
    }>(
      `select technician_id, scheduled, completed, completion_rate_bps
         from public.crm_technician_productivity(90)`,
    );
    expect(rows).toHaveLength(2);
    const busy = rows.find((row) => row.technician_id === busyTech);
    const idle = rows.find((row) => row.technician_id === idleTech);
    expect(busy?.scheduled).toBe(3);
    expect(busy?.completed).toBe(1);
    expect(busy?.completion_rate_bps).toBe(3333);
    // Present, with a null rate rather than a zero one: nothing was
    // scheduled for them, so there is no rate to report.
    expect(idle?.scheduled).toBe(0);
    expect(idle?.completion_rate_bps).toBeNull();
    await reset();
  });

  it("counts a finished shift's labour and refuses to count a running one", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_timesheets
         (organization_id, technician_id, started_at, ended_at, break_minutes, created_by)
       values ($1, $2, now() - interval '2 days', now() - interval '2 days' + interval '8 hours', 30, $3)`,
      [acmeOrg, busyTech, acmeOwner],
    );

    const finished = await db.query<{ worked_minutes: string | null; running_shifts: number }>(
      `select worked_minutes::text, running_shifts from public.crm_technician_productivity(90)
        where technician_id = $1`,
      [busyTech],
    );
    // Eight hours less a thirty-minute break.
    expect(finished.rows[0].worked_minutes).toBe("450");
    expect(finished.rows[0].running_shifts).toBe(0);

    await db.query(
      `insert into public.crm_timesheets
         (organization_id, technician_id, started_at, break_minutes, created_by)
       values ($1, $2, now() - interval '30 minutes', 0, $3)`,
      [acmeOrg, busyTech, acmeOwner],
    );
    const running = await db.query<{ worked_minutes: string | null; running_shifts: number }>(
      `select worked_minutes::text, running_shifts from public.crm_technician_productivity(90)
        where technician_id = $1`,
      [busyTech],
    );
    // The open shift is counted as open, and contributes no minutes —
    // treating it as finished would inflate every figure built on it.
    expect(running.rows[0].worked_minutes).toBe("450");
    expect(running.rows[0].running_shifts).toBe(1);

    // A technician whose shifts are ALL still running has no worked total,
    // which is null rather than zero.
    await db.query(
      `insert into public.crm_timesheets
         (organization_id, technician_id, started_at, break_minutes, created_by)
       values ($1, $2, now() - interval '10 minutes', 0, $3)`,
      [acmeOrg, idleTech, acmeOwner],
    );
    const openOnly = await db.query<{ worked_minutes: string | null; running_shifts: number }>(
      `select worked_minutes::text, running_shifts from public.crm_technician_productivity(90)
        where technician_id = $1`,
      [idleTech],
    );
    expect(openOnly.rows[0].worked_minutes).toBeNull();
    expect(openOnly.rows[0].running_shifts).toBe(1);
    await reset();
  });

  it("measures the shape of a day, and calls a single stop's idle time unknown", async () => {
    await as(acmeOwner);
    // Two stops three hours apart, one hour each: a two-hour hole between.
    await db.query(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type,
          scheduled_start, scheduled_end, status, created_by)
       values
         ($1, $2, $3, $4, 'Rodent', date_trunc('day', now()) + interval '8 hours',
          date_trunc('day', now()) + interval '9 hours', 'scheduled', $5),
         ($1, $2, $3, $4, 'Rodent', date_trunc('day', now()) + interval '11 hours',
          date_trunc('day', now()) + interval '12 hours', 'scheduled', $5)`,
      [acmeOrg, acmeAccount, acmeProperty, idleTech, acmeOwner],
    );

    const { rows } = await db.query<{
      stops: number; span_minutes: number; booked_minutes: number; idle_minutes: number | null;
    }>(
      `select stops, span_minutes, booked_minutes, idle_minutes
         from public.crm_route_density(14)
        where technician_id = $1 and day = current_date`,
      [idleTech],
    );
    expect(rows[0].stops).toBe(2);
    expect(rows[0].span_minutes).toBe(240);
    expect(rows[0].booked_minutes).toBe(120);
    expect(rows[0].idle_minutes).toBe(120);

    // The busy technician's days have one stop each. One stop has no gaps,
    // and reporting zero idle would read as a full day.
    const single = await db.query<{ stops: number; idle_minutes: number | null }>(
      `select stops, idle_minutes from public.crm_route_density(14)
        where technician_id = $1 order by day desc`,
      [busyTech],
    );
    expect(single.rows.every((row) => row.stops === 1)).toBe(true);
    expect(single.rows.every((row) => row.idle_minutes === null)).toBe(true);
    await reset();
  });

  it("leaves a cancelled visit out of the route, because nobody drove to it", async () => {
    await as(acmeOwner);
    const { rows } = await db.query<{ stops: number }>(
      `select stops from public.crm_route_density(14)
        where technician_id = $1 and day = (now() - interval '3 days')::date`,
      [busyTech],
    );
    // The only work order that day was cancelled.
    expect(rows).toEqual([]);
    await reset();
  });

  it("gives anon and service_role no way to run any of them", async () => {
    await reset();
    const { rows } = await db.query<{ proname: string; grantee: string }>(
      `select p.proname, r.rolname as grantee
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join unnest(array['anon', 'service_role']) as r(rolname)
        where n.nspname = 'public'
          and p.proname in ('crm_revenue_by_month', 'crm_receivable_aging',
                            'crm_retention_summary', 'crm_technician_productivity',
                            'crm_route_density')
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );
    expect(rows).toEqual([]);

    // And none of them is a definer: an aggregate over a whole book run as
    // its owner would be an aggregate over every tenant at once.
    const { rows: definers } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.proname in ('crm_revenue_by_month', 'crm_receivable_aging',
                            'crm_retention_summary', 'crm_technician_productivity',
                            'crm_route_density')`,
    );
    expect(definers).toEqual([]);
  });
});
