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
 * Revenue forecasting (ADR-202) against the real chain.
 *
 * The design claim is that a forecast projects what is ON THE BOOKS and
 * nothing else — no churn multiplier, no growth curve. So the tests are
 * mostly arithmetic: does a monthly plan contribute its value once a
 * month, does a quarterly contribute a third, does an inactive one
 * contribute nothing, and does an open-ended contract stay out of the
 * contracted line rather than being guessed at.
 *
 * The weekly case has its own test because it is the one everybody gets
 * wrong: a month is not four weeks, and billing twelve four-week months
 * loses a whole cycle a year.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000d301";
const rivalOwner = "00000000-0000-4000-8000-00000000d302";
const acmeOrg = "10000000-0000-4000-8000-00000000d301";
const rivalOrg = "10000000-0000-4000-8000-00000000d302";

describe("revenue forecasting", { timeout: 240_000 }, () => {
  let db: PGlite;
  let acmeAccount = "";
  let acmeProperty = "";

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
    await reset();
  });

  afterAll(async () => {
    await db?.close();
  });

  it("projects a monthly plan once a month", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, created_by)
       values ($1, $2, $3, 'General pest', 'monthly', current_date, 25000, $4)`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );
    const { rows } = await db.query<{ recurring_cents: string; plans: number }>(
      `select recurring_cents::text, plans from public.crm_revenue_forecast(3) order by month`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.recurring_cents === "25000")).toBe(true);
    expect(rows[0].plans).toBe(1);
    await reset();
  });

  it("projects a quarterly plan as a third of its value each month", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, created_by)
       values ($1, $2, $3, 'Rodent program', 'quarterly', current_date, 60000, $4)`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );
    const { rows } = await db.query<{ recurring_cents: string }>(
      `select recurring_cents::text from public.crm_revenue_forecast(1)`,
    );
    // 25,000 monthly plus 60,000/3 = 45,000.
    expect(rows[0].recurring_cents).toBe("45000");
    await reset();
  });

  it("bills a weekly plan 365/7/12 times a month, not four", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, created_by)
       values ($1, $2, $3, 'Weekly commercial', 'weekly', current_date, 10000, $4)`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );
    const { rows } = await db.query<{ recurring_cents: string }>(
      `select recurring_cents::text from public.crm_revenue_forecast(1)`,
    );
    // 45,000 from before, plus 10,000 * 365/7/12 = 43,452.38… → 43,452.
    // At four-a-month it would have been 40,000, and a year of that loses a
    // whole cycle.
    expect(Number(rows[0].recurring_cents)).toBe(45_000 + 43_452);
    await reset();
  });

  it("counts nothing for a plan that is switched off or has no price", async () => {
    await as(acmeOwner);
    const before = await db.query<{ recurring_cents: string; plans: number }>(
      `select recurring_cents::text, plans from public.crm_revenue_forecast(1)`,
    );
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, active, created_by)
       values ($1, $2, $3, 'Lapsed', 'monthly', current_date, 99000, false, $4)`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due, created_by)
       values ($1, $2, $3, 'Courtesy', 'monthly', current_date, $4)`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );
    const after = await db.query<{ recurring_cents: string; plans: number }>(
      `select recurring_cents::text, plans from public.crm_revenue_forecast(1)`,
    );
    // Neither an inactive plan nor an unpriced one is revenue.
    expect(after.rows[0].recurring_cents).toBe(before.rows[0].recurring_cents);
    expect(after.rows[0].plans).toBe(before.rows[0].plans);
    await reset();
  });

  it("spreads a contract across its term and leaves an open-ended one out", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_contracts
         (organization_id, account_id, number, status, value_cents, starts_on, ends_on, created_by)
       values ($1, $2, 'C-TERM', 'active', 120000, date_trunc('month', current_date),
               date_trunc('month', current_date) + interval '11 months', $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );
    // Open-ended: it cannot be spread across a term it does not have, so it
    // is left to the plans underneath it rather than guessed at.
    await db.query(
      `insert into public.crm_contracts
         (organization_id, account_id, number, status, value_cents, starts_on, created_by)
       values ($1, $2, 'C-OPEN', 'active', 999000, date_trunc('month', current_date), $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );

    const { rows } = await db.query<{ contracted_cents: string; contracts: number }>(
      `select contracted_cents::text, contracts from public.crm_revenue_forecast(1)`,
    );
    // 120,000 over an eleven-month age (starts to ends) = 10,909.
    expect(rows[0].contracted_cents).toBe("10909");
    expect(rows[0].contracts).toBe(1);
    await reset();
  });

  it("reports what the forecast is standing on, including what it omits", async () => {
    await as(acmeOwner);
    const { rows } = await db.query<{
      active_plans: number; unpriced_plans: number; active_contracts: number;
      open_ended_contracts: number; priced_share_bps: number;
    }>(
      `select active_plans, unpriced_plans, active_contracts, open_ended_contracts,
              priced_share_bps
         from public.crm_forecast_basis()`,
    );
    // Four active plans, one of them unpriced.
    expect(rows[0].active_plans).toBe(4);
    expect(rows[0].unpriced_plans).toBe(1);
    expect(rows[0].priced_share_bps).toBe(7500);
    // Two active contracts, one open-ended and therefore absent from the
    // contracted line. A forecast that hid that would overstate its own
    // completeness.
    expect(rows[0].active_contracts).toBe(2);
    expect(rows[0].open_ended_contracts).toBe(1);
    await reset();
  });

  it("returns a null priced share for a book with no plans at all", async () => {
    await as(rivalOwner);
    const { rows } = await db.query<{ active_plans: number; priced_share_bps: number | null }>(
      `select active_plans, priced_share_bps from public.crm_forecast_basis()`,
    );
    expect(rows[0].active_plans).toBe(0);
    // A share of nothing is not zero.
    expect(rows[0].priced_share_bps).toBeNull();
    await reset();
  });

  it("never forecasts one tenant's book into another's", async () => {
    await as(rivalOwner);
    const { rows } = await db.query<{ total_cents: string }>(
      `select total_cents::text from public.crm_revenue_forecast(1)`,
    );
    // The rival has no plans and no contracts. Ours must not appear.
    expect(rows[0].total_cents).toBe("0");
    await reset();
  });

  it("keeps both functions invokers, and out of reach of anon", async () => {
    await reset();
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join unnest(array['anon', 'service_role']) as r(rolname)
        where n.nspname = 'public'
          and p.proname in ('crm_revenue_forecast', 'crm_forecast_basis')
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );
    expect(rows).toEqual([]);

    const { rows: definers } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.proname in ('crm_revenue_forecast', 'crm_forecast_basis')`,
    );
    expect(definers).toEqual([]);
  });
});
