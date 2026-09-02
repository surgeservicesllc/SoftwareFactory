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
 * Nothing hidden (ADR-232) against the real chain: the schedule audit
 * names every contradiction with the rows involved; the automation dry
 * run lists exactly what a rule would touch and why it would not; the
 * dashboard drill-down returns the rows behind a figure by the figure's
 * own predicate, so the count and the list agree.
 */

const acmeOwner = "00000000-0000-4000-8000-000000032001";
const rivalOwner = "00000000-0000-4000-8000-000000032002";
const acmeOrg = "10000000-0000-4000-8000-000000032001";
const rivalOrg = "10000000-0000-4000-8000-000000032002";

type Finding = {
  finding: string; severity: string; work_order_id: string | null; other_work_order_id: string | null;
  plan_id: string | null; route_id: string | null; account_name: string; technician_name: string | null; detail: string;
};

describe("nothing hidden: schedule audit, automation dry run, dashboard rows", { timeout: 240_000 }, () => {
  let db: PGlite;
  let harborview = ""; let harborviewSite = "";
  let northgate = "";
  let rosa = ""; let tom = ""; let branch = "";
  let w1 = ""; let w2 = ""; let w3 = ""; let w4 = "";
  let p1 = ""; let p2 = "";
  let route = "";
  let route2 = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function visit(account: string, property: string, technician: string, dayOffset: number, start: string, end: string, status = "scheduled", planId: string | null = null): Promise<string> {
    return (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, plan_id, service_type,
          scheduled_start, scheduled_end, status, created_by)
       values ($1, $2, $3, $4, $5, 'General pest',
               ((current_date + $6::int) + $7::time)::timestamptz,
               ((current_date + $6::int) + $8::time)::timestamptz, $9, $10)
       returning id`,
      [acmeOrg, account, property, technician, planId, dayOffset, start, end, status, acmeOwner],
    )).rows[0].id;
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
      values ('${acmeOrg}', 'Acme Pest', 'acme-pest-hidden', '${acmeOwner}'),
             ('${rivalOrg}', 'Rival Pest', 'rival-pest-hidden', '${rivalOwner}');
    `);
    await as(acmeOwner);
    harborview = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    harborviewSite = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Plant', '1 Loaf Lane') returning id`, [acmeOrg, harborview])).rows[0].id;
    northgate = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Northgate Lead', 'residential', 'lead', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    // A customer with no plan, and an inactive one, for the retention figures.
    await db.query(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Ridgeway Bakery', 'commercial', 'customer', $2), ($1, 'Old Mill', 'commercial', 'inactive', $2)`,
      [acmeOrg, acmeOwner]);
    rosa = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Rosa', 'Vega', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    tom = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Tom', 'Hale', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    branch = (await db.query<{ id: string }>(
      `insert into public.crm_branches (organization_id, code, name, created_by)
       values ($1, 'NORTH', 'North yard', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;

    // Plans: P1 due in three days with no visit; P2 due in three days with W1 near it.
    p1 = (await db.query<{ id: string }>(
      `insert into public.crm_service_plans (organization_id, account_id, property_id, service_type, recurrence, next_due, technician_id, created_by)
       values ($1, $2, $3, 'Quarterly IPM', 'quarterly', current_date + 3, $4, $5) returning id`,
      [acmeOrg, harborview, harborviewSite, rosa, acmeOwner])).rows[0].id;
    p2 = (await db.query<{ id: string }>(
      `insert into public.crm_service_plans (organization_id, account_id, property_id, service_type, recurrence, next_due, technician_id, created_by)
       values ($1, $2, $3, 'Monthly pest', 'monthly', current_date + 3, $4, $5) returning id`,
      [acmeOrg, harborview, harborviewSite, rosa, acmeOwner])).rows[0].id;

    w1 = await visit(harborview, harborviewSite, rosa, 1, "10:00", "11:00", "scheduled", p2);
    w2 = await visit(harborview, harborviewSite, rosa, 1, "10:30", "11:30");
    w3 = await visit(harborview, harborviewSite, rosa, 2, "09:00", "10:00");
    w4 = await visit(harborview, harborviewSite, rosa, -1, "09:00", "10:00");

    route = (await db.query<{ id: string }>(
      `insert into public.crm_routes (organization_id, technician_id, branch_id, route_date, created_by)
       values ($1, $2, $3, current_date + 1, $4) returning id`, [acmeOrg, rosa, branch, acmeOwner])).rows[0].id;
    await db.query(
      `insert into public.crm_route_stops (organization_id, route_id, work_order_id, position, planned_arrival, created_by)
       values ($1, $2, $3, 1, ((current_date + 1) + time '10:20')::timestamptz, $4)`,
      [acmeOrg, route, w1, acmeOwner]);
    // A stop must sit on its route's day, so W3 rides a second route.
    route2 = (await db.query<{ id: string }>(
      `insert into public.crm_routes (organization_id, technician_id, branch_id, route_date, created_by)
       values ($1, $2, $3, current_date + 2, $4) returning id`, [acmeOrg, rosa, branch, acmeOwner])).rows[0].id;
    await db.query(
      `insert into public.crm_route_stops (organization_id, route_id, work_order_id, position, planned_arrival, created_by)
       values ($1, $2, $3, 1, ((current_date + 2) + time '08:30')::timestamptz, $4)`,
      [acmeOrg, route2, w3, acmeOwner]);
    // W3 was routed under Rosa and then reassigned to Tom.
    await db.query(`update public.crm_work_orders set technician_id = $1 where id = $2`, [tom, w3]);

    // A contact with an email, no phone; an SMS preference that declines.
    await db.query(
      `insert into public.crm_contacts (organization_id, account_id, first_name, email, is_primary)
       values ($1, $2, 'Dana', 'dana@harborview.example', true)`, [acmeOrg, harborview]);
    await db.query(
      `insert into public.crm_contact_preferences (organization_id, account_id, channel, marketing_allowed, updated_by)
       values ($1, $2, 'email', false, $3)`, [acmeOrg, northgate, acmeOwner]);
    // Invoices for the dashboard figures: one issued this month, one overdue 45 days, one draft.
    await db.query(
      `insert into public.crm_invoices (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, issued_on, due_on, created_by)
       values ($1, $2, 'INV-H-1', 'open', 10000, 0, 10000, current_date, current_date + 30, $3),
              ($1, $2, 'INV-H-2', 'open', 5000, 0, 5000, current_date - 60, current_date - 45, $3),
              ($1, $2, 'INV-H-3', 'draft', 7000, 0, 7000, null, null, $3)`,
      [acmeOrg, harborview, acmeOwner]);
  });

  afterAll(async () => { await db?.close(); });

  it("names every contradiction in the schedule with the rows involved", async () => {
    await as(acmeOwner);
    const { rows } = await db.query<Finding>(
      `select finding, severity, work_order_id, other_work_order_id, plan_id, route_id, account_name, technician_name, detail
         from public.crm_schedule_audit($1, 14)`, [acmeOrg]);
    const kinds = rows.map((r) => r.finding);
    expect(kinds.filter((k) => k === "double_booked")).toHaveLength(2);
    expect(kinds.filter((k) => k === "slipped")).toHaveLength(1);
    expect(kinds.filter((k) => k === "unrouted")).toHaveLength(1);
    expect(kinds.filter((k) => k === "plan_due_unscheduled")).toHaveLength(1);
    expect(kinds.filter((k) => k === "arrival_outside_window")).toHaveLength(1);
    expect(kinds.filter((k) => k === "technician_mismatch")).toHaveLength(1);
    expect(rows).toHaveLength(7);

    const double = rows.filter((r) => r.finding === "double_booked");
    expect(new Set(double.map((r) => r.work_order_id))).toEqual(new Set([w1, w2]));
    expect(double[0].detail).toMatch(/^Overlaps Harborview Foods, 1[01]:[03]0–1[01]:[03]0\.$/);
    expect(rows.find((r) => r.finding === "slipped")).toMatchObject({ work_order_id: w4, severity: "high" });
    expect(rows.find((r) => r.finding === "unrouted")).toMatchObject({ work_order_id: w2, technician_name: "Rosa Vega" });
    expect(rows.find((r) => r.finding === "plan_due_unscheduled")).toMatchObject({ plan_id: p1 });
    expect(rows.find((r) => r.finding === "plan_due_unscheduled")?.detail).toMatch(/^Quarterly IPM due \d{4}-\d{2}-\d{2} \(quarterly\); no visit within a week of it\.$/);
    expect(rows.find((r) => r.finding === "arrival_outside_window")).toMatchObject({ work_order_id: w3, route_id: route2 });
    expect(rows.find((r) => r.finding === "arrival_outside_window")?.detail).toBe("Planned arrival 08:30 is outside the promised window 09:00–10:00.");
    expect(rows.find((r) => r.finding === "technician_mismatch")).toMatchObject({
      work_order_id: w3, route_id: route2, technician_name: "Tom Hale",
      detail: "The route belongs to Rosa Vega; the visit is assigned to Tom Hale.",
    });
    // High first, then medium, then low.
    expect(rows.map((r) => r.severity)).toEqual(["high", "high", "high", "medium", "medium", "medium", "low"]);
    expect(rows[0]).toMatchObject({ finding: "slipped" });
    expect(kinds.filter((k) => k === "plan_due_unscheduled").length).toBe(1);
    expect(rows.some((r) => r.plan_id === p2)).toBe(false);
  });

  it("dry-runs a rule: exactly which records, what it would do, and why not", async () => {
    await as(acmeOwner);
    const email = (await db.query<{ id: string }>(
      `insert into public.crm_automations (organization_id, name, trigger_on, action, delay_hours, template, created_by)
       values ($1, 'Welcome new leads', 'lead_created', 'send_email', 24, 'Thanks for reaching out — here is what happens next.', $2) returning id`,
      [acmeOrg, acmeOwner])).rows[0].id;
    const { rows } = await db.query<{ record_kind: string; record_id: string; account_name: string; would_do: string; blocked_reason: string | null; delay_h: number }>(
      `select record_kind, record_id, account_name, would_do, blocked_reason,
              extract(epoch from (fires_at - occurred_at))::int / 3600 as delay_h
         from public.crm_automation_dry_run($1, $2, 30)`, [acmeOrg, email]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      record_kind: "account", record_id: northgate, account_name: "Northgate Lead",
      would_do: 'Would email nobody: "Thanks for reaching out — here is what happens next."',
      blocked_reason: "no email on file", delay_h: 24,
    });

    const sms = (await db.query<{ id: string }>(
      `insert into public.crm_automations (organization_id, name, trigger_on, action, template, created_by)
       values ($1, 'Thanks after service', 'service_completed', 'send_sms', 'Thanks for having us today.', $2) returning id`,
      [acmeOrg, acmeOwner])).rows[0].id;
    await db.query(`update public.crm_work_orders set status = 'completed' where id = $1`, [w4]);
    const done = await db.query<{ record_id: string; would_do: string; blocked_reason: string | null }>(
      `select record_id, would_do, blocked_reason from public.crm_automation_dry_run($1, $2, 30)`, [acmeOrg, sms]);
    expect(done.rows).toEqual([{ record_id: w4, would_do: 'Would text nobody: "Thanks for having us today."', blocked_reason: "no phone on file" }]);

    const overdue = (await db.query<{ id: string }>(
      `insert into public.crm_automations (organization_id, name, trigger_on, action, created_by)
       values ($1, 'Chase overdue', 'invoice_overdue', 'create_task', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const chase = await db.query<{ record_kind: string; would_do: string; blocked_reason: string | null }>(
      `select record_kind, would_do, blocked_reason from public.crm_automation_dry_run($1, $2, 30)`, [acmeOrg, overdue]);
    expect(chase.rows).toEqual([{ record_kind: "invoice", would_do: "Would create a task on Harborview Foods.", blocked_reason: null }]);

    // Nothing ran: the rule's own counters are untouched.
    const counters = await db.query<{ run_count: number; last_run_at: string | null }>(
      `select run_count, last_run_at from public.crm_automations where id = $1`, [email]);
    expect(counters.rows[0]).toEqual({ run_count: 0, last_run_at: null });
  });

  it("returns the rows behind a figure by the figure's own predicate, so count and list agree", async () => {
    await as(acmeOwner);
    const month = await db.query<{ invoiced_cents: string; invoice_count: number }>(
      `select invoiced_cents::text as invoiced_cents, invoice_count from public.crm_revenue_by_month(1)`);
    const monthRows = await db.query<{ label: string; amount_cents: string }>(
      `select label, amount_cents::text as amount_cents from public.crm_dashboard_rows($1, 'invoiced_month', to_char(current_date, 'YYYY-MM-01'))`, [acmeOrg]);
    expect(monthRows.rows).toHaveLength(month.rows[0].invoice_count);
    expect(monthRows.rows.reduce((sum, r) => sum + Number(r.amount_cents), 0)).toBe(Number(month.rows[0].invoiced_cents));
    expect(monthRows.rows.map((r) => r.label)).toEqual(["INV-H-1"]);

    const aging = await db.query<{ bucket: string; invoice_count: number }>(`select bucket, invoice_count from public.crm_receivable_aging()`);
    for (const bucket of aging.rows) {
      const list = await db.query(`select 1 from public.crm_dashboard_rows($1, 'aging', $2)`, [acmeOrg, bucket.bucket]);
      expect(list.rows, bucket.bucket).toHaveLength(bucket.invoice_count);
    }
    const overdue = await db.query<{ label: string; amount_cents: string }>(
      `select label, amount_cents::text as amount_cents from public.crm_dashboard_rows($1, 'overdue')`, [acmeOrg]);
    expect(overdue.rows).toEqual([{ label: "INV-H-2", amount_cents: "5000" }]);

    const retention = await db.query<{ customers_without_plan: number; inactive: number }>(`select customers_without_plan, inactive from public.crm_retention_summary()`);
    const noPlan = await db.query<{ account_name: string }>(`select account_name from public.crm_dashboard_rows($1, 'no_plan')`, [acmeOrg]);
    expect(noPlan.rows).toHaveLength(retention.rows[0].customers_without_plan);
    expect(noPlan.rows.map((r) => r.account_name)).toEqual(["Ridgeway Bakery"]);
    const inactive = await db.query(`select 1 from public.crm_dashboard_rows($1, 'retention', 'inactive')`, [acmeOrg]);
    expect(inactive.rows).toHaveLength(retention.rows[0].inactive);

    const productivity = await db.query<{ technician_id: string; scheduled: number }>(`select technician_id, scheduled from public.crm_technician_productivity(90)`);
    for (const tech of productivity.rows) {
      const list = await db.query(`select 1 from public.crm_dashboard_rows($1, 'technician', $2, 90)`, [acmeOrg, tech.technician_id]);
      expect(list.rows, tech.technician_id).toHaveLength(tech.scheduled);
    }
    const density = await db.query<{ day: Date; technician_id: string; stops: number }>(`select day, technician_id, stops from public.crm_route_density(14)`);
    for (const dayRow of density.rows) {
      const key = `${dayRow.day.toISOString().slice(0, 10)}|${dayRow.technician_id}`;
      const list = await db.query(`select 1 from public.crm_dashboard_rows($1, 'route_day', $2)`, [acmeOrg, key]);
      expect(list.rows, key).toHaveLength(dayRow.stops);
    }
    // A key meant for another figure is never parsed.
    const stray = await db.query(`select 1 from public.crm_dashboard_rows($1, 'retention', 'customer')`, [acmeOrg]);
    expect(stray.rows.length).toBeGreaterThan(0);
  });

  it("shows a rival nothing and grants only authenticated", async () => {
    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_schedule_audit($1, 14)`, [acmeOrg])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.crm_dashboard_rows($1, 'overdue')`, [acmeOrg])).rows).toHaveLength(0);
    const rule = await db.query<{ id: string }>(`select id from public.crm_automations where organization_id = $1 limit 1`, [acmeOrg]);
    expect(rule.rows).toHaveLength(0);
    await db.exec("reset role");
    const { rows } = await db.query<{ fn: string; anon: boolean; authenticated: boolean; service_role: boolean }>(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service_role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('crm_schedule_audit', 'crm_automation_dry_run', 'crm_dashboard_rows')
        order by 1`);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row, row.fn).toMatchObject({ anon: false, authenticated: true, service_role: false });
  });
});
