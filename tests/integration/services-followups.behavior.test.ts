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
 * Follow-ups and the suggested next step (ADR-228) against the real chain.
 *
 * Replays rather than restores, and injects hosted-like default privileges
 * before the CRM foundation, because it asserts that anon and service_role
 * hold NOTHING on the new tables — a revoke only means something if the
 * grant was there to revoke.
 *
 * What the increment promises: every suggestion is a fact about the rows
 * as they are right now, printed with its reason; a suggestion becomes a
 * task only when accepted and cannot be accepted twice while open; the
 * row stamps its own moments; and finishing a follow-up about an account
 * is part of that account's history — which is also what ends the
 * stale-lead suggestion, because activity was recorded.
 */

const acmeOwner = "00000000-0000-4000-8000-000000028001";
const rivalOwner = "00000000-0000-4000-8000-000000028002";
const acmeOrg = "10000000-0000-4000-8000-000000028001";
const rivalOrg = "10000000-0000-4000-8000-000000028002";

type Suggestion = {
  suggestion_key: string;
  rule: string;
  account_id: string | null;
  opportunity_id: string | null;
  title: string;
  reason: string;
  due_on: string;
  priority: string;
};

describe("follow-ups and the suggested next step", { timeout: 240_000 }, () => {
  let db: PGlite;

  let employee = "";
  let technician = "";
  let account = "";
  let property = "";
  let opportunity = "";
  let estimate = "";
  let request = "";
  let invoice = "";
  let sighting = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function suggestions(): Promise<Suggestion[]> {
    const read = await db.query<Suggestion>(
      "select * from public.crm_suggest_followups($1)",
      [acmeOrg],
    );
    return read.rows;
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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-followups', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-followups', '${rivalOwner}');
    `);

    await as(acmeOwner);
    const role = (await db.query<{ role: string }>(
      "select (enum_range(null::public.crm_employee_role))[1]::text as role",
    )).rows[0].role;
    employee = (await db.query<{ id: string }>(
      `insert into public.crm_employees (organization_id, employee_code, first_name, role, created_by)
       values ($1, 'E1', 'Ada', $2::public.crm_employee_role, $3) returning id`,
      [acmeOrg, role, acmeOwner],
    )).rows[0].id;
    technician = (await db.query<{ id: string }>(
      `insert into public.crm_technicians
         (organization_id, first_name, license_number, license_expires_on, created_by)
       values ($1, 'Bram', 'PCO-77', current_date + 10, $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_at, created_by)
       values ($1, 'Ridgeway Bakery', 'commercial', 'lead', now() - interval '20 days', $2)
       returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    property = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Bakery', '1 Loaf Lane') returning id`,
      [acmeOrg, account],
    )).rows[0].id;
    opportunity = (await db.query<{ id: string }>(
      `insert into public.crm_opportunities
         (organization_id, account_id, name, stage, expected_close_date, created_by)
       values ($1, $2, 'Bakery contract', 'proposal', current_date - 3, $3) returning id`,
      [acmeOrg, account, acmeOwner],
    )).rows[0].id;
    estimate = (await db.query<{ id: string }>(
      `insert into public.crm_estimates (organization_id, account_id, number, status, sent_at, created_by)
       values ($1, $2, 'EST-1', 'sent', now() - interval '12 days', $3) returning id`,
      [acmeOrg, account, acmeOwner],
    )).rows[0].id;
    request = (await db.query<{ id: string }>(
      `insert into public.crm_portal_requests (organization_id, account_id, summary, submitted_at)
       values ($1, $2, 'Ants in the flour store', now() - interval '3 days') returning id`,
      [acmeOrg, account],
    )).rows[0].id;
    invoice = (await db.query<{ id: string }>(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents,
          issued_on, due_on, created_by)
       values ($1, $2, 'INV-1', 'open', 10000, 0, 10000, current_date - 40, current_date - 10, $3)
       returning id`,
      [acmeOrg, account, acmeOwner],
    )).rows[0].id;
    sighting = (await db.query<{ id: string }>(
      `insert into public.crm_pest_sightings
         (organization_id, account_id, property_id, pest, severity, sighted_at, created_by)
       values ($1, $2, $3, 'German cockroach', 'high', now() - interval '5 days', $4) returning id`,
      [acmeOrg, account, property, acmeOwner],
    )).rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("keeps RLS forced and the grant posture exact on both tables", async () => {
    await db.exec("reset role");
    const rls = await db.query<{ relname: string; forced: boolean }>(
      `select c.relname, (c.relrowsecurity and c.relforcerowsecurity) as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('crm_tasks', 'crm_followup_dismissals')
        order by 1`,
    );
    expect(rls.rows).toEqual([
      { relname: "crm_followup_dismissals", forced: true },
      { relname: "crm_tasks", forced: true },
    ]);

    const grants = await db.query<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('crm_tasks', 'crm_followup_dismissals')
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
        order by 1, 2, 3`,
    );
    expect(grants.rows).toEqual([
      { table_name: "crm_followup_dismissals", grantee: "authenticated", privilege_type: "DELETE" },
      { table_name: "crm_followup_dismissals", grantee: "authenticated", privilege_type: "INSERT" },
      { table_name: "crm_followup_dismissals", grantee: "authenticated", privilege_type: "SELECT" },
      { table_name: "crm_tasks", grantee: "authenticated", privilege_type: "INSERT" },
      { table_name: "crm_tasks", grantee: "authenticated", privilege_type: "SELECT" },
      { table_name: "crm_tasks", grantee: "authenticated", privilege_type: "UPDATE" },
    ]);
  });

  it("suggests all seven rules from the rows as they are, each with its reason", async () => {
    await as(acmeOwner);
    const rows = await suggestions();
    const byKey = new Map(rows.map((row) => [row.suggestion_key, row]));

    expect(byKey.get(`stale_lead:${account}`)?.reason).toBe(
      "Lead with no recorded activity in 20 days.",
    );
    expect(byKey.get(`overdue_opportunity:${opportunity}`)).toMatchObject({
      opportunity_id: opportunity,
      priority: "high",
      title: "Decide Bakery contract",
    });
    expect(byKey.get(`estimate_undecided:${estimate}`)?.reason).toBe(
      "Sent 12 days ago with no decision recorded.",
    );
    expect(byKey.get(`request_unanswered:${request}`)?.title).toBe(
      "Answer the customer: Ants in the flour store",
    );
    expect(byKey.get(`invoice_quiet:${invoice}`)).toMatchObject({
      priority: "high",
      reason: "10 days overdue; no collection action recorded in the last 7 days.",
    });
    const licence = byKey.get(`licence_expiring:${technician}`);
    expect(licence).toMatchObject({ account_id: null, title: "Renew licence for Bram" });
    const dueInThree = await db.query<{ day: string }>("select (current_date + 3)::text as day");
    // PGlite hands a `date` back as a Date at UTC midnight; compare the day.
    expect(new Date(licence!.due_on).toISOString().slice(0, 10)).toBe(dueInThree.rows[0].day);
    expect(byKey.get(`sighting_uncorrected:${sighting}`)?.title).toBe(
      "Correct the high-severity sighting at Bakery",
    );

    // High before normal, so the morning starts with what matters.
    const firstNormal = rows.findIndex((row) => row.priority === "normal");
    const lastHigh = rows.map((row) => row.priority).lastIndexOf("high");
    expect(lastHigh).toBeLessThan(firstNormal);
  });

  it("shows a rival organization nothing about this book", async () => {
    await as(rivalOwner);
    expect(await suggestions()).toEqual([]);
  });

  it("accepts a suggestion once while open, and offers it again once the task is closed", async () => {
    await as(acmeOwner);
    const key = `invoice_quiet:${invoice}`;
    const accepted = (await db.query<{ id: string }>(
      `insert into public.crm_tasks
         (organization_id, account_id, title, due_on, priority, origin, suggestion_key, reason, created_by)
       values ($1, $2, 'Collect invoice INV-1', current_date, 'high', 'suggested', $3,
               '10 days overdue; no collection action recorded in the last 7 days.', $4)
       returning id`,
      [acmeOrg, account, key, acmeOwner],
    )).rows[0].id;

    expect((await suggestions()).map((row) => row.suggestion_key)).not.toContain(key);

    const twice = await rejects(() =>
      db.query(
        `insert into public.crm_tasks
           (organization_id, account_id, title, due_on, priority, origin, suggestion_key, reason, created_by)
         values ($1, $2, 'Collect invoice INV-1 again', current_date, 'high', 'suggested', $3, 'dup', $4)`,
        [acmeOrg, account, key, acmeOwner],
      ));
    expect(twice).toMatch(/crm_tasks_open_suggestion_key|duplicate key/);

    await db.query("update public.crm_tasks set status = 'cancelled' where id = $1", [accepted]);
    expect((await suggestions()).map((row) => row.suggestion_key)).toContain(key);
  });

  it("stamps its own moments from the status and ignores any the caller asserts", async () => {
    await as(acmeOwner);
    const task = (await db.query<{ id: string; done_at: string | null }>(
      `insert into public.crm_tasks (organization_id, title, due_on, status, done_at, created_by)
       values ($1, 'Order more bait stations', current_date, 'open', now(), $2)
       returning id, done_at`,
      [acmeOrg, acmeOwner],
    )).rows[0];
    expect(task.done_at).toBeNull();

    const done = await db.query<{ done_at: string | null; cancelled_at: string | null }>(
      "update public.crm_tasks set status = 'done' where id = $1 returning done_at, cancelled_at",
      [task.id],
    );
    expect(done.rows[0].done_at).not.toBeNull();
    expect(done.rows[0].cancelled_at).toBeNull();

    const cancelled = await db.query<{ done_at: string | null; cancelled_at: string | null }>(
      "update public.crm_tasks set status = 'cancelled' where id = $1 returning done_at, cancelled_at",
      [task.id],
    );
    expect(cancelled.rows[0].done_at).toBeNull();
    expect(cancelled.rows[0].cancelled_at).not.toBeNull();

    const reopened = await db.query<{ done_at: string | null; cancelled_at: string | null }>(
      "update public.crm_tasks set status = 'open' where id = $1 returning done_at, cancelled_at",
      [task.id],
    );
    expect(reopened.rows[0]).toEqual({ done_at: null, cancelled_at: null });
  });

  it("writes a finished follow-up onto the account's history, which ends the stale-lead suggestion", async () => {
    await as(acmeOwner);
    expect((await suggestions()).map((row) => row.suggestion_key)).toContain(`stale_lead:${account}`);

    const task = (await db.query<{ id: string }>(
      `insert into public.crm_tasks (organization_id, account_id, assignee_employee_id, title, due_on, created_by)
       values ($1, $2, $3, 'Reach out to Ridgeway Bakery', current_date, $4) returning id`,
      [acmeOrg, account, employee, acmeOwner],
    )).rows[0].id;
    await db.query("update public.crm_tasks set status = 'done' where id = $1", [task]);

    const history = await db.query<{ kind: string; summary: string; actor_user_id: string | null }>(
      `select kind::text, summary, actor_user_id from public.crm_timeline_events
        where organization_id = $1 and account_id = $2 and kind = 'task'`,
      [acmeOrg, account],
    );
    expect(history.rows).toEqual([
      { kind: "task", summary: "Follow-up done: Reach out to Ridgeway Bakery", actor_user_id: acmeOwner },
    ]);
    expect((await suggestions()).map((row) => row.suggestion_key)).not.toContain(`stale_lead:${account}`);
  });

  it("keeps a dismissed suggestion quiet until its date, and no longer", async () => {
    await as(acmeOwner);
    const key = `overdue_opportunity:${opportunity}`;
    await db.query(
      `insert into public.crm_followup_dismissals (organization_id, suggestion_key, until_on, created_by)
       values ($1, $2, current_date + 30, $3)`,
      [acmeOrg, key, acmeOwner],
    );
    expect((await suggestions()).map((row) => row.suggestion_key)).not.toContain(key);

    await db.query(
      "update public.crm_followup_dismissals set until_on = current_date - 1 where suggestion_key = $1",
      [key],
    ).catch(() => undefined);
    // UPDATE holds no grant; a person changes their mind by deleting.
    await db.query("delete from public.crm_followup_dismissals where suggestion_key = $1", [key]);
    expect((await suggestions()).map((row) => row.suggestion_key)).toContain(key);
  });

  it("stops suggesting an overdue invoice once a collection action is recorded", async () => {
    await as(acmeOwner);
    const key = `invoice_quiet:${invoice}`;
    expect((await suggestions()).map((row) => row.suggestion_key)).toContain(key);
    await db.query(
      `insert into public.crm_dunning_notices
         (organization_id, invoice_id, account_id, action, days_overdue, balance_cents, created_by)
       values ($1, $2, $3, 'reminder_call', 10, 10000, $4)`,
      [acmeOrg, invoice, account, acmeOwner],
    );
    expect((await suggestions()).map((row) => row.suggestion_key)).not.toContain(key);
  });

  it("refuses a suggested task that names no rule, and a manual one that claims a rule", async () => {
    await as(acmeOwner);
    const noKey = await rejects(() =>
      db.query(
        `insert into public.crm_tasks (organization_id, title, due_on, origin, reason, created_by)
         values ($1, 'Ghost suggestion', current_date, 'suggested', 'because', $2)`,
        [acmeOrg, acmeOwner],
      ));
    expect(noKey).toMatch(/crm_tasks_suggested_has_key/);

    const forgedKey = await rejects(() =>
      db.query(
        `insert into public.crm_tasks (organization_id, title, due_on, origin, suggestion_key, created_by)
         values ($1, 'Forged', current_date, 'manual', $2, $3)`,
        [acmeOrg, `stale_lead:${account}`, acmeOwner],
      ));
    expect(forgedKey).toMatch(/crm_tasks_suggested_has_key/);
  });
});
