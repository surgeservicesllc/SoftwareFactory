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
 * Data you own (ADR-230) against the real chain.
 *
 * The merge is the hard part: one statement re-points every child so the
 * composite (organization, account, property) keys are checked once, at
 * the end, when they all agree; the loser stays readable and points at the
 * survivor; both histories say so; the two undecidable collisions refuse;
 * and a merged account cannot come back as a customer. The import log is
 * append-only.
 */

const acmeOwner = "00000000-0000-4000-8000-000000030001";
const rivalOwner = "00000000-0000-4000-8000-000000030002";
const acmeOrg = "10000000-0000-4000-8000-000000030001";
const rivalOrg = "10000000-0000-4000-8000-000000030002";

describe("data you own: merge, import log, merged-account link", { timeout: 240_000 }, () => {
  let db: PGlite;
  let survivor = "";
  let loser = "";
  let loserProperty = "";
  let list = "";

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

  async function newAccount(name: string, status: string): Promise<{ id: string; property: string }> {
    const account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, $2, 'commercial', $3, $4) returning id`,
      [acmeOrg, name, status, acmeOwner],
    )).rows[0].id;
    const property = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, $3, '1 Loaf Lane') returning id`,
      [acmeOrg, account, `${name} site`],
    )).rows[0].id;
    return { id: account, property };
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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-data', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-data', '${rivalOwner}');
    `);

    await as(acmeOwner);
    const a = await newAccount("Harborview Foods", "customer");
    const b = await newAccount("Harborview Foods Inc", "lead");
    survivor = a.id;
    loser = b.id;
    loserProperty = b.property;

    // What hangs off the loser: a contact, a work order on its property, an
    // invoice with a payment, a task, and a list membership — plus the same
    // list membership on the survivor, so one row must be left behind.
    await db.query(
      `insert into public.crm_contacts (organization_id, account_id, first_name, email)
       values ($1, $2, 'Rita', 'rita@harborview.example')`,
      [acmeOrg, loser],
    );
    await db.query(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, status, service_type, scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, 'scheduled', 'Quarterly IPM', now() + interval '2 days', now() + interval '2 days 2 hours', $4)`,
      [acmeOrg, loser, loserProperty, acmeOwner],
    );
    const invoice = (await db.query<{ id: string }>(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, issued_on, due_on, created_by)
       values ($1, $2, 'INV-M1', 'open', 20000, 0, 20000, current_date - 5, current_date + 25, $3) returning id`,
      [acmeOrg, loser, acmeOwner],
    )).rows[0].id;
    const method = (await db.query<{ method: string }>(
      "select (enum_range(null::public.crm_payment_method))[1]::text as method",
    )).rows[0].method;
    await db.query(
      `insert into public.crm_payments (organization_id, account_id, invoice_id, amount_cents, method, created_by)
       values ($1, $2, $3, 5000, $4::public.crm_payment_method, $5)`,
      [acmeOrg, loser, invoice, method, acmeOwner],
    );
    await db.query(
      `insert into public.crm_tasks (organization_id, account_id, title, due_on, created_by)
       values ($1, $2, 'Confirm the renewal', current_date, $3)`,
      [acmeOrg, loser, acmeOwner],
    );
    list = (await db.query<{ id: string }>(
      `insert into public.crm_marketing_lists (organization_id, name, created_by)
       values ($1, 'Newsletter', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    for (const account of [survivor, loser]) {
      await db.query(
        `insert into public.crm_list_members (organization_id, list_id, account_id, created_by)
         values ($1, $2, $3, $4)`,
        [acmeOrg, list, account, acmeOwner],
      );
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  it("refuses to merge an account into itself, or across workspaces, or by a non-member", async () => {
    await as(acmeOwner);
    expect(await rejects(() => db.query("select public.crm_merge_accounts($1, $1)", [survivor])))
      .toMatch(/cannot be merged into itself/);
    await as(rivalOwner);
    expect(await rejects(() => db.query("select public.crm_merge_accounts($1, $2)", [survivor, loser])))
      .toMatch(/not a member|both accounts must exist/);
  });

  it("refuses when both accounts hold a portal login for the same email", async () => {
    await as(acmeOwner);
    for (const account of [survivor, loser]) {
      await db.query(
        `insert into public.crm_portal_users (organization_id, account_id, email, created_by)
         values ($1, $2, 'shared@harborview.example', $3)`,
        [acmeOrg, account, acmeOwner],
      );
    }
    expect(await rejects(() => db.query("select public.crm_merge_accounts($1, $2)", [survivor, loser])))
      .toMatch(/portal login for the same email/);
    // A portal seat is revoked through its own definer in the product; the
    // fixture is cleared as the owner so the next case can merge.
    await db.exec("reset role");
    await db.query(
      "delete from public.crm_portal_users where organization_id = $1 and account_id = $2",
      [acmeOrg, loser],
    );
  });

  it("re-points every child in one statement, leaves the shared membership behind, and writes both histories", async () => {
    await as(acmeOwner);
    const result = await db.query<{ counts: Record<string, number> }>(
      "select public.crm_merge_accounts($1, $2) as counts", [survivor, loser],
    );
    const counts = result.rows[0].counts;
    expect(counts).toMatchObject({
      properties: 1, workOrders: 1, contacts: 1, invoices: 1, payments: 1, tasks: 1,
      listMemberships: 0, opportunities: 0,
    });

    const moved = await db.query<{ property_account: string; work_order_account: string; invoice_account: string }>(
      `select (select account_id from public.crm_properties where id = $1) as property_account,
              (select account_id from public.crm_work_orders where property_id = $1) as work_order_account,
              (select account_id from public.crm_invoices where number = 'INV-M1') as invoice_account`,
      [loserProperty],
    );
    expect(moved.rows[0]).toEqual({ property_account: survivor, work_order_account: survivor, invoice_account: survivor });

    const memberships = await db.query<{ account_id: string }>(
      "select account_id from public.crm_list_members where list_id = $1 order by 1", [list],
    );
    expect(memberships.rows.map((row) => row.account_id).sort()).toEqual([survivor, loser].sort());

    const merged = await db.query<{ status: string; merged_into_id: string | null }>(
      "select status::text, merged_into_id from public.crm_accounts where id = $1", [loser],
    );
    expect(merged.rows[0]).toEqual({ status: "inactive", merged_into_id: survivor });

    const histories = await db.query<{ account_id: string; kind: string; summary: string }>(
      `select account_id, kind::text, summary from public.crm_timeline_events
        where organization_id = $1 and account_id in ($2, $3) and kind = 'note' order by account_id, summary`,
      [acmeOrg, survivor, loser],
    );
    expect(histories.rows.map((row) => row.summary).sort()).toEqual(
      ["Absorbed Harborview Foods Inc.", "Merged into Harborview Foods."].sort(),
    );
    const detail = await db.query<{ detail: string }>(
      `select detail from public.crm_timeline_events
        where account_id = $1 and summary = 'Absorbed Harborview Foods Inc.'`, [survivor],
    );
    expect(detail.rows[0].detail).toContain("1 contacts");
    expect(detail.rows[0].detail).toContain("1 payments");
  });

  it("will not merge a merged account again, nor let it come back as a customer", async () => {
    await as(acmeOwner);
    const third = await newAccount("Harbor Foods Ltd", "lead");
    expect(await rejects(() => db.query("select public.crm_merge_accounts($1, $2)", [loser, third.id])))
      .toMatch(/was already merged into another account/);
    expect(await rejects(() => db.query("select public.crm_merge_accounts($1, $2)", [third.id, loser])))
      .toMatch(/was already merged into another account/);
    expect(await rejects(() =>
      db.query("update public.crm_accounts set status = 'customer' where id = $1", [loser])))
      .toMatch(/crm_accounts_merged_is_inactive/);
  });

  it("keeps the import log append-only and its counts inside the row count", async () => {
    await as(acmeOwner);
    const created = await db.query<{ id: string }>(
      `insert into public.crm_imports
         (organization_id, source_label, mapping, row_count, created_accounts, created_properties,
          created_contacts, skipped_duplicates, invalid_rows, created_by)
       values ($1, 'Spring list', '{"Company":"account.name"}', 10, 7, 3, 2, 2, 1, $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    expect(created.rows[0].id).toBeTruthy();
    expect(await rejects(() =>
      db.query("update public.crm_imports set created_accounts = 9 where id = $1", [created.rows[0].id])))
      .toMatch(/permission denied/);
    expect(await rejects(() =>
      db.query(
        `insert into public.crm_imports
           (organization_id, source_label, mapping, row_count, created_accounts, created_properties,
            created_contacts, skipped_duplicates, invalid_rows, created_by)
         values ($1, 'Impossible', '{}', 3, 3, 0, 0, 1, 0, $2)`,
        [acmeOrg, acmeOwner],
      ))).toMatch(/crm_imports_accounts_within_rows/);

    await as(rivalOwner);
    const hidden = await db.query<{ n: number }>("select count(*)::int as n from public.crm_imports");
    expect(hidden.rows[0].n).toBe(0);
  });
});
