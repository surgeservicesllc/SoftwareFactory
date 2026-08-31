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
 * The offline field queue (ADR-210) against the real migration chain.
 *
 * A crawlspace has no signal. A technician taps complete and drives away,
 * and the queue retries — through a tunnel, a dead battery, a week in a
 * van. Exactly one thing must be true afterwards, and the technician must
 * know which: the visit is recorded, or it is visibly still unsent.
 *
 * The outcome this suite exists to make impossible is the third one — the
 * tap appeared to work, the write went twice or went nowhere, and nobody
 * finds out until a customer disputes an invoice.
 *
 * So every test here is a retry story.
 */

const acmeOwner = "00000000-0000-4000-8000-000000010f01";
const rivalOwner = "00000000-0000-4000-8000-000000010f02";
const acmeOrg = "10000000-0000-4000-8000-000000010f01";
const rivalOrg = "10000000-0000-4000-8000-000000010f02";

describe("the offline field queue", { timeout: 240_000 }, () => {
  let db: PGlite;

  let acmeAccount = "";
  let plantSite = "";
  let technician = "";
  let visit = "";
  let station = "";
  let rivalVisit = "";

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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-field', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-field', '${rivalOwner}');
    `);

    await as(acmeOwner);
    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    acmeAccount = account.rows[0].id;
    const site = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Plant', '4100 Cannery Row') returning id`,
      [acmeOrg, acmeAccount],
    );
    plantSite = site.rows[0].id;
    const tech = await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Ada', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    technician = tech.rows[0].id;
    const order = await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, status, service_type,
          scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, $4, 'dispatched', 'Quarterly IPM',
               now() - interval '4 hours', now() - interval '2 hours', $5) returning id`,
      [acmeOrg, acmeAccount, plantSite, technician, acmeOwner],
    );
    visit = order.rows[0].id;
    const device = await db.query<{ id: string }>(
      `insert into public.crm_devices
         (organization_id, account_id, property_id, label, device_type, barcode, created_by)
       values ($1, $2, $3, 'RB-01', 'bait_station', 'HV-RB-9001', $4) returning id`,
      [acmeOrg, acmeAccount, plantSite, acmeOwner],
    );
    station = device.rows[0].id;
    await reset();

    await as(rivalOwner);
    const rivalAccount = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Rival Grocers', 'commercial', 'customer', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    const rivalProperty = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Rival DC', '77 Sideline Ave') returning id`,
      [rivalOrg, rivalAccount.rows[0].id],
    );
    const rivalOrder = await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, status, service_type,
          scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, 'dispatched', 'Quarterly IPM',
               now() - interval '4 hours', now() - interval '2 hours', $4) returning id`,
      [rivalOrg, rivalAccount.rows[0].id, rivalProperty.rows[0].id, rivalOwner],
    );
    rivalVisit = rivalOrder.rows[0].id;
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("records a visit completed in a crawlspace, at the moment it happened", async () => {
    await as(acmeOwner);
    const token = "a0000000-0000-4000-8000-00000000f001";
    // 09:12 in the crawlspace; the request only leaves the van at 14:40.
    const occurred = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    const first = await db.query<{ work_order_id: string; replayed: boolean }>(
      "select * from public.crm_field_complete_visit($1, $2, $3::timestamptz, $4)",
      [token, visit, occurred, "Rebaited the north dock line."],
    );
    expect(first.rows[0].work_order_id).toBe(visit);
    expect(first.rows[0].replayed).toBe(false);

    const stored = await db.query<{ status: string; completed_at: string }>(
      "select status, completed_at from public.crm_work_orders where id = $1", [visit],
    );
    expect(stored.rows[0].status).toBe("completed");
    // The technician's moment, not the sync's. Collapsing the two would
    // misreport when the work was actually done.
    expect(new Date(stored.rows[0].completed_at).toISOString()).toBe(
      new Date(occurred).toISOString(),
    );
    await reset();
  });

  it("survives the tunnel: the same token replayed returns the first outcome, not a second write", async () => {
    await as(acmeOwner);
    const token = "a0000000-0000-4000-8000-00000000f001";
    const before = await db.query<{ completed_at: string }>(
      "select completed_at from public.crm_work_orders where id = $1", [visit],
    );

    // Five retries, as a queue that lost its connection mid-request would.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const again = await db.query<{ work_order_id: string; replayed: boolean }>(
        "select * from public.crm_field_complete_visit($1, $2, now(), $3)",
        [token, visit, "a different note from a confused retry"],
      );
      expect(again.rows[0].replayed).toBe(true);
      expect(again.rows[0].work_order_id).toBe(visit);
    }

    const after = await db.query<{ completed_at: string; completion_notes: string }>(
      "select completed_at, completion_notes from public.crm_work_orders where id = $1", [visit],
    );
    // Untouched: not re-completed with `now()`, and the note the technician
    // actually wrote is not overwritten by a retry carrying different text.
    expect(after.rows[0].completed_at).toEqual(before.rows[0].completed_at);
    expect(after.rows[0].completion_notes).toBe("Rebaited the north dock line.");

    // And exactly one submission exists for that token.
    const submissions = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.crm_field_submissions where client_token = $1",
      [token],
    );
    expect(submissions.rows[0].count).toBe(1);
    await reset();
  });

  it("never double-counts a station scan, which the append-only ledger could not undo", async () => {
    await as(acmeOwner);
    const token = "a0000000-0000-4000-8000-00000000f002";
    const occurred = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    const first = await db.query<{ device_event_id: string; replayed: boolean }>(
      "select * from public.crm_field_record_scan($1, $2, $3::timestamptz, 'ok', 4, 'Norway rat', null)",
      [token, station, occurred],
    );
    expect(first.rows[0].replayed).toBe(false);
    const eventId = first.rows[0].device_event_id;
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const again = await db.query<{ device_event_id: string; replayed: boolean }>(
        "select * from public.crm_field_record_scan($1, $2, now(), 'damaged', 99, null, null)",
        [token, station],
      );
      expect(again.rows[0].replayed).toBe(true);
      // The SAME event comes back, so a client can reconcile its queue
      // against a real id rather than guessing.
      expect(again.rows[0].device_event_id).toBe(eventId);
    }

    // One service scan, count 4 — not five scans, and not a 99.
    const events = await db.query<{ count: number; total: number }>(
      `select count(*)::integer as count, coalesce(sum(activity_count), 0)::integer as total
         from public.crm_device_events
        where device_id = $1 and event = 'service'`,
      [station],
    );
    expect(events.rows[0].count).toBe(1);
    expect(events.rows[0].total).toBe(4);
    await reset();
  });

  it("does not let a late arrival overwrite a visit somebody already closed", async () => {
    await as(acmeOwner);
    const order = await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, status, service_type,
          scheduled_start, scheduled_end, completed_at, completion_notes, created_by)
       values ($1, $2, $3, 'completed', 'Quarterly IPM',
               now() - interval '2 days', now() - interval '2 days' + interval '2 hours',
               now() - interval '2 days' + interval '90 minutes',
               'Closed in the office from the paper ticket.', $4) returning id`,
      [acmeOrg, acmeAccount, plantSite, acmeOwner],
    );
    const already = order.rows[0].id;
    const originally = await db.query<{ completed_at: string; completion_notes: string }>(
      "select completed_at, completion_notes from public.crm_work_orders where id = $1", [already],
    );

    // A device surfaces after a week and replays a completion for a visit
    // the office already closed. Its own moment does not win.
    const result = await db.query<{ replayed: boolean }>(
      "select * from public.crm_field_complete_visit($1, $2, now(), $3)",
      ["a0000000-0000-4000-8000-00000000f003", already, "From the van, a week late."],
    );
    expect(result.rows[0].replayed).toBe(false);

    const after = await db.query<{ completed_at: string; completion_notes: string }>(
      "select completed_at, completion_notes from public.crm_work_orders where id = $1", [already],
    );
    expect(after.rows[0].completed_at).toEqual(originally.rows[0].completed_at);
    expect(after.rows[0].completion_notes).toBe("Closed in the office from the paper ticket.");
    await reset();
  });

  it("lets a device ask the server which of its queued writes actually landed", async () => {
    await as(acmeOwner);
    const settled = await db.query<{ client_token: string; kind: string; result_id: string | null }>(
      "select * from public.crm_field_settled_tokens($1::uuid[])",
      [[
        "a0000000-0000-4000-8000-00000000f001",
        "a0000000-0000-4000-8000-00000000f002",
        // Never sent, or sent and lost before it arrived. The server says
        // so, and the client keeps it queued rather than assuming.
        "a0000000-0000-4000-8000-0000deadbeef",
      ]],
    );
    const tokens = settled.rows.map((row) => row.client_token);
    expect(tokens).toContain("a0000000-0000-4000-8000-00000000f001");
    expect(tokens).toContain("a0000000-0000-4000-8000-00000000f002");
    expect(tokens).not.toContain("a0000000-0000-4000-8000-0000deadbeef");
    expect(settled.rows).toHaveLength(2);

    // The scan's submission carries the event it produced.
    const scan = settled.rows.find((row) => row.kind === "device_scan");
    expect(scan?.result_id).not.toBeNull();
    await reset();
  });

  it("keeps one workspace's tokens out of another's, even on a collision", async () => {
    // The token is unique PER ORGANIZATION, so two tenants can mint the
    // same uuid without either seeing the other's submission.
    const shared = "a0000000-0000-4000-8000-00000000f001";
    await as(rivalOwner);
    const settled = await db.query("select * from public.crm_field_settled_tokens($1::uuid[])", [
      [shared],
    ]);
    expect(settled.rows).toHaveLength(0);

    // And the rival can use that same token for their own visit.
    const own = await db.query<{ replayed: boolean }>(
      "select * from public.crm_field_complete_visit($1, $2, now(), null)",
      [shared, rivalVisit],
    );
    expect(own.rows[0].replayed).toBe(false);
    await reset();

    // Acme's submission for that token is untouched and still theirs.
    await as(acmeOwner);
    const mine = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.crm_field_submissions
        where client_token = $1 and organization_id = $2`,
      [shared, acmeOrg],
    );
    expect(mine.rows[0].count).toBe(1);
    await reset();
  });

  it("refuses a visit that is not the caller's, and says nothing about whether it exists", async () => {
    await as(rivalOwner);
    await expect(
      db.query("select * from public.crm_field_complete_visit($1, $2, now(), null)", [
        "a0000000-0000-4000-8000-00000000f009", visit,
      ]),
    ).rejects.toThrow(/no such work order/);
    await expect(
      db.query("select * from public.crm_field_record_scan($1, $2, now())", [
        "a0000000-0000-4000-8000-00000000f00a", station,
      ]),
    ).rejects.toThrow(/no such station/);
    await reset();
  });

  it("keeps the submission log as evidence: append-only, forced RLS, never deletable", async () => {
    const posture = await db.query<{ enabled: boolean; forced: boolean }>(
      `select relrowsecurity as enabled, relforcerowsecurity as forced
         from pg_class where oid = 'public.crm_field_submissions'::regclass`,
    );
    expect(posture.rows[0].enabled).toBe(true);
    expect(posture.rows[0].forced).toBe(true);

    // A submission is the proof a field write arrived. Deleting one would
    // make a recorded visit look like it was never sent.
    const deletable = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('authenticated', 'public.crm_field_submissions', 'delete') as allowed",
    );
    expect(deletable.rows[0].allowed).toBe(false);

    const anonRead = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('anon', 'public.crm_field_submissions', 'select') as allowed",
    );
    expect(anonRead.rows[0].allowed).toBe(false);
  });

  it("keeps every field function an invoker, so the caller's own policies still apply", async () => {
    const polarity = await db.query<{ proname: string; prosecdef: boolean }>(
      `select p.proname, p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'crm_field_%'`,
    );
    expect(polarity.rows.length).toBeGreaterThanOrEqual(3);
    // A definer here would widen authority to buy nothing: the caller is a
    // member and every table these touch already has policies.
    expect(polarity.rows.every((row) => !row.prosecdef)).toBe(true);
  });
});
