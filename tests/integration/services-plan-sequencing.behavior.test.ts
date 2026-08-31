// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "../support/latest-migration";
import { planOccurrences, type PlanStep } from "@/lib/services/plan-sequence";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

/**
 * Plan sequencing (ADR-211) against the real migration chain.
 *
 * A recurrence says how often. A schedule says when — and a customer who
 * bought "the 1st and the 15th" bought dates, not a cadence. Every test
 * here is about that gap, and about the two things sequencing must never
 * be allowed to do: move a customer's dates on its own, or change what
 * they are billed.
 */

const acmeOwner = "00000000-0000-4000-8000-000000011001";
const rivalOwner = "00000000-0000-4000-8000-000000011002";
const acmeOrg = "10000000-0000-4000-8000-000000011001";
const rivalOrg = "10000000-0000-4000-8000-000000011002";

describe("plan sequencing", { timeout: 240_000 }, () => {
  let db: PGlite;

  let twiceMonthly = "";
  let seasonal = "";
  let unsequenced = "";
  let rivalPlan = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function newPlan(
    organization: string,
    owner: string,
    account: string,
    property: string,
    serviceType: string,
    recurrence: string,
    cycleMonths: number | null,
  ) {
    const created = await db.query<{ id: string }>(
      `insert into public.crm_service_plans
         (organization_id, account_id, property_id, service_type, recurrence,
          next_due, cycle_months, created_by)
       values ($1, $2, $3, $4, $5::public.crm_service_recurrence, '2026-01-01', $6, $7)
       returning id`,
      [organization, account, property, serviceType, recurrence, cycleMonths, owner],
    );
    return created.rows[0].id;
  }

  async function addStep(
    organization: string,
    owner: string,
    plan: string,
    position: number,
    monthOffset: number,
    anchor: "day_of_month" | "nth_weekday",
    dayOfMonth: number | null,
    weekOfMonth: number | null,
    weekday: number | null,
    serviceType: string | null = null,
  ) {
    await db.query(
      `insert into public.crm_plan_steps
         (organization_id, plan_id, position, month_offset, anchor,
          day_of_month, week_of_month, weekday, service_type, created_by)
       values ($1, $2, $3, $4, $5::public.crm_plan_step_anchor, $6, $7, $8, $9, $10)`,
      [organization, plan, position, monthOffset, anchor,
        dayOfMonth, weekOfMonth, weekday, serviceType, owner],
    );
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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-sequence', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-sequence', '${rivalOwner}');
    `);

    await as(acmeOwner);
    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const site = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Plant', '4100 Cannery Row') returning id`,
      [acmeOrg, account.rows[0].id],
    );

    twiceMonthly = await newPlan(
      acmeOrg, acmeOwner, account.rows[0].id, site.rows[0].id,
      "General pest", "monthly", 1,
    );
    await addStep(acmeOrg, acmeOwner, twiceMonthly, 1, 0, "day_of_month", 1, null, null);
    await addStep(acmeOrg, acmeOwner, twiceMonthly, 2, 0, "day_of_month", 15, null, null);

    seasonal = await newPlan(
      acmeOrg, acmeOwner, account.rows[0].id, site.rows[0].id,
      "Seasonal program", "monthly", 12,
    );
    await addStep(acmeOrg, acmeOwner, seasonal, 1, 2, "nth_weekday", null, 2, 1, "perimeter");
    await addStep(acmeOrg, acmeOwner, seasonal, 2, 5, "nth_weekday", null, 2, 1, "mosquito");
    await addStep(acmeOrg, acmeOwner, seasonal, 3, 8, "nth_weekday", null, 2, 1, "rodent");
    await addStep(acmeOrg, acmeOwner, seasonal, 4, 10, "nth_weekday", null, 2, 1, "winterization");

    unsequenced = await newPlan(
      acmeOrg, acmeOwner, account.rows[0].id, site.rows[0].id,
      "Quarterly IPM", "quarterly", null,
    );

    await as(rivalOwner);
    const rivalAccount = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Rival Diner', 'commercial', 'customer', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    const rivalSite = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Rival Diner', '9 Elm') returning id`,
      [rivalOrg, rivalAccount.rows[0].id],
    );
    rivalPlan = await newPlan(
      rivalOrg, rivalOwner, rivalAccount.rows[0].id, rivalSite.rows[0].id,
      "General pest", "monthly", 1,
    );
    await addStep(rivalOrg, rivalOwner, rivalPlan, 1, 0, "day_of_month", 7, null, null);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("puts a twice-monthly account on the days it was sold, for a whole year", async () => {
    await as(acmeOwner);
    const visits = await db.query<{ occurs_on: string; service_type: string }>(
      "select occurs_on::text, service_type from public.crm_plan_occurrences($1, '2026-01-01', 24)",
      [twiceMonthly],
    );

    expect(visits.rows).toHaveLength(24);
    expect(visits.rows.every((row) => /-(01|15)$/.test(row.occurs_on))).toBe(true);
    expect(visits.rows.at(-1)?.occurs_on).toBe("2026-12-15");
    // No step named a service, so every visit is the plan's own.
    expect(new Set(visits.rows.map((row) => row.service_type))).toEqual(new Set(["General pest"]));
  });

  it("keeps a seasonal program in its months and names each visit", async () => {
    await as(acmeOwner);
    const visits = await db.query<{ occurs_on: string; service_type: string }>(
      "select occurs_on::text, service_type from public.crm_plan_occurrences($1, '2026-01-01', 5)",
      [seasonal],
    );

    expect(visits.rows.map((row) => row.occurs_on.slice(0, 7)))
      .toEqual(["2026-03", "2026-06", "2026-09", "2026-11", "2027-03"]);
    expect(visits.rows.map((row) => row.service_type))
      .toEqual(["perimeter", "mosquito", "rodent", "winterization", "perimeter"]);
  });

  it("answers nothing at all for a plan nobody sequenced, rather than inventing a date", async () => {
    await as(acmeOwner);
    const visits = await db.query(
      "select * from public.crm_plan_occurrences($1, '2026-01-01', 6)", [unsequenced],
    );
    const next = await db.query<{ next: string | null }>(
      "select public.crm_plan_next_occurrence($1, '2026-01-01') as next", [unsequenced],
    );

    expect(visits.rows).toEqual([]);
    expect(next.rows[0].next).toBeNull();
  });

  it("moves strictly forward, so generating a visit cannot produce the same date twice", async () => {
    await as(acmeOwner);
    const first = await db.query<{ next: string }>(
      "select public.crm_plan_next_occurrence($1, '2026-01-01')::text as next", [twiceMonthly],
    );
    const second = await db.query<{ next: string }>(
      "select public.crm_plan_next_occurrence($1, $2)::text as next",
      [twiceMonthly, first.rows[0].next],
    );

    expect(first.rows[0].next).toBe("2026-01-15");
    expect(second.rows[0].next).toBe("2026-02-01");
  });

  it("agrees with the browser preview, date for date, over three years", async () => {
    await as(acmeOwner);
    const rows = await db.query<{
      position: number; month_offset: number; anchor: "day_of_month" | "nth_weekday";
      day_of_month: number | null; week_of_month: number | null; weekday: number | null;
      service_type: string | null;
    }>(
      `select position, month_offset, anchor, day_of_month, week_of_month, weekday, service_type
         from public.crm_plan_steps where plan_id = $1 order by position`,
      [seasonal],
    );
    const steps: PlanStep[] = rows.rows.map((row) => ({
      position: row.position,
      monthOffset: row.month_offset,
      anchor: row.anchor,
      dayOfMonth: row.day_of_month,
      weekOfMonth: row.week_of_month,
      weekday: row.weekday,
      serviceType: row.service_type,
    }));

    const database = await db.query<{ occurs_on: string }>(
      "select occurs_on::text from public.crm_plan_occurrences($1, '2026-01-01', 12)",
      [seasonal],
    );

    expect(planOccurrences(steps, 12, "2026-01-01", 12).map((visit) => visit.occursOn))
      .toEqual(database.rows.map((row) => row.occurs_on));
  });

  it("reports visits and bills side by side, because level billing is a sale not a fault", async () => {
    await as(acmeOwner);
    const twice = await db.query<{ sequenced: boolean; visits_per_year: string; bills_per_year: string }>(
      "select * from public.crm_plan_cadence($1)", [twiceMonthly],
    );
    const season = await db.query<{ sequenced: boolean; visits_per_year: string; bills_per_year: string }>(
      "select * from public.crm_plan_cadence($1)", [seasonal],
    );
    const plain = await db.query<{ sequenced: boolean; visits_per_year: string | null }>(
      "select * from public.crm_plan_cadence($1)", [unsequenced],
    );

    expect(Number(twice.rows[0].visits_per_year)).toBe(24);
    expect(Number(twice.rows[0].bills_per_year)).toBe(12);
    // Four visits, twelve bills: pay monthly, serviced seasonally.
    expect(Number(season.rows[0].visits_per_year)).toBe(4);
    expect(Number(season.rows[0].bills_per_year)).toBe(12);
    expect(plain.rows[0].sequenced).toBe(false);
    expect(plain.rows[0].visits_per_year).toBeNull();
  });

  it("refuses a step that falls outside its plan's cycle", async () => {
    await as(acmeOwner);
    await expect(
      addStep(acmeOrg, acmeOwner, twiceMonthly, 3, 4, "day_of_month", 20, null, null),
    ).rejects.toThrow(/outside a 1 month cycle/);
  });

  it("refuses a step on a plan that has no cycle at all", async () => {
    await as(acmeOwner);
    await expect(
      addStep(acmeOrg, acmeOwner, unsequenced, 1, 0, "day_of_month", 3, null, null),
    ).rejects.toThrow(/no cycle length/);
  });

  it("will not let the cycle be cleared out from under existing steps", async () => {
    // PostgREST is a door: a member can PATCH the plan directly, so the
    // guard cannot live only in a function nobody is forced to call.
    await as(acmeOwner);
    await expect(
      db.query("update public.crm_service_plans set cycle_months = null where id = $1", [seasonal]),
    ).rejects.toThrow(/clear them before clearing the cycle/);
  });

  it("will not let the cycle shrink past a step it would strand", async () => {
    await as(acmeOwner);
    await expect(
      db.query("update public.crm_service_plans set cycle_months = 6 where id = $1", [seasonal]),
    ).rejects.toThrow(/a 6 month cycle does not reach/);
  });

  it("refuses a step carrying both anchors, so no generator ever has to choose", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_plan_steps
           (organization_id, plan_id, position, month_offset, anchor,
            day_of_month, week_of_month, weekday, created_by)
         values ($1, $2, 9, 0, 'day_of_month', 15, 2, 1, $3)`,
        [acmeOrg, twiceMonthly, acmeOwner],
      ),
    ).rejects.toThrow(/crm_plan_steps_anchor_complete/);
  });

  it("keeps one book's schedule out of another's", async () => {
    await as(rivalOwner);
    const foreign = await db.query(
      "select id from public.crm_plan_steps where plan_id = $1", [twiceMonthly],
    );
    const generated = await db.query(
      "select * from public.crm_plan_occurrences($1, '2026-01-01', 4)", [twiceMonthly],
    );

    expect(foreign.rows).toEqual([]);
    // The generator is an invoker, so a plan the caller cannot select
    // produces no dates rather than leaking somebody else's calendar.
    expect(generated.rows).toEqual([]);
  });

  it("leaves every sequencing function an invoker", async () => {
    await db.exec("reset role");
    const definers = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.proname in ('crm_plan_occurrences', 'crm_plan_next_occurrence',
                            'crm_plan_cadence', 'crm_plan_step_date')`,
    );

    expect(definers.rows).toEqual([]);
  });

  it("does not change what anybody is billed", async () => {
    // Sequencing moves visits. The recurrence still decides the billing
    // period, and this is the assertion that keeps the two apart.
    await db.exec("reset role");
    const period = await db.query<{ interval: string }>(
      `select public.crm_recurrence_interval(recurrence)::text as interval
         from public.crm_service_plans where id = $1`,
      [seasonal],
    );

    expect(period.rows[0].interval).toBe("1 mon");
  });
});
