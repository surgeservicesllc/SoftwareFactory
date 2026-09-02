// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "../support/latest-migration";
import { SCORING_DEFAULTS } from "@/lib/services/scoring";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

/**
 * Explainable scoring and assignment with its reason (ADR-229) against the
 * real chain. Replays with hosted-like default privileges so the grant
 * assertions mean something.
 *
 * What the increment promises: a score is a sum of named rules and every
 * point comes with the fact that earned it; the defaults in code and in
 * the database are the same list; an override changes the score and
 * deleting it restores the default; the engine scores only what the
 * caller could open; and an account is assigned by the postal code in its
 * address with a history line saying so.
 */

const acmeOwner = "00000000-0000-4000-8000-000000029001";
const rivalOwner = "00000000-0000-4000-8000-000000029002";
const acmeOrg = "10000000-0000-4000-8000-000000029001";
const rivalOrg = "10000000-0000-4000-8000-000000029002";

type ScoreRow = { account_id: string; score: number; breakdown: Array<{ rule: string; points: number; fact: string }> };

describe("explainable scoring and assignment", { timeout: 240_000 }, () => {
  let db: PGlite;
  let branch = "";
  let rep = "";
  let territory = "";
  let warmLead = "";
  let riskyCustomer = "";
  let upsellCustomer = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function scores(model: string, org = acmeOrg): Promise<ScoreRow[]> {
    const read = await db.query<ScoreRow>(
      "select account_id, score, breakdown from public.crm_score_accounts($1, $2::public.crm_scoring_model)",
      [org, model],
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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-scoring', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-scoring', '${rivalOwner}');
    `);

    await as(acmeOwner);
    branch = (await db.query<{ id: string }>(
      `insert into public.crm_branches (organization_id, name, code, created_by)
       values ($1, 'Harbor depot', 'HRB', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    const role = (await db.query<{ role: string }>(
      "select (enum_range(null::public.crm_employee_role))[1]::text as role",
    )).rows[0].role;
    rep = (await db.query<{ id: string }>(
      `insert into public.crm_employees (organization_id, branch_id, employee_code, first_name, role, created_by)
       values ($1, $2, 'R1', 'Ada', $3::public.crm_employee_role, $4) returning id`,
      [acmeOrg, branch, role, acmeOwner],
    )).rows[0].id;
    territory = (await db.query<{ id: string }>(
      `insert into public.crm_territories
         (organization_id, branch_id, rep_id, code, name, postal_codes, created_by)
       values ($1, $2, $3, 'HRB-N', 'Harbor north', array['93940', '93943'], $4) returning id`,
      [acmeOrg, branch, rep, acmeOwner],
    )).rows[0].id;

    // A warm lead: email, source, commercial, two locations, a $2,500 deal,
    // an estimate out, and nothing recorded on its history.
    warmLead = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, email, source, created_by)
       values ($1, 'Ridgeway Bakery', 'commercial', 'lead', 'owner@ridgeway.example', 'Referral', $2)
       returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    for (const label of ["Bakery", "Warehouse"]) {
      await db.query(
        `insert into public.crm_properties (organization_id, account_id, label, address)
         values ($1, $2, $3, '1 Loaf Lane')`,
        [acmeOrg, warmLead, label],
      );
    }
    await db.query(
      `insert into public.crm_opportunities (organization_id, account_id, name, stage, value_cents, created_by)
       values ($1, $2, 'Bakery contract', 'proposal', 250000, $3)`,
      [acmeOrg, warmLead, acmeOwner],
    );
    await db.query(
      `insert into public.crm_estimates (organization_id, account_id, number, status, sent_at, created_by)
       values ($1, $2, 'EST-1', 'sent', now() - interval '2 days', $3)`,
      [acmeOrg, warmLead, acmeOwner],
    );

    // A customer at risk: an active plan 30 days past due with no visit
    // ever completed, an overdue invoice, and silence.
    riskyCustomer = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    const riskyProperty = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Plant', '4100 Cannery Row') returning id`,
      [acmeOrg, riskyCustomer],
    )).rows[0].id;
    const recurrence = (await db.query<{ recurrence: string }>(
      "select (enum_range(null::public.crm_service_recurrence))[1]::text as recurrence",
    )).rows[0].recurrence;
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due, active, created_by)
       values ($1, $2, $3, 'Monthly IPM', $4::public.crm_service_recurrence, current_date - 30, true, $5)`,
      [acmeOrg, riskyCustomer, riskyProperty, recurrence, acmeOwner],
    );
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, issued_on, due_on, created_by)
       values ($1, $2, 'INV-9', 'open', 48600, 0, 48600, current_date - 40, current_date - 10, $3)`,
      [acmeOrg, riskyCustomer, acmeOwner],
    );

    // A customer with room to grow: two locations, one with no plan and a
    // sighting there, no WDO ever issued.
    upsellCustomer = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Maple Street Homes', 'residential', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    const covered = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Main house', '12 Maple St') returning id`,
      [acmeOrg, upsellCustomer],
    )).rows[0].id;
    const uncovered = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Guest cottage', '12A Maple St') returning id`,
      [acmeOrg, upsellCustomer],
    )).rows[0].id;
    await db.query(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence, next_due, active, created_by)
       values ($1, $2, $3, 'Quarterly perimeter', $4::public.crm_service_recurrence, current_date + 20, true, $5)`,
      [acmeOrg, upsellCustomer, covered, recurrence, acmeOwner],
    );
    await db.query(
      `insert into public.crm_pest_sightings
         (organization_id, account_id, property_id, pest, severity, corrective_action, corrected_at, created_by)
       values ($1, $2, $3, 'Carpenter ant', 'moderate', 'Bait placed', now(), $4)`,
      [acmeOrg, upsellCustomer, uncovered, acmeOwner],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it("keeps the defaults in code and in the database the same list", async () => {
    await as(acmeOwner);
    const read = await db.query<{ model: string; rule_key: string; label: string; points: number }>(
      "select model::text, rule_key, label, points from public.crm_scoring_defaults() order by model, rule_key",
    );
    const fromCode = [...SCORING_DEFAULTS]
      .map((rule) => ({ model: rule.model, rule_key: rule.ruleKey, label: rule.label, points: rule.points }))
      .sort((a, b) => (a.model + a.rule_key).localeCompare(b.model + b.rule_key));
    expect(read.rows).toEqual(fromCode);
    expect(read.rows).toHaveLength(27);
  });

  it("holds the grant posture: overrides are the member's working configuration", async () => {
    await db.exec("reset role");
    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'crm_scoring_rules'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
        order by 1, 2`,
    );
    expect(grants.rows).toEqual([
      { grantee: "authenticated", privilege_type: "DELETE" },
      { grantee: "authenticated", privilege_type: "INSERT" },
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "authenticated", privilege_type: "UPDATE" },
    ]);
  });

  it("scores a lead as the sum of the rules that apply, each with its fact", async () => {
    await as(acmeOwner);
    const rows = await scores("lead");
    const lead = rows.find((row) => row.account_id === warmLead);
    expect(lead).toBeDefined();
    // has_email 10 + source 5 + commercial 15 + 2 locations 10 + open deal 10
    // + deal value 10 + estimate sent 15 + silent 30d −10 = 65.
    expect(lead!.score).toBe(65);
    const facts = Object.fromEntries(lead!.breakdown.map((line) => [line.rule, line]));
    expect(facts.service_locations).toMatchObject({ points: 10, fact: "2 service locations on file" });
    expect(facts.opportunity_value).toMatchObject({ points: 10, fact: "An open opportunity worth $2,500.00" });
    expect(facts.source_recorded).toMatchObject({ points: 5, fact: "Source: Referral" });
    expect(facts.silent_30d).toMatchObject({ points: -10, fact: "No activity ever recorded" });
    expect(facts.has_phone).toBeUndefined();
    // Customers are not leads: the lead model does not score them.
    expect(rows.map((row) => row.account_id)).not.toContain(riskyCustomer);
  });

  it("scores churn risk from missed service, money owed and silence", async () => {
    await as(acmeOwner);
    const rows = await scores("churn");
    const risky = rows.find((row) => row.account_id === riskyCustomer);
    // visit_overdue 25 + no_visit_90d 20 + overdue_invoice 20 + silent_90d 10.
    expect(risky?.score).toBe(75);
    const facts = Object.fromEntries((risky?.breakdown ?? []).map((line) => [line.rule, line.fact]));
    expect(facts.visit_overdue).toBe("An active plan is 30 days past due");
    expect(facts.overdue_invoice).toBe("$486.00 past due");
    expect(facts.no_visit_90d).toBe("An active plan with no completed visit on record");
    // The customer whose plan is in good standing still scores on silence
    // and on never having had a completed visit — both true, both said.
    const calm = rows.find((row) => row.account_id === upsellCustomer);
    expect(calm?.score).toBe(30);
    expect((calm?.breakdown ?? []).map((line) => line.rule).sort()).toEqual(["no_visit_90d", "silent_90d"]);
  });

  it("scores upsell from gaps in coverage", async () => {
    await as(acmeOwner);
    const rows = await scores("upsell");
    const room = rows.find((row) => row.account_id === upsellCustomer);
    // location_without_plan 20 + sighting_without_plan 25 + wdo_stale 15.
    expect(room?.score).toBe(60);
    const facts = Object.fromEntries((room?.breakdown ?? []).map((line) => [line.rule, line.fact]));
    expect(facts.location_without_plan).toBe("1 of 2 locations has no active plan");
    expect(facts.sighting_without_plan).toBe("1 sighting (Carpenter ant) at a location with no active plan");
    expect(facts.wdo_stale).toBe("No WDO inspection has been issued");
    // Ordered highest first.
    expect(rows[0].account_id).toBe(upsellCustomer);
  });

  it("lets an override change the score, refuses an unknown rule, and resets on delete", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_scoring_rules (organization_id, model, rule_key, points, created_by)
       values ($1, 'lead', 'commercial', 30, $2)`,
      [acmeOrg, acmeOwner],
    );
    expect((await scores("lead")).find((row) => row.account_id === warmLead)?.score).toBe(80);

    await db.query(
      `insert into public.crm_scoring_rules (organization_id, model, rule_key, points, active, created_by)
       values ($1, 'lead', 'silent_30d', -10, false, $2)`,
      [acmeOrg, acmeOwner],
    );
    expect((await scores("lead")).find((row) => row.account_id === warmLead)?.score).toBe(90);

    const effective = await db.query<{ rule_key: string; points: number; overridden: boolean; active: boolean }>(
      `select rule_key, points, overridden, active from public.crm_effective_scoring_rules($1, 'lead')
        where rule_key in ('commercial', 'silent_30d', 'has_email') order by rule_key`,
      [acmeOrg],
    );
    expect(effective.rows).toEqual([
      { rule_key: "commercial", points: 30, overridden: true, active: true },
      { rule_key: "has_email", points: 10, overridden: false, active: true },
      { rule_key: "silent_30d", points: -10, overridden: true, active: false },
    ]);

    const unknown = await rejects(() =>
      db.query(
        `insert into public.crm_scoring_rules (organization_id, model, rule_key, points, created_by)
         values ($1, 'lead', 'vibes', 50, $2)`,
        [acmeOrg, acmeOwner],
      ));
    expect(unknown).toMatch(/no rule vibes in the lead model/);

    await db.query("delete from public.crm_scoring_rules where organization_id = $1", [acmeOrg]);
    expect((await scores("lead")).find((row) => row.account_id === warmLead)?.score).toBe(65);
  });

  it("scores nothing for a rival organization", async () => {
    await as(rivalOwner);
    expect(await scores("lead")).toEqual([]);
    expect(await scores("churn")).toEqual([]);
  });

  it("assigns a new account by the last postal code in its address, and says so on its history", async () => {
    await as(acmeOwner);
    const created = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, billing_address, created_by)
       values ($1, 'Cannery Deli', 'commercial', 'lead', 'Suite 1200, 4100 Cannery Row, Monterey CA 93940', $2)
       returning id`,
      [acmeOrg, acmeOwner],
    );
    const account = created.rows[0].id;
    const assigned = await db.query<{ territory_id: string | null; branch_id: string | null; owner_employee_id: string | null }>(
      "select territory_id, branch_id, owner_employee_id from public.crm_accounts where id = $1",
      [account],
    );
    expect(assigned.rows[0]).toEqual({ territory_id: territory, branch_id: branch, owner_employee_id: rep });

    const history = await db.query<{ kind: string; summary: string }>(
      `select kind::text, summary from public.crm_timeline_events
        where organization_id = $1 and account_id = $2 and kind = 'note'`,
      [acmeOrg, account],
    );
    expect(history.rows).toEqual([
      { kind: "note", summary: "Assigned to territory Harbor north (HRB-N) by postal code 93940." },
    ]);
  });

  it("leaves an address outside every territory alone, and the backfill picks it up once coverage grows", async () => {
    await as(acmeOwner);
    const created = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, billing_address, created_by)
       values ($1, 'Uptown Bakery', 'commercial', 'lead', '9 High St, New York NY 10001', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const account = created.rows[0].id;
    const before = await db.query<{ territory_id: string | null }>(
      "select territory_id from public.crm_accounts where id = $1", [account],
    );
    expect(before.rows[0].territory_id).toBeNull();

    const nothing = await db.query<{ n: number }>(
      "select public.crm_assign_accounts_by_postal($1) as n", [acmeOrg],
    );
    expect(Number(nothing.rows[0].n)).toBe(0);

    await db.query(
      "update public.crm_territories set postal_codes = postal_codes || array['10001'] where id = $1",
      [territory],
    );
    const assigned = await db.query<{ n: number }>(
      "select public.crm_assign_accounts_by_postal($1) as n", [acmeOrg],
    );
    expect(Number(assigned.rows[0].n)).toBe(1);
    const after = await db.query<{ territory_id: string | null; owner_employee_id: string | null }>(
      "select territory_id, owner_employee_id from public.crm_accounts where id = $1", [account],
    );
    expect(after.rows[0]).toEqual({ territory_id: territory, owner_employee_id: rep });
  });

  it("never overrides a territory somebody chose on purpose", async () => {
    await as(acmeOwner);
    const other = (await db.query<{ id: string }>(
      `insert into public.crm_territories
         (organization_id, branch_id, code, name, postal_codes, created_by)
       values ($1, $2, 'HRB-S', 'Harbor south', array['93940'], $3) returning id`,
      [acmeOrg, branch, acmeOwner],
    )).rows[0].id;
    const created = await db.query<{ territory_id: string }>(
      `insert into public.crm_accounts
         (organization_id, name, kind, status, billing_address, territory_id, created_by)
       values ($1, 'Chosen Ltd', 'commercial', 'lead', 'Monterey 93940', $2, $3) returning territory_id`,
      [acmeOrg, other, acmeOwner],
    );
    expect(created.rows[0].territory_id).toBe(other);
  });
});
