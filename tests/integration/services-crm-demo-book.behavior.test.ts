// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO_BOOK, DEMO_SOURCE, demoBookTotals } from "@/lib/services/demo-data";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830000700_crm_pipeline_search.sql";

/**
 * The Demo Data book, replayed against the real migration chain move for
 * move, exactly as the seeder replays it through the client: accounts in as
 * leads, statuses walked so the trigger writes the history, contacts and
 * properties attached, opportunities walked through their stage paths,
 * manual events recorded. If any seeded string oversteps a CHECK — a
 * 33-character phone, a 301-character summary, a note the secret detector
 * dislikes — the production seed would 500, and this is where that fails
 * first.
 */

const owner = "00000000-0000-4000-8000-0000000e0001";
const org = "10000000-0000-4000-8000-0000000e0001";

describe("the Demo Data book against the real schema", { timeout: 240_000 }, () => {
  let db: PGlite;

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
      // Hosted-style default privileges before the CRM window, as in the
      // other CRM chain suites.
      if (file === "20260830000500_services_crm_foundation.sql") {
        await db.exec(`
          alter default privileges in schema public grant all privileges on tables to authenticated;
          alter default privileges in schema public grant all privileges on tables to service_role;
        `);
      }
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${owner}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${org}', 'Demo Seed Org', 'demo-seed-org', '${owner}');
    `);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec("set role authenticated");
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("inserts whole and earns its history through the triggers", async () => {
    const accountIds = new Map<string, string>();
    for (const account of DEMO_BOOK) {
      const inserted = await db.query<{ id: string }>(
        `insert into public.crm_accounts
           (organization_id, name, kind, status, email, phone, source, billing_address, notes, created_by)
         values ($1, $2, $3, 'lead', $4, $5, $6, $7, $8, $9) returning id`,
        [org, account.name, account.kind, account.email, account.phone, DEMO_SOURCE,
         account.billingAddress, account.notes ?? null, owner],
      );
      const accountId = inserted.rows[0].id;
      accountIds.set(account.name, accountId);

      for (const status of account.statusPath) {
        await db.query("update public.crm_accounts set status = $1 where id = $2", [status, accountId]);
      }
      for (const [index, contact] of account.contacts.entries()) {
        await db.query(
          `insert into public.crm_contacts
             (organization_id, account_id, first_name, last_name, role, email, phone, is_primary)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [org, accountId, contact.firstName, contact.lastName, contact.role ?? null,
           contact.email ?? null, contact.phone ?? null, index === 0],
        );
      }
      for (const property of account.properties) {
        await db.query(
          `insert into public.crm_properties
             (organization_id, account_id, label, address, property_type, access_notes)
           values ($1, $2, $3, $4, $5, $6)`,
          [org, accountId, property.label, property.address,
           property.propertyType ?? null, property.accessNotes ?? null],
        );
      }
      for (const opportunity of account.opportunities) {
        const insertedOpportunity = await db.query<{ id: string }>(
          `insert into public.crm_opportunities
             (organization_id, account_id, name, stage, value_cents, expected_close_date, created_by)
           values ($1, $2, $3, 'new', $4, $5, $6) returning id`,
          [org, accountId, opportunity.name, opportunity.valueCents,
           opportunity.expectedInDays === undefined
             ? null
             : new Date(Date.now() + opportunity.expectedInDays * 86_400_000).toISOString().slice(0, 10),
           owner],
        );
        for (const stage of opportunity.stagePath) {
          await db.query(
            `update public.crm_opportunities
                set stage = $1, lost_reason = $2 where id = $3`,
            [stage, stage === "lost" ? opportunity.lostReason ?? null : null,
             insertedOpportunity.rows[0].id],
          );
        }
      }
      for (const event of account.events) {
        await db.query(
          `insert into public.crm_timeline_events
             (organization_id, account_id, kind, summary, detail, occurred_at, actor_user_id)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [org, accountId, event.kind, event.summary, event.detail ?? null,
           new Date(Date.now() - event.daysAgo * 86_400_000).toISOString(), owner],
        );
      }
    }

    const totals = demoBookTotals();
    const counted = await db.query<{ accounts: number; contacts: number; properties: number; opportunities: number; events: number }>(
      `select
         (select count(*)::integer from public.crm_accounts where organization_id = $1) as accounts,
         (select count(*)::integer from public.crm_contacts where organization_id = $1) as contacts,
         (select count(*)::integer from public.crm_properties where organization_id = $1) as properties,
         (select count(*)::integer from public.crm_opportunities where organization_id = $1) as opportunities,
         (select count(*)::integer from public.crm_timeline_events where organization_id = $1) as events`,
      [org],
    );
    expect(counted.rows[0]).toEqual({
      accounts: totals.accounts,
      contacts: totals.contacts,
      properties: totals.properties,
      opportunities: totals.opportunities,
      // Manual events plus one trigger-written line per status and stage move.
      events: totals.manualEvents + totals.statusMoves + totals.stageMoves,
    });
  });

  it("every seeded row is labeled and fictional, and the machinery closed what should be closed", async () => {
    const labels = await db.query<{ unlabeled: number; realish: number }>(
      `select
         count(*) filter (where source is distinct from '${DEMO_SOURCE}')::integer as unlabeled,
         count(*) filter (where email not like '%.example' or phone not like '(555)%')::integer as realish
       from public.crm_accounts where organization_id = $1`,
      [org],
    );
    expect(labels.rows[0]).toEqual({ unlabeled: 0, realish: 0 });

    const closed = await db.query<{ open_closed: number; closed_open: number; lost_without_detail: number }>(
      `select
         count(*) filter (where stage in ('won', 'lost') and closed_at is null)::integer as open_closed,
         count(*) filter (where stage not in ('won', 'lost') and closed_at is not null)::integer as closed_open,
         count(*) filter (where stage = 'lost' and lost_reason is null)::integer as lost_without_detail
       from public.crm_opportunities where organization_id = $1`,
      [org],
    );
    expect(closed.rows[0]).toEqual({ open_closed: 0, closed_open: 0, lost_without_detail: 0 });

    // One spot check that the trigger history reads as the story: the
    // Whitfield account walked lead → prospect → customer → inactive.
    const journey = await db.query<{ summary: string }>(
      `select events.summary
         from public.crm_timeline_events events
         join public.crm_accounts accounts
           on accounts.id = events.account_id
        where accounts.name = 'The Whitfield Bungalow'
          and events.kind = 'status_change'
          and events.summary like 'Status changed%'
        order by events.recorded_at`,
    );
    expect(journey.rows.map((row) => row.summary)).toEqual([
      "Status changed: lead → prospect.",
      "Status changed: prospect → customer.",
      "Status changed: customer → inactive.",
    ]);
  });
});
