// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830001700_customer_portal.sql";

/**
 * The customer portal (ADR-197) against the real migration chain.
 *
 * This is the suite that matters most in the whole CRM. Every other table
 * is read by a member of the organization that owns it; the portal adds a
 * reader who is not a member and must see exactly one account. The tests
 * below are written from the attacker's side: a portal user reaching for a
 * second account, a deactivated login still holding a session, a signed-in
 * stranger with no portal link at all, and a customer trying to file a
 * request against somebody else's site.
 *
 * The answer to all of them has to be nothing — not an error that leaks a
 * row count, not a partial page. Nothing.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000a301";
const rivalOwner = "00000000-0000-4000-8000-00000000a302";
const acmeOrg = "10000000-0000-4000-8000-00000000a301";
const rivalOrg = "10000000-0000-4000-8000-00000000a302";

describe("the customer portal", { timeout: 240_000 }, () => {
  let db: PGlite;
  let branchId = "";
  let managerId = "";
  let repId = "";

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

    // A customer for the forms to be about; the suite reaches it through
    // the instances rather than by id.
    await db.query<{ id: string }>(
      `insert into public.crm_accounts
         (organization_id, name, kind, branch_id, owner_employee_id, created_by)
       values ($1, 'Harborview Foods', 'commercial', $2, $3, $4) returning id`,
      [acmeOrg, branchId, repId, acmeOwner],
    );
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  const customerLogin = "00000000-0000-4000-8000-00000000a311";
  const strangerLogin = "00000000-0000-4000-8000-00000000a312";
  const rivalCustomerLogin = "00000000-0000-4000-8000-00000000a313";

  let acmeAccount = "";
  let rivalAccount = "";

  async function asPortal(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  it("sets up two tenants, each with a customer and a portal login", async () => {
    await db.exec("reset role");
    await db.exec(`
      insert into auth.users (id) values
        ('${customerLogin}'), ('${strangerLogin}'), ('${rivalCustomerLogin}');
    `);

    await as(acmeOwner);
    const acme = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    acmeAccount = acme.rows[0].id;
    await db.query(
      `insert into public.crm_portal_users
         (organization_id, account_id, user_id, email, role, activated_at, created_by)
       values ($1, $2, $3, 'ap@harborview.example', 'payer', now(), $4)`,
      [acmeOrg, acmeAccount, customerLogin, acmeOwner],
    );
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents,
          issued_on, created_by)
       values ($1, $2, 'INV-P-1', 'open', 50000, 0, 50000, current_date, $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );
    // A draft invoice has not been issued to anybody.
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, created_by)
       values ($1, $2, 'INV-P-DRAFT', 'draft', 90000, 0, 90000, $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );
    await reset();

    await as(rivalOwner);
    const rival = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Rival Grocers', 'commercial', 'customer', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    rivalAccount = rival.rows[0].id;
    await db.query(
      `insert into public.crm_portal_users
         (organization_id, account_id, user_id, email, activated_at, created_by)
       values ($1, $2, $3, 'ap@rivalgrocers.example', now(), $4)`,
      [rivalOrg, rivalAccount, rivalCustomerLogin, rivalOwner],
    );
    await db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents,
          issued_on, created_by)
       values ($1, $2, 'INV-R-1', 'open', 77000, 0, 77000, current_date, $3)`,
      [rivalOrg, rivalAccount, rivalOwner],
    );
    await reset();

    expect(acmeAccount).not.toBe(rivalAccount);
  });

  it("shows a portal user their own account, and only theirs", async () => {
    await asPortal(customerLogin);
    const summary = await db.query<{ account_name: string; balance_cents: string; open_invoices: number }>(
      "select account_name, balance_cents::text, open_invoices from public.crm_portal_summary()",
    );
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].account_name).toBe("Harborview Foods");
    // The draft is excluded: it was never issued to anybody.
    expect(summary.rows[0].open_invoices).toBe(1);
    expect(summary.rows[0].balance_cents).toBe("50000");

    const invoices = await db.query<{ number: string }>(
      "select number from public.crm_portal_invoices()",
    );
    expect(invoices.rows.map((row) => row.number)).toEqual(["INV-P-1"]);
    await reset();
  });

  it("shows the rival's customer their own account, and never ours", async () => {
    await asPortal(rivalCustomerLogin);
    const summary = await db.query<{ account_name: string }>(
      "select account_name from public.crm_portal_summary()",
    );
    expect(summary.rows[0].account_name).toBe("Rival Grocers");

    const invoices = await db.query<{ number: string }>(
      "select number from public.crm_portal_invoices()",
    );
    // Not one row of ours, in a function that runs as the definer and could
    // have returned everything had it not filtered.
    expect(invoices.rows.map((row) => row.number)).toEqual(["INV-R-1"]);
    await reset();
  });

  it("gives a signed-in stranger with no portal link nothing at all", async () => {
    await asPortal(strangerLogin);
    for (const call of [
      "select * from public.crm_portal_summary()",
      "select * from public.crm_portal_invoices()",
      "select * from public.crm_portal_visits()",
      "select * from public.crm_portal_documents()",
      "select * from public.crm_portal_requests_mine()",
    ]) {
      const { rows } = await db.query(call);
      expect(rows, `${call} leaked to a caller with no portal link`).toEqual([]);
    }
    await reset();
  });

  it("closes the door the moment a link is deactivated", async () => {
    await as(acmeOwner);
    await db.query(
      "update public.crm_portal_users set active = false where user_id = $1",
      [customerLogin],
    );
    await reset();

    await asPortal(customerLogin);
    const summary = await db.query("select * from public.crm_portal_summary()");
    expect(summary.rows).toEqual([]);
    await reset();

    // And restoring it restores exactly that one account.
    await as(acmeOwner);
    await db.query(
      "update public.crm_portal_users set active = true where user_id = $1",
      [customerLogin],
    );
    await reset();
    await asPortal(customerLogin);
    const back = await db.query<{ account_name: string }>(
      "select account_name from public.crm_portal_summary()",
    );
    expect(back.rows[0].account_name).toBe("Harborview Foods");
    await reset();
  });

  it("refuses a request filed against somebody else's site", async () => {
    await as(rivalOwner);
    const rivalProperty = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Their warehouse', '9 Rival Way, Cedar Point, WA 98040') returning id`,
      [rivalOrg, rivalAccount],
    );
    await reset();

    await asPortal(customerLogin);
    await expect(
      db.query("select public.crm_portal_submit_request('service', 'Ants in the break room', null, $1, null)", [
        rivalProperty.rows[0].id,
      ]),
    ).rejects.toThrow(/that site is not on this account/);

    // Their own request lands, and comes back to them.
    const created = await db.query<{ id: string }>(
      "select public.crm_portal_submit_request('service', 'Ants in the break room') as id",
    );
    expect(created.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    const mine = await db.query<{ summary: string; status: string }>(
      "select summary, status::text from public.crm_portal_requests_mine()",
    );
    expect(mine.rows.map((row) => row.summary)).toEqual(["Ants in the break room"]);
    expect(mine.rows[0].status).toBe("submitted");
    await reset();
  });

  it("refuses a request from a caller with no portal access", async () => {
    await asPortal(strangerLogin);
    await expect(
      db.query("select public.crm_portal_submit_request('service', 'Let me in')"),
    ).rejects.toThrow(/no portal access/);
    await reset();
  });

  it("never exposes the portal tables themselves to a customer", async () => {
    await asPortal(customerLogin);
    // The tables are staff-facing and org-scoped; a portal user is not a
    // member, so the rows are invisible even though the definers read them.
    for (const table of ["crm_portal_users", "crm_portal_requests", "crm_invoices", "crm_accounts"]) {
      const { rows } = await db.query(`select * from public.${table}`);
      expect(rows, `${table} was readable directly by a portal user`).toEqual([]);
    }
    await reset();
  });

  it("keeps one login to one account, across every tenant", async () => {
    await as(rivalOwner);
    // The rival cannot attach our customer's login to their own account and
    // read us through it: the uniqueness is global, not per-tenant.
    await expect(
      db.query(
        `insert into public.crm_portal_users
           (organization_id, account_id, user_id, email, activated_at, created_by)
         values ($1, $2, $3, 'stolen@rivalgrocers.example', now(), $4)`,
        [rivalOrg, rivalAccount, customerLogin, rivalOwner],
      ),
    ).rejects.toThrow(/crm_portal_users_user_key/);
    await reset();
  });

  it("will not let an unactivated invitation act as a login", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_portal_users
           (organization_id, account_id, email, activated_at, created_by)
         values ($1, $2, 'ghost@harborview.example', now(), $3)`,
        [acmeOrg, acmeAccount, acmeOwner],
      ),
    ).rejects.toThrow(/crm_portal_users_activated_has_login/);
    await reset();
  });

  it("gives nothing to anon or service_role, and lets nobody delete the record", async () => {
    await reset();
    const { rows } = await db.query<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated', 'service_role')
          and table_name in ('crm_portal_users', 'crm_portal_requests')
        order by table_name, grantee, privilege_type`,
    );
    for (const row of rows) {
      expect(row.grantee, `${row.table_name} is reachable by ${row.grantee}`).toBe("authenticated");
      expect(row.privilege_type, `${row.table_name} grants ${row.privilege_type}`).not.toBe("DELETE");
    }
    expect(new Set(rows.map((row) => row.table_name)).size).toBe(2);

    // And anon cannot call the portal functions either — a signed-out
    // caller is not a customer.
    const { rows: acl } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'crm_portal%'
          and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(acl.map((row) => row.proname)).toEqual([]);
    await reset();
  });
});
