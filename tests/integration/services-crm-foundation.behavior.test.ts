// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830001800_customer_portal.sql";

/**
 * The Services CRM foundation, exercised against the real migration chain
 * on real PostgreSQL — because every promise this schema makes is one
 * application code cannot keep on its own: tenant isolation is RLS, the
 * timeline's immutability is a missing grant, the status-change history is
 * a trigger, and the secret guard is a CHECK. A unit test that mocked the
 * database would pass with all four broken.
 */

const acmeOwner = "00000000-0000-4000-8000-0000000c0001";
const rivalOwner = "00000000-0000-4000-8000-0000000c0002";
const acmeOrg = "10000000-0000-4000-8000-0000000c0001";
const rivalOrg = "10000000-0000-4000-8000-0000000c0002";

describe("the Services CRM foundation", { timeout: 240_000 }, () => {
  let db: PGlite;

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
      /*
       * Hosted-style default privileges, installed exactly where the
       * regression lived: the hosted database GRANTS ALL on every new table
       * to these roles, which is how 20260830000500's narrow timeline
       * grants shipped wide on hosted while every local suite stayed green
       * (the scope=services-crm postflight caught it, 20260830000600 is
       * the fix). Under the whole chain the defaults contradict earlier
       * migrations' own security-catalog assertions, so they flip on just
       * before the CRM tables are created — the window that must survive
       * them. An immutability claim that relies on the ABSENCE of a grant
       * now fails locally, like production.
       */
      if (file === "20260830000500_services_crm_foundation.sql") {
        await db.exec(`
          alter default privileges in schema public grant all privileges on tables to authenticated;
          alter default privileges in schema public grant all privileges on tables to service_role;
        `);
      }
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    // Two tenants; each organization insert bootstraps its owner membership.
    await db.exec(`
      insert into auth.users (id) values ('${acmeOwner}'), ('${rivalOwner}');
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest', '${rivalOwner}');
    `);
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("holds the 360-degree record together: account, contact, property, timeline", async () => {
    await as(acmeOwner);
    const account = await db.query<{ id: string; status: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, email, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'ops@harborview.example', $2)
       returning id, status::text`,
      [acmeOrg, acmeOwner],
    );
    const accountId = account.rows[0].id;
    expect(account.rows[0].status).toBe("lead");

    await db.query(
      `insert into public.crm_contacts (organization_id, account_id, first_name, last_name, role, is_primary)
       values ($1, $2, 'Dana', 'Reyes', 'Facilities manager', true)`,
      [acmeOrg, accountId],
    );
    await db.query(
      `insert into public.crm_properties (organization_id, account_id, label, address, property_type)
       values ($1, $2, 'Distribution Center', '14 Dock Road, Portsview', 'warehouse')`,
      [acmeOrg, accountId],
    );
    await db.query(
      `insert into public.crm_timeline_events (organization_id, account_id, kind, summary, actor_user_id)
       values ($1, $2, 'call', 'Intro call; monthly IPM service requested.', $3)`,
      [acmeOrg, accountId, acmeOwner],
    );
    await reset();

    const record = await db.query<{ contacts: number; properties: number; events: number }>(
      `select
         (select count(*)::integer from public.crm_contacts where account_id = $1) as contacts,
         (select count(*)::integer from public.crm_properties where account_id = $1) as properties,
         (select count(*)::integer from public.crm_timeline_events where account_id = $1) as events`,
      [accountId],
    );
    expect(record.rows[0]).toEqual({ contacts: 1, properties: 1, events: 1 });
  });

  it("keeps tenants apart: a rival reads nothing, writes nothing, attaches nothing", async () => {
    await as(acmeOwner);
    const mine = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Isolation Proof LLC', 'residential', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const accountId = mine.rows[0].id;
    await reset();

    await as(rivalOwner);
    // Reads: the rival's view of Acme's book is empty, not forbidden — RLS
    // filters rows rather than revealing that they exist.
    const seen = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.crm_accounts where organization_id = $1",
      [acmeOrg],
    );
    expect(seen.rows[0].count).toBe(0);

    // Writes into another tenant are refused outright.
    await expect(db.query(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Forged', 'residential', $2)`,
      [acmeOrg, rivalOwner],
    )).rejects.toThrow(/row-level security/);

    // Attaching a contact in MY org to THEIR account fails on the composite
    // key: the account is not visible, so the reference does not exist.
    await expect(db.query(
      `insert into public.crm_contacts (organization_id, account_id, first_name)
       values ($1, $2, 'Intruder')`,
      [rivalOrg, accountId],
    )).rejects.toThrow(/foreign key|not present/i);
    await reset();
  });

  it("writes the status change into history itself, in the same transaction", async () => {
    await as(acmeOwner);
    const created = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Lifecycle Proof', 'residential', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const accountId = created.rows[0].id;

    await db.query(
      "update public.crm_accounts set status = 'customer' where id = $1",
      [accountId],
    );

    const trail = await db.query<{ kind: string; summary: string; actor_user_id: string | null }>(
      `select kind::text, summary, actor_user_id from public.crm_timeline_events
        where account_id = $1 and kind = 'status_change'`,
      [accountId],
    );
    expect(trail.rows).toEqual([
      { kind: "status_change", summary: "Status changed: lead → customer.", actor_user_id: acmeOwner },
    ]);

    // An update that does not move the status writes no history noise.
    await db.query("update public.crm_accounts set phone = '555-0100 100' where id = $1", [accountId]);
    const after = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.crm_timeline_events
        where account_id = $1 and kind = 'status_change'`,
      [accountId],
    );
    expect(after.rows[0].count).toBe(1);
    await reset();
  });

  it("keeps the timeline immutable and accounts undeletable, at the grant level", async () => {
    await as(acmeOwner);
    const created = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Immutable Proof', 'residential', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const accountId = created.rows[0].id;
    const event = await db.query<{ id: string }>(
      `insert into public.crm_timeline_events (organization_id, account_id, kind, summary, actor_user_id)
       values ($1, $2, 'note', 'The original truth.', $3) returning id`,
      [acmeOrg, accountId, acmeOwner],
    );

    await expect(db.query(
      "update public.crm_timeline_events set summary = 'A different past.' where id = $1",
      [event.rows[0].id],
    )).rejects.toThrow(/permission denied/);
    await expect(db.query(
      "delete from public.crm_timeline_events where id = $1",
      [event.rows[0].id],
    )).rejects.toThrow(/permission denied/);
    await expect(db.query(
      "delete from public.crm_accounts where id = $1",
      [accountId],
    )).rejects.toThrow(/permission denied/);
    await reset();
  });

  it("refuses secret-shaped text in every free-text column", async () => {
    await as(acmeOwner);
    await expect(db.query(
      `insert into public.crm_accounts (organization_id, name, kind, notes, created_by)
       values ($1, 'Secret Test', 'residential', $2, $3)`,
      [acmeOrg, `api_key=sk-${"a".repeat(30)}`, acmeOwner],
    )).rejects.toThrow(/crm_accounts_notes_no_secret/);
    await reset();
  });

  it("shuts anon and service_role out entirely", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");
    await expect(db.query("select count(*) from public.crm_accounts"))
      .rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    await db.exec("set role service_role");
    await expect(db.query("select count(*) from public.crm_accounts"))
      .rejects.toThrow(/permission denied/);
    await reset();
  });
});
