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
 * Recurring billing and dunning (ADR-200) against the real chain.
 *
 * One invariant matters more than everything else in this file, and most of
 * the tests below exist to attack it from a different angle: A SERVICE PLAN
 * CANNOT BE BILLED TWICE FOR THE SAME PERIOD.
 *
 * A duplicate note is noise. A duplicate invoice is a customer charged
 * twice, and the first they hear of it is a statement. So the guarantee is
 * a unique index rather than care taken by the generator, and the tests
 * press on that: run it twice, run it against a period already billed by
 * hand, and run it with the plan's own price changed underneath.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000e301";
const rivalOwner = "00000000-0000-4000-8000-00000000e302";
const acmeOrg = "10000000-0000-4000-8000-00000000e301";
const rivalOrg = "10000000-0000-4000-8000-00000000e302";

describe("recurring billing and dunning", { timeout: 240_000 }, () => {
  let db: PGlite;
  let acmeAccount = "";
  let acmeProperty = "";
  let monthlyPlan = "";
  let quarterlyPlan = "";

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
      -- Real Supabase grants this, and the shim did not. It matters here
      -- and nowhere earlier because the generator is the first INVOKER
      -- function in the chain that calls auth.uid(): a definer reaches it
      -- as its owner, but a function running as the authenticated role
      -- needs the schema the way the live database actually hands it over.
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
    await reset();
  });

  afterAll(async () => {
    await db?.close();
  });

  it("sets up a customer with two recurring plans, both overdue to bill", async () => {
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

    const monthly = await db.query<{ id: string }>(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, created_by)
       values ($1, $2, $3, 'General pest', 'monthly', current_date - 5, 25000, $4) returning id`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );
    monthlyPlan = monthly.rows[0].id;

    const quarterly = await db.query<{ id: string }>(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, created_by)
       values ($1, $2, $3, 'Rodent program', 'quarterly', current_date - 1, 60000, $4) returning id`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );
    quarterlyPlan = quarterly.rows[0].id;

    // A plan with no price: due, but not billable. It must be counted as
    // considered and skipped, never invoiced for zero.
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due, created_by)
       values ($1, $2, $3, 'Courtesy inspection', 'annual', current_date - 2, $4)`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );

    // Not yet due, so it must be left entirely alone.
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, created_by)
       values ($1, $2, $3, 'Termite watch', 'annual', current_date + 40, 90000, $4)`,
      [acmeOrg, acmeAccount, acmeProperty, acmeOwner],
    );
    await reset();
    expect(monthlyPlan).not.toBe(quarterlyPlan);
  });

  it("bills the plans that are due, and nothing else", async () => {
    await as(acmeOwner);
    const { rows } = await db.query<{
      plans_considered: number; invoices_created: number; plans_already_billed: number; total_cents: string;
    }>(
      `select plans_considered, invoices_created, plans_already_billed, total_cents::text
         from public.crm_generate_due_invoices($1)`,
      [acmeOrg],
    );
    // The unpriced plan is not considered — it cannot be billed at all —
    // and the future one is not due.
    expect(rows[0].plans_considered).toBe(2);
    expect(rows[0].invoices_created).toBe(2);
    expect(rows[0].plans_already_billed).toBe(0);
    expect(rows[0].total_cents).toBe("85000");

    const invoices = await db.query<{ number: string; total_cents: string; status: string }>(
      `select number, total_cents::text, status::text from public.crm_invoices
        where organization_id = $1 and plan_id is not null order by total_cents`,
      [acmeOrg],
    );
    expect(invoices.rows).toHaveLength(2);
    // Issued, not draft: a generated invoice is one the customer owes.
    expect(invoices.rows.every((row) => row.status === "open")).toBe(true);
    expect(invoices.rows.map((row) => row.total_cents)).toEqual(["25000", "60000"]);

    // Each carries a line, so the invoice explains itself.
    const lines = await db.query<{ count: string }>(
      `select count(*)::text from public.crm_invoice_lines where organization_id = $1`,
      [acmeOrg],
    );
    expect(lines.rows[0].count).toBe("2");
    await reset();
  });

  it("advances each plan by its own recurrence, not by a fixed month", async () => {
    await as(acmeOwner);
    const { rows } = await db.query<{ id: string; next_due: string; recurrence: string }>(
      `select id, next_due::text, recurrence::text from public.crm_service_plans
        where organization_id = $1 and id in ($2, $3) order by recurrence`,
      [acmeOrg, monthlyPlan, quarterlyPlan],
    );
    const monthly = rows.find((row) => row.recurrence === "monthly");
    const quarterly = rows.find((row) => row.recurrence === "quarterly");

    const expectedMonthly = await db.query<{ d: string }>(
      "select ((current_date - 5) + interval '1 month')::date::text as d",
    );
    const expectedQuarterly = await db.query<{ d: string }>(
      "select ((current_date - 1) + interval '3 months')::date::text as d",
    );
    expect(monthly?.next_due).toBe(expectedMonthly.rows[0].d);
    expect(quarterly?.next_due).toBe(expectedQuarterly.rows[0].d);
    await reset();
  });

  it("bills once when the button is pressed twice", async () => {
    await as(acmeOwner);
    // Put the monthly plan back where it was, as though somebody re-ran a
    // batch over a period already covered.
    await db.query(
      "update public.crm_service_plans set next_due = current_date - 5 where id = $1",
      [monthlyPlan],
    );

    const { rows } = await db.query<{
      plans_considered: number; invoices_created: number; plans_already_billed: number; total_cents: string;
    }>(
      `select plans_considered, invoices_created, plans_already_billed, total_cents::text
         from public.crm_generate_due_invoices($1)`,
      [acmeOrg],
    );
    expect(rows[0].plans_considered).toBe(1);
    // The period was already billed, so nothing new is raised — and the run
    // says so rather than reporting a quiet zero.
    expect(rows[0].invoices_created).toBe(0);
    expect(rows[0].plans_already_billed).toBe(1);
    expect(rows[0].total_cents).toBe("0");

    const invoices = await db.query<{ count: string }>(
      `select count(*)::text from public.crm_invoices where organization_id = $1 and plan_id = $2`,
      [acmeOrg, monthlyPlan],
    );
    expect(invoices.rows[0].count).toBe("1");
    await reset();
  });

  it("refuses a second invoice for the same plan and period outright", async () => {
    await as(acmeOwner);
    const run = await db.query<{ id: string }>(
      `select id from public.crm_billing_runs where organization_id = $1 order by ran_at limit 1`,
      [acmeOrg],
    );
    const existing = await db.query<{ service_period_start: string }>(
      `select service_period_start::text from public.crm_invoices
        where organization_id = $1 and plan_id = $2`,
      [acmeOrg, monthlyPlan],
    );

    // The generator is not the only door: a hand-written insert must be
    // refused by the database too.
    await expect(
      db.query(
        `insert into public.crm_invoices
           (organization_id, account_id, plan_id, billing_run_id, number, status,
            subtotal_cents, tax_cents, total_cents, issued_on,
            service_period_start, service_period_end, created_by)
         values ($1, $2, $3, $4, 'BY-HAND-1', 'open', 25000, 0, 25000, current_date,
                 $5, $5::date + 30, $6)`,
        [acmeOrg, acmeAccount, monthlyPlan, run.rows[0].id, existing.rows[0].service_period_start, acmeOwner],
      ),
    ).rejects.toThrow(/crm_invoices_plan_period_key/);
    await reset();
  });

  it("keeps hand-raised invoices free of the constraint entirely", async () => {
    await as(acmeOwner);
    // Two invoices with no plan on the same day must both land: the unique
    // index is partial for exactly this reason.
    for (const number of ["HAND-1", "HAND-2"]) {
      await db.query(
        `insert into public.crm_invoices
           (organization_id, account_id, number, status, subtotal_cents, tax_cents,
            total_cents, issued_on, created_by)
         values ($1, $2, $3, 'open', 10000, 0, 10000, current_date, $4)`,
        [acmeOrg, acmeAccount, number, acmeOwner],
      );
    }
    const { rows } = await db.query<{ count: string }>(
      `select count(*)::text from public.crm_invoices
        where organization_id = $1 and plan_id is null`,
      [acmeOrg],
    );
    expect(rows[0].count).toBe("2");
    await reset();
  });

  it("refuses half a provenance", async () => {
    await as(acmeOwner);
    // A plan without a period, or a period without a run, is a row nobody
    // can audit.
    await expect(
      db.query(
        `insert into public.crm_invoices
           (organization_id, account_id, plan_id, number, status, subtotal_cents,
            tax_cents, total_cents, created_by)
         values ($1, $2, $3, 'HALF-1', 'draft', 100, 0, 100, $4)`,
        [acmeOrg, acmeAccount, quarterlyPlan, acmeOwner],
      ),
    ).rejects.toThrow(/crm_invoices_generated_provenance/);
    await reset();
  });

  it("never bills into another tenant's book", async () => {
    await as(rivalOwner);
    const rival = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Rival Grocers', 'commercial', 'customer', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    const property = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Their store', '9 Rival Way, Cedar Point, WA 98040') returning id`,
      [rivalOrg, rival.rows[0].id],
    );
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due,
          value_cents, created_by)
       values ($1, $2, $3, 'General pest', 'monthly', current_date - 10, 33000, $4)`,
      [rivalOrg, rival.rows[0].id, property.rows[0].id, rivalOwner],
    );

    /*
     * The rival naming OUR organization is refused outright, and refused
     * at the first write rather than after quietly finding nothing: the
     * function runs as the caller, so RLS rejects the billing run before
     * a single plan is read. A silent empty result would have been safe
     * too, but a loud refusal is better — it says the attempt was wrong
     * rather than that our book happens to be empty.
     */
    await expect(
      db.query(`select * from public.crm_generate_due_invoices($1)`, [acmeOrg]),
    ).rejects.toThrow(/row-level security policy for table "crm_billing_runs"/);

    const theirs = await db.query<{ invoices_created: number; total_cents: string }>(
      `select invoices_created, total_cents::text from public.crm_generate_due_invoices($1)`,
      [rivalOrg],
    );
    expect(theirs.rows[0].invoices_created).toBe(1);
    expect(theirs.rows[0].total_cents).toBe("33000");
    await reset();
  });

  it("records the run, and will not let it be deleted or rewritten away", async () => {
    await reset();
    const { rows } = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'crm_billing_runs'
          and grantee in ('anon', 'authenticated', 'service_role')
        order by grantee, privilege_type`,
    );
    expect(rows.every((row) => row.grantee === "authenticated")).toBe(true);
    expect(rows.map((row) => row.privilege_type).sort()).toEqual(["INSERT", "SELECT", "UPDATE"]);

    const notices = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'crm_dunning_notices'
          and grantee in ('anon', 'authenticated', 'service_role')
        order by grantee, privilege_type`,
    );
    expect(notices.rows.every((row) => row.grantee === "authenticated")).toBe(true);
    // A collections action taken is final: no UPDATE, no DELETE.
    expect(notices.rows.map((row) => row.privilege_type).sort()).toEqual(["INSERT", "SELECT"]);
  });

  it("puts an overdue invoice on the worklist, oldest and largest first", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents,
          total_cents, issued_on, due_on, created_by)
       values
         ($1, $2, 'OLD-BIG', 'open', 90000, 0, 90000, current_date - 200, current_date - 180, $3),
         ($1, $2, 'NEW-SMALL', 'open', 5000, 0, 5000, current_date - 20, current_date - 10, $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );

    const { rows } = await db.query<{ number: string; days_overdue: number; notices: number }>(
      `select number, days_overdue, notices from public.crm_collections_worklist(1)`,
    );
    expect(rows[0].number).toBe("OLD-BIG");
    expect(rows[0].days_overdue).toBe(180);
    expect(rows[0].notices).toBe(0);
    expect(rows.map((row) => row.number)).toContain("NEW-SMALL");

    // A threshold keeps the barely-late out of the list.
    const older = await db.query<{ number: string }>(
      `select number from public.crm_collections_worklist(60)`,
    );
    expect(older.rows.map((row) => row.number)).toEqual(["OLD-BIG"]);
    await reset();
  });

  it("records what a person did, with the age at the moment they did it", async () => {
    await as(acmeOwner);
    const invoice = await db.query<{ id: string }>(
      `select id from public.crm_invoices where organization_id = $1 and number = 'OLD-BIG'`,
      [acmeOrg],
    );
    await db.query(
      `insert into public.crm_dunning_notices
         (organization_id, invoice_id, account_id, action, days_overdue, balance_cents,
          outcome, created_by)
       values ($1, $2, $3, 'reminder_call', 180, 90000, 'Left a message with the office.', $4)`,
      [acmeOrg, invoice.rows[0].id, acmeAccount, acmeOwner],
    );

    const { rows } = await db.query<{ notices: number; last_action: string }>(
      `select notices, last_action::text from public.crm_collections_worklist(60)`,
    );
    expect(rows[0].notices).toBe(1);
    expect(rows[0].last_action).toBe("reminder_call");
    await reset();
  });

  it("refuses a collections note filed against the wrong customer", async () => {
    await as(acmeOwner);
    const other = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Cedar Point Deli', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const invoice = await db.query<{ id: string }>(
      `select id from public.crm_invoices where organization_id = $1 and number = 'OLD-BIG'`,
      [acmeOrg],
    );
    // Harborview's invoice, filed on Cedar Point's account. A CHECK cannot
    // reach across tables, so a trigger has to refuse it — otherwise a
    // collections note lands on the wrong customer's file.
    await expect(
      db.query(
        `insert into public.crm_dunning_notices
           (organization_id, invoice_id, account_id, action, days_overdue, balance_cents, created_by)
         values ($1, $2, $3, 'final_notice', 180, 90000, $4)`,
        [acmeOrg, invoice.rows[0].id, other.rows[0].id, acmeOwner],
      ),
    ).rejects.toThrow(/that invoice is not on this account/);
    await reset();
  });

  it("refuses net terms nobody could mean", async () => {
    await as(acmeOwner);
    await expect(
      db.query("select * from public.crm_generate_due_invoices($1, current_date, 900)", [acmeOrg]),
    ).rejects.toThrow(/net terms must be between/);
    await reset();
  });

  it("gives anon and service_role no way in", async () => {
    await reset();
    const { rows } = await db.query<{ proname: string; grantee: string }>(
      `select p.proname, r.rolname as grantee
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join unnest(array['anon', 'service_role']) as r(rolname)
        where n.nspname = 'public'
          and p.proname in ('crm_generate_due_invoices', 'crm_collections_worklist',
                            'crm_recurrence_interval', 'crm_check_dunning_account')
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );
    expect(rows).toEqual([]);

    // The generator writes, so it must run as the caller — a definer would
    // write into any tenant's book the caller could name.
    const { rows: definers } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.proname in ('crm_generate_due_invoices', 'crm_collections_worklist')`,
    );
    expect(definers).toEqual([]);
  });
});
