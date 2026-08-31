// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACCOUNTS,
  type LedgerInvoice,
  type LedgerPayment,
  type LedgerRefund,
  journalFromLedgers,
  journalTotals,
  toJournalCsv,
} from "../../lib/services/accounting-export";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * The accounting export (ADR-219) against the real schema.
 *
 * The unit suite proves the entries balance for values chosen by hand.
 * This one proves it for rows the DATABASE produced — including
 * `paid_cents`, which no caller writes because the payment triggers
 * maintain it, and which an export computed from anything else would get
 * wrong.
 */

const owner = "00000000-0000-4000-8000-000000019001";
const org = "10000000-0000-4000-8000-000000019001";

describe("the accounting export against real ledgers", { timeout: 240_000 }, () => {
  let db: PGlite;
  let account = "";
  let ledgers: {
    invoices: LedgerInvoice[];
    payments: LedgerPayment[];
    refunds: LedgerRefund[];
    names: Map<string, string>;
  };

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function invoice(options: {
    number: string; status: string; subtotal: number; tax: number; issued?: string | null;
  }) {
    return db.query<{ id: string }>(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents,
          total_cents, issued_on, due_on, created_by)
       values ($1, $2, $3, $4::public.crm_invoice_status, $5::bigint, $6::bigint, $5::bigint + $6::bigint, $7, '2026-03-10', $8)
       returning id`,
      [org, account, options.number, options.status, options.subtotal, options.tax,
        options.issued === undefined ? "2026-02-10" : options.issued, owner],
    );
  }

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${owner}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${org}', 'Acme Pest', 'acme-pest-books', '${owner}');
    `);

    await as(owner);
    // A comma in the name, because that is the ordinary case that breaks a
    // CSV writer and it should break nothing here.
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Vance, Marisol', 'residential', 'customer', $2) returning id`,
      [org, owner],
    )).rows[0].id;

    const taxed = (await invoice({ number: "INV-9001", status: "open", subtotal: 12000, tax: 900 })).rows[0].id;
    await invoice({ number: "INV-9002", status: "open", subtotal: 8000, tax: 0 });
    await invoice({ number: "INV-9003", status: "draft", subtotal: 5000, tax: 0, issued: null });
    await invoice({ number: "INV-9004", status: "open", subtotal: 4000, tax: 0 });
    // An invoice given up on, partly paid before it was.
    const written = (await invoice({ number: "INV-9005", status: "open", subtotal: 10000, tax: 0 })).rows[0].id;

    // Payments, which move paid_cents through the triggers rather than by
    // anything this test writes.
    const payment = (await db.query<{ id: string }>(
      `insert into public.crm_payments
         (organization_id, account_id, invoice_id, amount_cents, method, received_at, created_by)
       values ($1, $2, $3, 5000, 'card', '2026-03-02T10:00:00Z', $4) returning id`,
      [org, account, taxed, owner],
    )).rows[0].id;
    await db.query(
      `insert into public.crm_payments
         (organization_id, account_id, invoice_id, amount_cents, method, received_at, created_by)
       values ($1, $2, $3, 4000, 'check', '2026-03-04T10:00:00Z', $4)`,
      [org, account, written, owner]);

    await db.query(
      `insert into public.crm_refunds
         (organization_id, payment_id, amount_cents, reason, refunded_at, created_by)
       values ($1, $2, 1500, 'Goodwill after a missed appointment', '2026-03-09T10:00:00Z', $3)`,
      [org, payment, owner]);

    // Only now is it uncollectible — after the part payment landed.
    await db.query(
      `update public.crm_invoices set status = 'uncollectible' where id = $1`, [written]);

    const invoiceRows = await db.query<LedgerInvoice & Record<string, unknown>>(
      `select id, account_id as "accountId", number, issued_on as "issuedOn",
              subtotal_cents as "subtotalCents", tax_cents as "taxCents",
              total_cents as "totalCents", paid_cents as "paidCents", status
         from public.crm_invoices where organization_id = $1 order by number`, [org]);
    const paymentRows = await db.query<LedgerPayment & Record<string, unknown>>(
      `select id, invoice_id as "invoiceId", amount_cents as "amountCents",
              method::text as method, received_at as "receivedOn"
         from public.crm_payments where organization_id = $1 order by received_at`, [org]);
    const refundRows = await db.query<LedgerRefund & Record<string, unknown>>(
      `select payment_id as "paymentId", amount_cents as "amountCents",
              refunded_at as "refundedOn"
         from public.crm_refunds where organization_id = $1`, [org]);
    const accountRows = await db.query<{ id: string; name: string }>(
      `select id, name from public.crm_accounts where organization_id = $1`, [org]);

    ledgers = {
      invoices: invoiceRows.rows.map((row) => ({
        ...row,
        subtotalCents: Number(row.subtotalCents),
        taxCents: Number(row.taxCents),
        totalCents: Number(row.totalCents),
        paidCents: Number(row.paidCents),
      })),
      payments: paymentRows.rows.map((row) => ({ ...row, amountCents: Number(row.amountCents) })),
      refunds: refundRows.rows.map((row) => ({ ...row, amountCents: Number(row.amountCents) })),
      names: new Map(accountRows.rows.map((row) => [row.id, row.name])),
    };
  });

  afterAll(async () => {
    await db?.close();
  });

  it("reads a paid_cents no caller wrote", async () => {
    // The triggers maintain it. An export that computed the balance from
    // anything this test supplied would be wrong here, which is the whole
    // reason the route reads it back.
    const taxed = ledgers.invoices.find((row) => row.number === "INV-9001")!;
    // 5,000 paid less the 1,500 refunded: the triggers net refunds OUT of
    // paid_cents rather than leaving the gross figure standing. Worth
    // knowing, because an export that added its own refund handling on top
    // of this number would double-count every refund.
    expect(taxed.paidCents).toBe(3500);
    const written = ledgers.invoices.find((row) => row.number === "INV-9005")!;
    expect(written.paidCents).toBe(4000);
  });

  it("balances across the whole book", () => {
    const totals = journalTotals(journalFromLedgers(ledgers));
    expect(totals.balanced).toBe(true);
    expect(totals.debitCents).toBe(totals.creditCents);
    expect(totals.debitCents).toBeGreaterThan(0);
  });

  it("posts nothing for the draft and everything for the rest", () => {
    const entries = journalFromLedgers(ledgers);
    const references = entries.map((entry) => entry.reference);
    expect(references).not.toContain("INV-9003");
    expect(references).toContain("INV-9001");
    expect(references).toContain("INV-9002");
  });

  it("raises the uncollectible invoice AND writes off only what was left", () => {
    const entries = journalFromLedgers(ledgers);
    const forWritten = entries.filter((entry) => entry.reference === "INV-9005");
    // Three: it was raised, part-paid, and only then given up on. All three
    // are facts and all three post.
    expect(forWritten).toHaveLength(3);
    expect(forWritten.filter((entry) =>
      entry.lines.some((line) => line.account === ACCOUNTS.revenue))).toHaveLength(1);
    expect(forWritten.filter((entry) =>
      entry.lines.some((line) => line.account === ACCOUNTS.undeposited))).toHaveLength(1);

    const writeOff = forWritten.find((entry) =>
      entry.lines.some((line) => line.account === ACCOUNTS.badDebt))!;
    // 10,000 raised less the 4,000 that was actually collected.
    expect(writeOff.lines[0].debitCents).toBe(6000);
  });

  it("carries the refund back through the payment it reverses", () => {
    const entries = journalFromLedgers(ledgers);
    // The refund names a payment, not an invoice; resolving it wrongly
    // would drop it silently rather than fail loudly.
    const refunds = entries.filter((entry) =>
      entry.lines.some((line) =>
        line.account === ACCOUNTS.receivable && line.debitCents === 1500));
    expect(refunds).toHaveLength(1);
    expect(refunds[0].reference).toBe("INV-9001");
  });

  it("keeps a comma in the customer name inside one field", () => {
    const csv = toJournalCsv(journalFromLedgers(ledgers));
    expect(csv).toContain('"Vance, Marisol"');
    for (const row of csv.split("\n").slice(1).filter((line) => line.length > 0)) {
      // Seven columns on every row, despite the comma in the name.
      const separators = row.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) ?? [];
      expect(separators).toHaveLength(6);
    }
  });
});
