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
 * Branches, the org chart, territories and commissions (ADR-195) against
 * the real migration chain.
 *
 * The company is where a CRM most often lies to itself: a branch marked
 * open that closed last year, a person reporting to themselves through
 * three hops of bad data, a commission whose payout does not match its own
 * rate. Each of those is refused here by the database, under hosted-style
 * default privileges, so no route and no later migration can grant its way
 * past them.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000d001";
const rivalOwner = "00000000-0000-4000-8000-00000000d002";
const acmeOrg = "10000000-0000-4000-8000-00000000d001";
const rivalOrg = "10000000-0000-4000-8000-00000000d002";

describe("branches, the org chart and the sales motion", { timeout: 240_000 }, () => {
  let db: PGlite;
  let branchId = "";
  let managerId = "";
  let repId = "";
  let accountId = "";

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
      // Hosted grants ALL on every new table by default, so the CRM chain is
      // replayed under that posture: a capability expressed as the ABSENCE
      // of a grant only means something if the default was there to revoke.
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

    await as(acmeOwner);
    const branch = await db.query<{ id: string }>(
      `insert into public.crm_branches (organization_id, code, name, time_zone, opened_on, created_by)
       values ($1, 'BR-NORTH', 'North Branch', 'America/Denver', current_date - 900, $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    branchId = branch.rows[0].id;

    const manager = await db.query<{ id: string }>(
      `insert into public.crm_employees
         (organization_id, branch_id, employee_code, first_name, last_name, role, commission_bps, created_by)
       values ($1, $2, 'EMP-1', 'Rosa', 'Ibarra', 'branch_manager', 500, $3) returning id`,
      [acmeOrg, branchId, acmeOwner],
    );
    managerId = manager.rows[0].id;

    const rep = await db.query<{ id: string }>(
      `insert into public.crm_employees
         (organization_id, branch_id, reports_to_id, employee_code, first_name, last_name,
          role, commission_bps, monthly_quota_cents, created_by)
       values ($1, $2, $3, 'EMP-2', 'Dev', 'Okafor', 'sales_rep', 750, 4000000, $4) returning id`,
      [acmeOrg, branchId, managerId, acmeOwner],
    );
    repId = rep.rows[0].id;

    await db.query(
      "update public.crm_branches set manager_id = $1 where id = $2",
      [managerId, branchId],
    );

    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts
         (organization_id, name, kind, branch_id, owner_employee_id, created_by)
       values ($1, 'Harborview Foods', 'commercial', $2, $3, $4) returning id`,
      [acmeOrg, branchId, repId, acmeOwner],
    );
    accountId = account.rows[0].id;
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("holds the company together: a branch, its manager, a rep who reports to them, and the book they serve", async () => {
    await as(acmeOwner);
    const { rows } = await db.query<{
      branch: string;
      manager: string;
      rep: string;
      supervisor: string;
    }>(
      `select b.name as branch,
              m.first_name as manager,
              r.first_name as rep,
              s.first_name as supervisor
         from public.crm_accounts a
         join public.crm_branches b on b.id = a.branch_id
         join public.crm_employees m on m.id = b.manager_id
         join public.crm_employees r on r.id = a.owner_employee_id
         join public.crm_employees s on s.id = r.reports_to_id
        where a.id = $1`,
      [accountId],
    );
    expect(rows[0]).toEqual({
      branch: "North Branch",
      manager: "Rosa",
      rep: "Dev",
      supervisor: "Rosa",
    });
    await reset();
  });

  it("derives a commission from its basis and its rate, never from the caller", async () => {
    await as(acmeOwner);
    const opportunity = await db.query<{ id: string }>(
      `insert into public.crm_opportunities
         (organization_id, account_id, name, stage, value_cents, owner_employee_id, closed_at, created_by)
       values ($1, $2, 'Annual commercial program', 'won', 1200000, $3, now(), $4) returning id`,
      [acmeOrg, accountId, repId, acmeOwner],
    );

    // The caller asserts a payout of one dollar. The trigger overwrites it
    // with the arithmetic: 7.5% of $12,000 is $900.
    const recorded = await db.query<{ amount_cents: string }>(
      `insert into public.crm_commissions
         (organization_id, employee_id, opportunity_id, basis_cents, rate_bps, amount_cents, earned_on, created_by)
       values ($1, $2, $3, 1200000, 750, 100, current_date, $4)
       returning amount_cents::text`,
      [acmeOrg, repId, opportunity.rows[0].id, acmeOwner],
    );
    expect(recorded.rows[0].amount_cents).toBe("90000");

    // And it stays derived through an update, so a later edit cannot
    // separate the payout from the rate either.
    const raised = await db.query<{ amount_cents: string }>(
      `update public.crm_commissions set rate_bps = 1000
        where organization_id = $1 and employee_id = $2
        returning amount_cents::text`,
      [acmeOrg, repId],
    );
    expect(raised.rows[0].amount_cents).toBe("120000");
    await reset();
  });

  it("will not pay a commission that was never approved", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `update public.crm_commissions
            set status = 'paid', paid_at = now(), approved_at = null
          where organization_id = $1 and employee_id = $2`,
        [acmeOrg, repId],
      ),
    ).rejects.toThrow(/crm_commissions_paid_has_both/);

    // An accrued one carries no moments at all.
    await expect(
      db.query(
        `update public.crm_commissions
            set status = 'accrued', approved_at = now()
          where organization_id = $1 and employee_id = $2`,
        [acmeOrg, repId],
      ),
    ).rejects.toThrow(/crm_commissions_accrued_has_no_stamps/);
    await reset();
  });

  it("refuses a commission earned on nothing at all", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_commissions
           (organization_id, employee_id, basis_cents, rate_bps, earned_on, created_by)
         values ($1, $2, 500000, 750, current_date, $3)`,
        [acmeOrg, repId, acmeOwner],
      ),
    ).rejects.toThrow(/crm_commissions_has_source/);
    await reset();
  });

  it("keeps a closed branch closed and an ended employee off the roster", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_branches (organization_id, code, name, closed_on, active, created_by)
         values ($1, 'BR-GHOST', 'Ghost Branch', current_date, true, $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_branches_closed_is_inactive/);

    await expect(
      db.query(
        `insert into public.crm_branches (organization_id, code, name, opened_on, closed_on, active, created_by)
         values ($1, 'BR-TIME', 'Time Travel', current_date, current_date - 10, false, $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_branches_closed_after_opened/);

    await expect(
      db.query(
        `insert into public.crm_employees
           (organization_id, employee_code, first_name, role, end_date, active, created_by)
         values ($1, 'EMP-GHOST', 'Ghost', 'csr', current_date, true, $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_employees_ended_is_inactive/);
    await reset();
  });

  it("refuses a person who reports to themselves", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        "update public.crm_employees set reports_to_id = id where id = $1",
        [repId],
      ),
    ).rejects.toThrow(/crm_employees_no_self_report/);
    await reset();
  });

  it("refuses a territory whose postal codes are free text", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_territories
           (organization_id, branch_id, code, name, postal_codes, created_by)
         values ($1, $2, 'TR-BAD', 'Bad Codes', array['97001', 'not a postal code!'], $3)`,
        [acmeOrg, branchId, acmeOwner],
      ),
    ).rejects.toThrow(/postal_codes/);

    // The same territory with real codes is accepted, so the CHECK is
    // discriminating rather than merely hostile.
    const good = await db.query<{ count: string }>(
      `insert into public.crm_territories
         (organization_id, branch_id, rep_id, code, name, region, postal_codes, created_by)
       values ($1, $2, $3, 'TR-N1', 'North One', 'OR', array['97001', '97010', '97020'], $4)
       returning array_length(postal_codes, 1)::text as count`,
      [acmeOrg, branchId, repId, acmeOwner],
    );
    expect(good.rows[0].count).toBe("3");
    await reset();
  });

  it("keeps the company inside its own tenant, in both directions", async () => {
    await as(rivalOwner);
    const seen = await db.query(
      "select id from public.crm_branches where organization_id = $1",
      [acmeOrg],
    );
    expect(seen.rows).toEqual([]);

    // A rival cannot hang their own employee off our branch either: the
    // composite key makes the cross-tenant reference impossible, not merely
    // invisible.
    await expect(
      db.query(
        `insert into public.crm_employees
           (organization_id, branch_id, employee_code, first_name, role, created_by)
         values ($1, $2, 'EMP-X', 'Mallory', 'sales_rep', $3)`,
        [rivalOrg, branchId, rivalOwner],
      ),
    ).rejects.toThrow(/crm_employees_branch_same_org/);
    await reset();
  });

  it("gives nothing to anon or service_role, and lets nobody delete the company", async () => {
    await reset();
    const { rows } = await db.query<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated', 'service_role')
          and table_name in ('crm_branches', 'crm_employees', 'crm_territories', 'crm_commissions')
        order by table_name, grantee, privilege_type`,
    );
    for (const row of rows) {
      expect(row.grantee, `${row.table_name} is reachable by ${row.grantee}`).toBe("authenticated");
      expect(
        row.privilege_type,
        `${row.table_name} grants ${row.privilege_type} to ${row.grantee}`,
      ).not.toBe("DELETE");
    }
    // All four tables really are granted something, so an empty result
    // cannot pass this by accident.
    expect(new Set(rows.map((row) => row.table_name)).size).toBe(4);

    // And the refusal is the grant's, not a policy's: there is no DELETE to
    // fall back on, so the attempt is denied outright rather than matching
    // no rows.
    await as(acmeOwner);
    await expect(
      db.query("delete from public.crm_branches where id = $1", [branchId]),
    ).rejects.toThrow(/permission denied/i);
    await reset();
  });
});
