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
 * The customer's side of the conversation (ADR-233) against the real
 * chain: a rating per completed visit written only by the customer and
 * never edited; a clock on every request computed from stamps the row sets
 * itself; a message thread either side writes and neither side can alter.
 */

const acmeOwner = "00000000-0000-4000-8000-000000033001";
const rivalOwner = "00000000-0000-4000-8000-000000033002";
const portalUser = "00000000-0000-4000-8000-000000033003";
const acmeOrg = "10000000-0000-4000-8000-000000033001";
const rivalOrg = "10000000-0000-4000-8000-000000033002";

describe("the customer's side: surveys, the SLA clock, two-way messages", { timeout: 240_000 }, () => {
  let db: PGlite;
  let harborview = ""; let harborviewSite = "";
  let otherAccount = ""; let otherSite = "";
  let rosa = "";
  let doneVisit = ""; let openVisit = ""; let otherVisit = "";
  let complaint = ""; let question = ""; let unrecorded = "";
  let customerMessage = ""; let staffMessage = "";

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
      insert into auth.users (id, email) values
        ('${acmeOwner}', 'owner@acme.example'), ('${rivalOwner}', 'owner@rival.example'),
        ('${portalUser}', 'dana@harborview.example');
      insert into public.organizations (id, name, slug, created_by)
      values ('${acmeOrg}', 'Acme Pest', 'acme-pest-side', '${acmeOwner}'),
             ('${rivalOrg}', 'Rival Pest', 'rival-pest-side', '${rivalOwner}');
    `);
    await as(acmeOwner);
    harborview = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    harborviewSite = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Plant', '1 Loaf Lane') returning id`, [acmeOrg, harborview])).rows[0].id;
    otherAccount = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Ridgeway Bakery', 'commercial', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    otherSite = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Bakery', '2 Crust Road') returning id`, [acmeOrg, otherAccount])).rows[0].id;
    rosa = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Rosa', 'Vega', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const visit = async (account: string, property: string, status: string) => (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type, scheduled_start, scheduled_end, status, created_by)
       values ($1, $2, $3, $4, 'General pest', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', $5, $6)
       returning id`, [acmeOrg, account, property, rosa, status, acmeOwner])).rows[0].id;
    doneVisit = await visit(harborview, harborviewSite, "completed");
    openVisit = await visit(harborview, harborviewSite, "scheduled");
    otherVisit = await visit(otherAccount, otherSite, "completed");

    // Requests: a complaint six hours old and untouched; a question an hour
    // old; an office-filed request already acknowledged with no stamp.
    const request = async (kind: string, status: string, hoursAgo: number) => (await db.query<{ id: string }>(
      `insert into public.crm_portal_requests (organization_id, account_id, kind, status, summary, submitted_at, created_by)
       values ($1, $2, $3, $4, $5, now() - make_interval(hours => $6), $7) returning id`,
      [acmeOrg, harborview, kind, status, `${kind} from Harborview`, hoursAgo, acmeOwner])).rows[0].id;
    complaint = await request("complaint", "submitted", 6);
    question = await request("question", "submitted", 1);
    unrecorded = await request("service", "acknowledged", 3);

    // Dana's portal login, attached by Dana herself (the guard's rule).
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [portalUser]);
    await db.query(
      `insert into public.crm_portal_users (organization_id, account_id, user_id, email, activated_at, created_by)
       values ($1, $2, $3, 'dana@harborview.example', now(), $4)`,
      [acmeOrg, harborview, portalUser, acmeOwner]);
  });

  afterAll(async () => { await db?.close(); });

  it("lets the customer rate a completed visit once, on their own account, and keeps it as history", async () => {
    await as(portalUser);
    const id = (await db.query<{ id: string }>(
      `select public.crm_portal_survey_submit($1, 4, ' Rosa was thorough. ') as id`, [doneVisit])).rows[0].id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await rejects(() => db.query(`select public.crm_portal_survey_submit($1, 5)`, [doneVisit]))).toMatch(/already been rated/);
    expect(await rejects(() => db.query(`select public.crm_portal_survey_submit($1, 5)`, [openVisit]))).toMatch(/once it is completed/);
    expect(await rejects(() => db.query(`select public.crm_portal_survey_submit($1, 5)`, [otherVisit]))).toMatch(/not on this account/);
    expect(await rejects(() => db.query(`select public.crm_portal_survey_submit($1, 6)`, [otherVisit]))).toMatch(/not on this account|check/);

    const mine = await db.query<{ work_order_id: string; score: number; comment: string }>(
      `select work_order_id, score, comment from public.crm_portal_surveys_mine()`);
    expect(mine.rows).toEqual([{ work_order_id: doneVisit, score: 4, comment: "Rosa was thorough." }]);
    // The table itself is not the customer's to read.
    expect((await db.query(`select 1 from public.crm_portal_surveys`)).rows).toHaveLength(0);

    await as(acmeOwner);
    const responses = await db.query<{ account_name: string; technician_name: string; score: number; comment: string }>(
      `select account_name, technician_name, score, comment from public.crm_survey_responses($1, 90)`, [acmeOrg]);
    expect(responses.rows).toEqual([{ account_name: "Harborview Foods", technician_name: "Rosa Vega", score: 4, comment: "Rosa was thorough." }]);
    const history = await db.query<{ summary: string; detail: string }>(
      `select summary, detail from public.crm_timeline_events where account_id = $1 and summary like 'Rated%'`, [harborview]);
    expect(history.rows).toEqual([{ summary: "Rated the visit 4/5 (General pest).", detail: "Rosa was thorough." }]);
    // Staff read; staff never edit or delete a rating.
    expect(await rejects(() => db.query(`update public.crm_portal_surveys set score = 5 where work_order_id = $1`, [doneVisit]))).toMatch(/permission denied/);
    expect(await rejects(() => db.query(`delete from public.crm_portal_surveys where work_order_id = $1`, [doneVisit]))).toMatch(/permission denied/);

    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_survey_responses($1, 90)`, [acmeOrg])).rows).toHaveLength(0);
  });

  it("clocks every request from stamps the row sets itself, against defaults a workspace may override", async () => {
    await as(acmeOwner);
    const defaults = await db.query<{ kind: string; acknowledge_hours: number; resolve_hours: number; overridden: boolean }>(
      `select kind::text as kind, acknowledge_hours, resolve_hours, overridden from public.crm_effective_sla($1)`, [acmeOrg]);
    expect(defaults.rows).toHaveLength(6);
    expect(defaults.rows.every((row) => !row.overridden)).toBe(true);
    expect(defaults.rows.find((row) => row.kind === "complaint")).toMatchObject({ acknowledge_hours: 4, resolve_hours: 48 });

    await db.query(
      `insert into public.crm_sla_policies (organization_id, kind, acknowledge_hours, resolve_hours, updated_by)
       values ($1, 'complaint', 2, 24, $2)`, [acmeOrg, acmeOwner]);
    expect(await rejects(() => db.query(
      `insert into public.crm_sla_policies (organization_id, kind, acknowledge_hours, resolve_hours, updated_by)
       values ($1, 'quote', 48, 24, $2)`, [acmeOrg, acmeOwner]))).toMatch(/crm_sla_policies_resolve_after_acknowledge/);
    const effective = await db.query<{ kind: string; acknowledge_hours: number; overridden: boolean }>(
      `select kind::text as kind, acknowledge_hours, overridden from public.crm_effective_sla($1) where kind = 'complaint'`, [acmeOrg]);
    expect(effective.rows).toEqual([{ kind: "complaint", acknowledge_hours: 2, overridden: true }]);

    type Clock = { request_id: string; acknowledge_state: string; resolve_state: string; waiting_minutes: number | null };
    const clock = async () => (await db.query<Clock>(
      `select request_id, acknowledge_state, resolve_state, waiting_minutes from public.crm_request_sla($1, 30)`, [acmeOrg])).rows;
    let rows = await clock();
    expect(rows.find((r) => r.request_id === complaint)).toMatchObject({ acknowledge_state: "overdue", resolve_state: "waiting" });
    expect(rows.find((r) => r.request_id === question)).toMatchObject({ acknowledge_state: "waiting", resolve_state: "waiting" });
    expect(rows.find((r) => r.request_id === unrecorded)).toMatchObject({ acknowledge_state: "unrecorded", resolve_state: "waiting" });
    expect(rows[0].request_id).toBe(complaint);
    expect(rows.find((r) => r.request_id === complaint)?.waiting_minutes).toBeGreaterThanOrEqual(359);

    // Acknowledging now, six hours in, is a breach the row records itself.
    await db.query(`update public.crm_portal_requests set status = 'acknowledged' where id = $1`, [complaint]);
    // Answering the question stamps the first response; resolving it meets the clock.
    await db.query(`update public.crm_portal_requests set response = 'On it.' where id = $1`, [question]);
    await db.query(`update public.crm_portal_requests set status = 'resolved', resolved_at = now() where id = $1`, [question]);
    const stamps = await db.query<{ id: string; acknowledged: boolean; responded: boolean }>(
      `select id, acknowledged_at is not null as acknowledged, first_response_at is not null as responded
         from public.crm_portal_requests where id in ($1, $2) order by submitted_at`, [complaint, question]);
    expect(stamps.rows).toEqual([
      { id: complaint, acknowledged: true, responded: false },
      { id: question, acknowledged: true, responded: true },
    ]);
    rows = await clock();
    expect(rows.find((r) => r.request_id === complaint)).toMatchObject({ acknowledge_state: "breached", resolve_state: "waiting" });
    expect(rows.find((r) => r.request_id === question)).toMatchObject({ acknowledge_state: "met", resolve_state: "met", waiting_minutes: null });
    expect(rows.map((r) => r.request_id)).toEqual([complaint, unrecorded, question]);

    // A stamp cannot be moved by hand.
    await db.query(`update public.crm_portal_requests set acknowledged_at = null where id = $1`, [complaint]);
    const kept = await db.query<{ kept: boolean }>(
      `select acknowledged_at is not null as kept from public.crm_portal_requests where id = $1`, [complaint]);
    expect(kept.rows[0].kept).toBe(true);
  });

  it("threads messages either side writes and neither side can alter", async () => {
    await as(portalUser);
    customerMessage = (await db.query<{ id: string }>(
      `select public.crm_portal_message_send('  The gate code changed to 4471. ', $1) as id`, [complaint])).rows[0].id;
    await as(acmeOwner);
    const ridgewayRequest = (await db.query<{ id: string }>(
      `insert into public.crm_portal_requests (organization_id, account_id, kind, summary, created_by)
       values ($1, $2, 'service', 'Ridgeway asks', $3) returning id`, [acmeOrg, otherAccount, acmeOwner])).rows[0].id;
    await as(portalUser);
    expect(await rejects(() => db.query(`select public.crm_portal_message_send('x', $1)`, [ridgewayRequest]))).toMatch(/not on this account/);
    expect((await db.query(`select 1 from public.crm_portal_messages`)).rows).toHaveLength(0);

    await as(acmeOwner);
    staffMessage = (await db.query<{ id: string }>(
      `insert into public.crm_portal_messages (organization_id, account_id, request_id, author_kind, author_user_id, body)
       values ($1, $2, $3, 'staff', $4, 'Thanks — updated on the visit notes.') returning id`,
      [acmeOrg, harborview, complaint, acmeOwner])).rows[0].id;
    expect(await rejects(() => db.query(
      `insert into public.crm_portal_messages (organization_id, account_id, author_kind, author_user_id, body)
       values ($1, $2, 'staff', $3, 'as somebody else')`, [acmeOrg, harborview, rivalOwner]))).toMatch(/row-level security/);
    expect(await rejects(() => db.query(
      `insert into public.crm_portal_messages (organization_id, account_id, author_kind, author_user_id, body)
       values ($1, $2, 'customer', $3, 'pretending')`, [acmeOrg, harborview, acmeOwner]))).toMatch(/row-level security|author_matches_kind/);
    expect(await rejects(() => db.query(`update public.crm_portal_messages set body = 'edited' where id = $1`, [customerMessage]))).toMatch(/cannot be changed/);
    await db.query(`update public.crm_portal_messages set read_at = now() where id = $1`, [customerMessage]);
    expect(await rejects(() => db.query(`update public.crm_portal_messages set read_at = now() + interval '1 hour' where id = $1`, [customerMessage]))).toMatch(/set once/);

    await as(portalUser);
    const thread = await db.query<{ id: string; author_kind: string; body: string; read: boolean }>(
      `select id, author_kind::text as author_kind, body, read_at is not null as read from public.crm_portal_messages_mine()`);
    expect(thread.rows).toEqual([
      { id: customerMessage, author_kind: "customer", body: "The gate code changed to 4471.", read: true },
      { id: staffMessage, author_kind: "staff", body: "Thanks — updated on the visit notes.", read: false },
    ]);
    expect((await db.query<{ n: number }>(`select public.crm_portal_messages_mark_read() as n`)).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>(`select public.crm_portal_messages_mark_read() as n`)).rows[0].n).toBe(0);

    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_portal_messages`)).rows).toHaveLength(0);
  });

  it("grants the functions to authenticated only and keeps the tables fenced", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{ fn: string; anon: boolean; authenticated: boolean; service_role: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service_role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'crm_sla_defaults', 'crm_effective_sla', 'crm_request_sla', 'crm_portal_survey_submit',
          'crm_portal_surveys_mine', 'crm_survey_responses', 'crm_portal_message_send',
          'crm_portal_messages_mine', 'crm_portal_messages_mark_read')
        order by 1`);
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(row, row.fn).toMatchObject({ anon: false, authenticated: true, service_role: false });
    const fenced = await db.query<{ tablename: string; rls: boolean; forced: boolean }>(
      `select c.relname as tablename, c.relrowsecurity as rls, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('crm_portal_surveys', 'crm_portal_messages', 'crm_sla_policies')
        order by 1`);
    expect(fenced.rows).toEqual([
      { tablename: "crm_portal_messages", rls: true, forced: true },
      { tablename: "crm_portal_surveys", rls: true, forced: true },
      { tablename: "crm_sla_policies", rls: true, forced: true },
    ]);
  });
});
