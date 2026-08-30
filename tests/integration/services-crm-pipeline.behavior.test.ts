// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830000900_full_lifecycle_typed_input_identity.sql";

/**
 * CRM increment 2 (ADR-186) against the real migration chain: the pipeline's
 * promises are schema promises. Stage moves writing themselves to the
 * timeline is a trigger, closed_at agreeing with the stage is a trigger plus
 * a CHECK, a loss reason only existing on a loss is a CHECK, duplicate
 * detection's normalization is a generated column, and the undeletable
 * conversion record is a missing grant. Every test here would pass against a
 * mock while production lied.
 */

const acmeOwner = "00000000-0000-4000-8000-0000000d0001";
const rivalOwner = "00000000-0000-4000-8000-0000000d0002";
const acmeOrg = "10000000-0000-4000-8000-0000000d0001";
const rivalOrg = "10000000-0000-4000-8000-0000000d0002";

describe("the Services CRM pipeline", { timeout: 240_000 }, () => {
  let db: PGlite;

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function reset() {
    await db.exec("reset role");
  }

  async function createAccount(name: string, email: string | null = null, phone: string | null = null) {
    const result = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, email, phone, created_by)
       values ($1, $2, 'commercial', $3, $4, $5) returning id`,
      [acmeOrg, name, email, phone, acmeOwner],
    );
    return result.rows[0].id;
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
      // Hosted-style default privileges, flipped on just before the CRM
      // window (the 20260830000600 lesson): every CRM table is created
      // under GRANT ALL defaults here exactly as it was on hosted, so an
      // immutability claim that relies on the ABSENCE of a grant fails
      // locally if a migration forgets to revoke the default.
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
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("writes every stage move onto the account timeline, and keeps closed_at truthful", async () => {
    await as(acmeOwner);
    const accountId = await createAccount("Harborview Foods");
    const created = await db.query<{ id: string; stage: string; closed_at: string | null }>(
      `insert into public.crm_opportunities (organization_id, account_id, name, value_cents, created_by)
       values ($1, $2, 'Quarterly IPM program', 240000, $3)
       returning id, stage::text, closed_at`,
      [acmeOrg, accountId, acmeOwner],
    );
    const opportunityId = created.rows[0].id;
    expect(created.rows[0].stage).toBe("new");
    expect(created.rows[0].closed_at).toBeNull();

    await db.query("update public.crm_opportunities set stage = 'proposal' where id = $1", [opportunityId]);
    const won = await db.query<{ closed_at: string | null }>(
      "update public.crm_opportunities set stage = 'won' where id = $1 returning closed_at",
      [opportunityId],
    );
    expect(won.rows[0].closed_at).not.toBeNull();

    const trail = await db.query<{ summary: string; actor_user_id: string | null }>(
      `select summary, actor_user_id from public.crm_timeline_events
        where account_id = $1 and kind = 'status_change' order by recorded_at`,
      [accountId],
    );
    expect(trail.rows).toEqual([
      { summary: 'Opportunity "Quarterly IPM program": new → proposal.', actor_user_id: acmeOwner },
      { summary: 'Opportunity "Quarterly IPM program": proposal → won.', actor_user_id: acmeOwner },
    ]);

    // A value edit is not a move: no history noise, closed_at untouched.
    const edited = await db.query<{ closed_at: string | null }>(
      "update public.crm_opportunities set value_cents = 250000 where id = $1 returning closed_at",
      [opportunityId],
    );
    expect(edited.rows[0].closed_at).not.toBeNull();
    const after = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.crm_timeline_events
        where account_id = $1 and kind = 'status_change'`,
      [accountId],
    );
    expect(after.rows[0].count).toBe(2);

    // Reopening clears closed_at in the same statement that moves the stage.
    const reopened = await db.query<{ closed_at: string | null }>(
      "update public.crm_opportunities set stage = 'negotiation' where id = $1 returning closed_at",
      [opportunityId],
    );
    expect(reopened.rows[0].closed_at).toBeNull();
    await reset();
  });

  it("keeps the loss reason honest: only on a lost deal, carried into history detail", async () => {
    await as(acmeOwner);
    const accountId = await createAccount("Reason Proof LLC");
    const created = await db.query<{ id: string }>(
      `insert into public.crm_opportunities (organization_id, account_id, name, created_by)
       values ($1, $2, 'One-time treatment', $3) returning id`,
      [acmeOrg, accountId, acmeOwner],
    );
    const opportunityId = created.rows[0].id;

    // A reason on an open deal contradicts the CHECK.
    await expect(db.query(
      "update public.crm_opportunities set lost_reason = 'Too expensive' where id = $1",
      [opportunityId],
    )).rejects.toThrow(/crm_opportunities_lost_reason_only_lost/);

    await db.query(
      "update public.crm_opportunities set stage = 'lost', lost_reason = 'Went with another provider' where id = $1",
      [opportunityId],
    );
    const trail = await db.query<{ summary: string; detail: string | null }>(
      `select summary, detail from public.crm_timeline_events
        where account_id = $1 and kind = 'status_change'`,
      [accountId],
    );
    expect(trail.rows).toEqual([
      {
        summary: 'Opportunity "One-time treatment": new → lost.',
        detail: "Went with another provider",
      },
    ]);
    await reset();
  });

  it("computes duplicate-detection normals in the database, the same way the route does", async () => {
    await as(acmeOwner);
    await createAccount("Harborview-Foods, LLC!", "  Ops@Harborview.example ", "+1 (555) 010-0100");
    const normals = await db.query<{ name_normal: string; email_normal: string; phone_normal: string }>(
      `select name_normal, email_normal, phone_normal from public.crm_accounts
        where organization_id = $1 and name = 'Harborview-Foods, LLC!'`,
      [acmeOrg],
    );
    // Exactly what lib/services/crm.ts normalizeAccount* produce for the
    // same inputs — the probe side and the stored side must agree or
    // detection silently goes blind.
    expect(normals.rows).toEqual([
      {
        name_normal: "harborviewfoodsllc",
        email_normal: "ops@harborview.example",
        phone_normal: "15550100100",
      },
    ]);

    // Two respellings of one name land on one normal — the equality the
    // duplicate probe runs on.
    await createAccount("Coastal Bait & Trap Co.");
    await createAccount("COASTAL bait-trap co");
    const respelled = await db.query<{ count: number }>(
      `select count(distinct name_normal)::integer as count from public.crm_accounts
        where organization_id = $1 and name in ('Coastal Bait & Trap Co.', 'COASTAL bait-trap co')`,
      [acmeOrg],
    );
    expect(respelled.rows[0].count).toBe(1);
    await reset();
  });

  it("keeps tenants apart and the conversion record undeletable", async () => {
    await as(acmeOwner);
    const accountId = await createAccount("Isolation Pipeline LLC");
    const created = await db.query<{ id: string }>(
      `insert into public.crm_opportunities (organization_id, account_id, name, created_by)
       values ($1, $2, 'Annual contract', $3) returning id`,
      [acmeOrg, accountId, acmeOwner],
    );
    const opportunityId = created.rows[0].id;

    // No DELETE grant: a dead deal is marked lost, never erased out of the
    // win-rate denominator.
    await expect(db.query(
      "delete from public.crm_opportunities where id = $1",
      [opportunityId],
    )).rejects.toThrow(/permission denied/);
    await reset();

    await as(rivalOwner);
    const seen = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.crm_opportunities where organization_id = $1",
      [acmeOrg],
    );
    expect(seen.rows[0].count).toBe(0);
    // The composite FK: a rival cannot hang an opportunity in THEIR org off
    // an Acme account they cannot see.
    await expect(db.query(
      `insert into public.crm_opportunities (organization_id, account_id, name, created_by)
       values ($1, $2, 'Forged deal', $3)`,
      [rivalOrg, accountId, rivalOwner],
    )).rejects.toThrow(/foreign key|not present/i);
    await reset();
  });

  it("shuts anon and service_role out of the pipeline entirely", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");
    await expect(db.query("select count(*) from public.crm_opportunities"))
      .rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    await db.exec("set role service_role");
    await expect(db.query("select count(*) from public.crm_opportunities"))
      .rejects.toThrow(/permission denied/);
    await reset();
  });
});
