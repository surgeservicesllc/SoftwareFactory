// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830001300_billing_contracts.sql";

/**
 * Billing (ADR-193) against the real migration chain. Money is the part of
 * a CRM where "the application will handle it" is least defensible, so
 * every promise here is the database's: the payment ledger is append-only
 * by grant, an invoice's settled total is derived rather than asserted, a
 * refund cannot overdraw its payment even against a concurrent one, and a
 * payment writes its own history.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000e001";
const rivalOwner = "00000000-0000-4000-8000-00000000e002";
const acmeOrg = "10000000-0000-4000-8000-00000000e001";
const rivalOrg = "10000000-0000-4000-8000-00000000e002";

describe("billing, contracts and the money ledger", { timeout: 240_000 }, () => {
  let db: PGlite;
  let accountId = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function reset() {
    await db.exec("reset role");
  }

  async function makeInvoice(total: number, number: string) {
    const invoice = await db.query<{ id: string }>(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, issued_on, created_by)
       values ($1, $2, $3, 'open', $4, 0, $4, current_date, $5) returning id`,
      [acmeOrg, accountId, number, total, acmeOwner],
    );
    return invoice.rows[0].id;
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
    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Harborview Foods', 'commercial', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    accountId = account.rows[0].id;
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("settles an invoice from its payments, and writes the payment onto history", async () => {
    await as(acmeOwner);
    const invoiceId = await makeInvoice(24_000, "INV-1001");

    await db.query(
      `insert into public.crm_payments
         (organization_id, account_id, invoice_id, amount_cents, method, reference, created_by)
       values ($1, $2, $3, 10_000, 'card', 'demo-ref-1', $4)`,
      [acmeOrg, accountId, invoiceId, acmeOwner],
    );
    const partial = await db.query<{ paid_cents: string; status: string }>(
      "select paid_cents::text, status::text from public.crm_invoices where id = $1",
      [invoiceId],
    );
    // Part-paid is still open: `paid` is what the ledger says, not a wish.
    expect(partial.rows[0]).toEqual({ paid_cents: "10000", status: "open" });

    await db.query(
      `insert into public.crm_payments
         (organization_id, account_id, invoice_id, amount_cents, method, created_by)
       values ($1, $2, $3, 14_000, 'ach', $4)`,
      [acmeOrg, accountId, invoiceId, acmeOwner],
    );
    const settled = await db.query<{ paid_cents: string; status: string }>(
      "select paid_cents::text, status::text from public.crm_invoices where id = $1",
      [invoiceId],
    );
    expect(settled.rows[0]).toEqual({ paid_cents: "24000", status: "paid" });

    // Both payments told the customer's history, in the customer's terms.
    const trail = await db.query<{ summary: string; detail: string; actor_user_id: string | null }>(
      `select summary, detail, actor_user_id from public.crm_timeline_events
        where account_id = $1 and kind = 'payment' order by occurred_at`,
      [accountId],
    );
    expect(trail.rows).toEqual([
      {
        summary: "Payment received: 100.00 on invoice INV-1001.",
        detail: "Method: card. Reference: demo-ref-1.",
        actor_user_id: acmeOwner,
      },
      {
        summary: "Payment received: 140.00 on invoice INV-1001.",
        detail: "Method: ach.",
        actor_user_id: acmeOwner,
      },
    ]);
    await reset();
  });

  it("refuses a refund that would overdraw its payment, concurrently included", async () => {
    await as(acmeOwner);
    const invoiceId = await makeInvoice(50_000, "INV-1002");
    const payment = await db.query<{ id: string }>(
      `insert into public.crm_payments
         (organization_id, account_id, invoice_id, amount_cents, method, created_by)
       values ($1, $2, $3, 50_000, 'check', $4) returning id`,
      [acmeOrg, accountId, invoiceId, acmeOwner],
    );
    const paymentId = payment.rows[0].id;

    await db.query(
      `insert into public.crm_refunds (organization_id, payment_id, amount_cents, reason, created_by)
       values ($1, $2, 20_000, 'Partial credit for a missed visit.', $3)`,
      [acmeOrg, paymentId, acmeOwner],
    );
    // The invoice reopens: the ledger decides in both directions.
    const reopened = await db.query<{ paid_cents: string; status: string }>(
      "select paid_cents::text, status::text from public.crm_invoices where id = $1",
      [invoiceId],
    );
    expect(reopened.rows[0]).toEqual({ paid_cents: "30000", status: "open" });

    // A second refund beyond the remainder is refused outright.
    await expect(db.query(
      `insert into public.crm_refunds (organization_id, payment_id, amount_cents, reason, created_by)
       values ($1, $2, 40_000, 'Too much.', $3)`,
      [acmeOrg, paymentId, acmeOwner],
    )).rejects.toThrow(/would exceed the payment/);

    // The remainder exactly is fine, and takes it to zero.
    await db.query(
      `insert into public.crm_refunds (organization_id, payment_id, amount_cents, reason, created_by)
       values ($1, $2, 30_000, 'Balance credited on cancellation.', $3)`,
      [acmeOrg, paymentId, acmeOwner],
    );
    const emptied = await db.query<{ paid_cents: string }>(
      "select paid_cents::text from public.crm_invoices where id = $1",
      [invoiceId],
    );
    expect(emptied.rows[0].paid_cents).toBe("0");

    // And nothing more, however small.
    await expect(db.query(
      `insert into public.crm_refunds (organization_id, payment_id, amount_cents, reason, created_by)
       values ($1, $2, 1, 'One cent too far.', $3)`,
      [acmeOrg, paymentId, acmeOwner],
    )).rejects.toThrow(/would exceed the payment/);
    await reset();
  });

  it("keeps the money ledger append-only and nothing deletable", async () => {
    await as(acmeOwner);
    const invoiceId = await makeInvoice(9_900, "INV-1003");
    const payment = await db.query<{ id: string }>(
      `insert into public.crm_payments
         (organization_id, account_id, invoice_id, amount_cents, method, created_by)
       values ($1, $2, $3, 9_900, 'cash', $4) returning id`,
      [acmeOrg, accountId, invoiceId, acmeOwner],
    );

    await expect(db.query(
      "update public.crm_payments set amount_cents = 1 where id = $1",
      [payment.rows[0].id],
    )).rejects.toThrow(/permission denied/);
    await expect(db.query(
      "delete from public.crm_payments where id = $1",
      [payment.rows[0].id],
    )).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.crm_invoices where id = $1", [invoiceId]))
      .rejects.toThrow(/permission denied/);
    await expect(db.query(
      `delete from public.crm_refunds where organization_id = $1`,
      [acmeOrg],
    )).rejects.toThrow(/permission denied/);
    await reset();
  });

  it("holds the paper trail's own arithmetic and signature rules", async () => {
    await as(acmeOwner);
    // A total that disagrees with its parts is refused.
    await expect(db.query(
      `insert into public.crm_estimates
         (organization_id, account_id, number, subtotal_cents, tax_cents, total_cents, created_by)
       values ($1, $2, 'EST-BAD', 1000, 100, 9999, $3)`,
      [acmeOrg, accountId, acmeOwner],
    )).rejects.toThrow(/crm_estimates_total_is_sum/);

    // A decided estimate carries its decision timestamp.
    await expect(db.query(
      `insert into public.crm_estimates
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, created_by)
       values ($1, $2, 'EST-NODATE', 'accepted', 1000, 0, 1000, $3)`,
      [acmeOrg, accountId, acmeOwner],
    )).rejects.toThrow(/crm_estimates_decided_iff_closed/);

    const estimate = await db.query<{ id: string }>(
      `insert into public.crm_estimates
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents,
          decided_at, terms, valid_until, created_by)
       values ($1, $2, 'EST-1001', 'accepted', 120000, 9600, 129600, now(),
               'Net 30. Service begins on signature.', current_date + 30, $3)
       returning id`,
      [acmeOrg, accountId, acmeOwner],
    );

    // A signature is a name and a moment together, or neither.
    await expect(db.query(
      `insert into public.crm_contracts
         (organization_id, account_id, number, value_cents, starts_on, signed_at, created_by)
       values ($1, $2, 'CON-BAD', 129600, current_date, now(), $3)`,
      [acmeOrg, accountId, acmeOwner],
    )).rejects.toThrow(/crm_contracts_signature_complete/);

    const contract = await db.query<{ id: string }>(
      `insert into public.crm_contracts
         (organization_id, account_id, estimate_id, number, value_cents, starts_on, ends_on,
          auto_renew, signed_at, signed_by_name, created_by)
       values ($1, $2, $3, 'CON-1001', 129600, current_date, current_date + 365, true,
               now(), 'Dana Reyes', $4) returning id`,
      [acmeOrg, accountId, estimate.rows[0].id, acmeOwner],
    );
    expect(contract.rows[0].id).toBeTruthy();

    // A void invoice names its reason and its moment together.
    await expect(db.query(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents, voided_at, created_by)
       values ($1, $2, 'INV-VOIDBAD', 'void', 100, 0, 100, now(), $3)`,
      [acmeOrg, accountId, acmeOwner],
    )).rejects.toThrow(/crm_invoices_void_complete/);
    await reset();
  });

  it("keeps a voided invoice void, whatever the cash says", async () => {
    await as(acmeOwner);
    const invoiceId = await db.query<{ id: string }>(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents, total_cents,
          voided_at, void_reason, created_by)
       values ($1, $2, 'INV-1004', 'void', 5000, 0, 5000, now(), 'Raised against the wrong site.', $3)
       returning id`,
      [acmeOrg, accountId, acmeOwner],
    );
    // Even a payment covering it in full does not un-void it: the void is a
    // decision about the debt, not a statement about the cash.
    await db.query(
      `insert into public.crm_payments
         (organization_id, account_id, invoice_id, amount_cents, method, created_by)
       values ($1, $2, $3, 5000, 'other', $4)`,
      [acmeOrg, accountId, invoiceId.rows[0].id, acmeOwner],
    );
    const after = await db.query<{ status: string; paid_cents: string }>(
      "select status::text, paid_cents::text from public.crm_invoices where id = $1",
      [invoiceId.rows[0].id],
    );
    expect(after.rows[0]).toEqual({ status: "void", paid_cents: "5000" });
    await reset();
  });

  it("keeps tenants apart and shuts anon and service_role out", async () => {
    await as(rivalOwner);
    const seen = await db.query<{ invoices: number; payments: number; contracts: number }>(
      `select
         (select count(*)::integer from public.crm_invoices where organization_id = $1) as invoices,
         (select count(*)::integer from public.crm_payments where organization_id = $1) as payments,
         (select count(*)::integer from public.crm_contracts where organization_id = $1) as contracts`,
      [acmeOrg],
    );
    expect(seen.rows[0]).toEqual({ invoices: 0, payments: 0, contracts: 0 });
    await reset();

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    for (const role of ["anon", "service_role"]) {
      await db.exec(`set role ${role}`);
      for (const table of [
        "crm_estimates", "crm_estimate_lines", "crm_contracts", "crm_invoices",
        "crm_invoice_lines", "crm_payments", "crm_refunds",
      ]) {
        await expect(db.query(`select count(*) from public.${table}`))
          .rejects.toThrow(/permission denied/);
      }
      await db.exec("reset role");
    }
  });
});
