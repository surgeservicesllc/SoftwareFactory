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
 * Trust (ADR-234) against the real chain: the owner's churn and growth
 * are applied month by month with the factor printed, month zero is
 * always the recorded figure, and inputs outside 0–100% are clamped; the
 * hygiene report names every contact the book should not trust with the
 * reasons, and nothing else.
 */

const acmeOwner = "00000000-0000-4000-8000-000000034001";
const rivalOwner = "00000000-0000-4000-8000-000000034002";
const acmeOrg = "10000000-0000-4000-8000-000000034001";
const rivalOrg = "10000000-0000-4000-8000-000000034002";

describe("trust: forecast scenarios and contact hygiene", { timeout: 240_000 }, () => {
  let db: PGlite;
  let harborview = ""; let oldMill = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function rejects(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("expected the statement to be rejected");
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
    const migrationFiles = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
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
      values ('${acmeOrg}', 'Acme Pest', 'acme-pest-trust', '${acmeOwner}'),
             ('${rivalOrg}', 'Rival Pest', 'rival-pest-trust', '${rivalOwner}');
    `);
    await as(acmeOwner);
    harborview = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const site = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Plant', '1 Loaf Lane') returning id`, [acmeOrg, harborview])).rows[0].id;
    oldMill = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Old Mill', 'commercial', 'inactive', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    // A customer nobody has touched: no history, no invoice, no visit.
    const quietFarm = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Quiet Farm', 'commercial', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    await db.query(
      `insert into public.crm_contacts (organization_id, account_id, first_name, last_name, email, is_primary)
       values ($1, $2, 'Ana', 'Silva', 'ana@quietfarm.example', true)`, [acmeOrg, quietFarm]);
    // A monthly plan worth $100.00: the recorded forecast is flat.
    await db.query(
      `insert into public.crm_service_plans (organization_id, account_id, property_id, service_type, recurrence, next_due, value_cents, created_by)
       values ($1, $2, $3, 'Monthly pest', 'monthly', current_date + 7, 10000, $4)`, [acmeOrg, harborview, site, acmeOwner]);
    // Contacts: Dana (email shared with Sam), Pat (no way to reach), Lee (clean).
    await db.query(
      `insert into public.crm_contacts (organization_id, account_id, first_name, last_name, email, phone, is_primary) values
         ($1, $2, 'Dana', 'Reyes', 'Dup@Harborview.example', null, true),
         ($1, $2, 'Pat', 'Quinn', null, null, false),
         ($1, $2, 'Lee', 'Park', 'lee@harborview.example', '(555) 010-2000', false),
         ($1, $3, 'Sam', 'Ortiz', 'dup@harborview.example', null, true)`, [acmeOrg, harborview, oldMill]);
    // Harborview was touched this year; Old Mill never.
    await db.query(
      `insert into public.crm_timeline_events (organization_id, account_id, kind, summary, actor_user_id)
       values ($1, $2, 'note', 'Called about the spring schedule.', $3)`, [acmeOrg, harborview, acmeOwner]);
    // A notice to the shared address failed.
    const invoice = (await db.query<{ id: string }>(
      `insert into public.crm_invoices (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, issued_on, due_on, created_by)
       values ($1, $2, 'INV-T-1', 'open', 5000, 0, 5000, current_date - 400, current_date - 370, $3) returning id`,
      [acmeOrg, oldMill, acmeOwner])).rows[0].id;
    // Old Mill's last touch is pinned to exactly 400 days ago as a
    // timestamp. The invoice above dates it to a midnight, and the
    // function rounds elapsed days to the nearest integer, so a
    // date-only touch read as 400 before noon and 401 after — a
    // time-of-day flake, not a defect in either. The note is the same
    // event a person would record when the invoice went out.
    await db.query(
      `insert into public.crm_timeline_events (organization_id, account_id, kind, summary, actor_user_id, occurred_at)
       values ($1, $2, 'note', 'Invoice INV-T-1 sent.', $3, now() - interval '400 days')`, [acmeOrg, oldMill, acmeOwner]);
    const notice = (await db.query<{ notice_id: string }>(
      `select notice_id from public.crm_notice_compose('invoice_overdue', 'email', $1, 'dup@harborview.example', 'Your invoice is overdue.', current_date, now(), 'Invoice overdue')`,
      [invoice])).rows[0].notice_id;
    await db.query(`select public.crm_notice_mark_failed($1, 'mailbox does not exist')`, [notice]);
  });

  afterAll(async () => { await db?.close(); });

  it("applies the owner's churn and growth month by month with the factor printed, month zero untouched, inputs clamped", async () => {
    await as(acmeOwner);
    type Row = { month: Date; months_ahead: number; recorded_cents: string; scenario_cents: string; factor_bps: number };
    const flat = (await db.query<Row>(
      `select month, months_ahead, recorded_cents::text as recorded_cents, scenario_cents::text as scenario_cents, factor_bps
         from public.crm_revenue_forecast_scenario(12, 0, 0)`)).rows;
    expect(flat).toHaveLength(12);
    expect(flat.every((row) => row.recorded_cents === "10000" && row.scenario_cents === "10000" && row.factor_bps === 10000)).toBe(true);
    expect(flat.map((row) => row.months_ahead)).toEqual([...Array(12).keys()]);

    const churn = (await db.query<Row>(
      `select months_ahead, recorded_cents::text as recorded_cents, scenario_cents::text as scenario_cents, factor_bps
         from public.crm_revenue_forecast_scenario(12, 1200, 0)`)).rows;
    expect(churn[0]).toMatchObject({ months_ahead: 0, scenario_cents: "10000", factor_bps: 10000 });
    // Twelve percent a year is (0.88)^(11/12) eleven months out.
    expect(churn[11].factor_bps).toBe(Math.round(Math.pow(0.88, 11 / 12) * 10000));
    expect(churn[11].scenario_cents).toBe(String(Math.round(10000 * Math.pow(0.88, 11 / 12))));
    for (let i = 1; i < 12; i += 1) expect(churn[i].factor_bps).toBeLessThan(churn[i - 1].factor_bps);

    const both = (await db.query<Row>(`select factor_bps from public.crm_revenue_forecast_scenario(12, 1200, 1200)`)).rows;
    expect(both[11].factor_bps).toBe(Math.round(Math.pow(0.88 * 1.12, 11 / 12) * 10000));

    const clamped = (await db.query<Row>(`select factor_bps from public.crm_revenue_forecast_scenario(12, -500, 20000)`)).rows;
    expect(clamped[11].factor_bps).toBe(Math.round(Math.pow(2, 11 / 12) * 10000));
    expect((await db.query(`select 1 from public.crm_revenue_forecast_scenario(0, 0, 0)`)).rows).toHaveLength(1);
  });

  it("keeps one set of assumptions per workspace, inside 0–100%, and only for members", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_forecast_assumptions (organization_id, annual_churn_bps, annual_growth_bps, note, updated_by)
       values ($1, 1200, 500, 'Last two years of cancellations; growth from the route plan.', $2)`, [acmeOrg, acmeOwner]);
    expect(await rejects(() => db.query(
      `insert into public.crm_forecast_assumptions (organization_id, updated_by) values ($1, $2)`, [acmeOrg, acmeOwner]))).toMatch(/crm_forecast_assumptions_org_key/);
    expect(await rejects(() => db.query(
      `update public.crm_forecast_assumptions set annual_churn_bps = 10001 where organization_id = $1`, [acmeOrg]))).toMatch(/annual_churn_bps_check/);
    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_forecast_assumptions`)).rows).toHaveLength(0);
    expect(await rejects(() => db.query(
      `insert into public.crm_forecast_assumptions (organization_id, updated_by) values ($1, $2)`, [acmeOrg, rivalOwner]))).toMatch(/row-level security/);
  });

  it("names every contact the book should not trust, with the reasons, most flagged first, and nobody else", async () => {
    await as(acmeOwner);
    const { rows } = await db.query<{ contact_name: string; account_name: string; flags: string[]; flag_count: number; days_since_touch: number | null }>(
      `select contact_name, account_name, flags, flag_count, days_since_touch from public.crm_contact_hygiene($1)`, [acmeOrg]);
    // Dana's address differs from the failed one only by case, so it is
    // the same undeliverable mailbox; Old Mill's last touch is exactly
    // 400 days old; Ana's account is a customer nobody has spoken to.
    expect(rows.map((row) => [row.contact_name, row.flags])).toEqual([
      ["Sam Ortiz", ["undeliverable", "duplicate_email", "inactive_account", "untouched_year"]],
      ["Dana Reyes", ["undeliverable", "duplicate_email"]],
      ["Ana Silva", ["untouched_year"]],
      ["Pat Quinn", ["unreachable"]],
    ]);
    expect(rows[0]).toMatchObject({ account_name: "Old Mill", flag_count: 4, days_since_touch: 400 });
    expect(rows[1]).toMatchObject({ account_name: "Harborview Foods", days_since_touch: 0 });
    expect(rows[2]).toMatchObject({ account_name: "Quiet Farm", days_since_touch: null });

    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_contact_hygiene($1)`, [acmeOrg])).rows).toHaveLength(0);

    await db.exec("reset role");
    const grants = await db.query<{ fn: string; anon: boolean; authenticated: boolean; service_role: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service_role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('crm_revenue_forecast_scenario', 'crm_contact_hygiene') order by 1`);
    expect(grants.rows).toHaveLength(2);
    for (const row of grants.rows) expect(row, row.fn).toMatchObject({ anon: false, authenticated: true, service_role: false });
  });
});
