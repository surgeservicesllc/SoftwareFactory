import { describe, expect, it } from "vitest";

import {
  ACCOUNTS,
  type ExportInvoice,
  UnbalancedEntry,
  csvField,
  formatAmount,
  journalForInvoice,
  journalForPayment,
  journalForRefund,
  journalForWriteOff,
  journalTotals,
  toJournalCsv,
} from "../../lib/services/accounting-export";

const invoice: ExportInvoice = {
  number: "INV-3310",
  customerName: "Marisol Vance",
  issuedOn: "2026-02-10",
  subtotalCents: 12000,
  taxCents: 900,
  totalCents: 12900,
  paidCents: 0,
  status: "open",
};

describe("posting an invoice", () => {
  it("owes us the total, earns the subtotal, and owes the tax onward", () => {
    const entry = journalForInvoice(invoice)!;
    expect(entry.lines).toHaveLength(3);

    const byAccount = new Map(entry.lines.map((line) => [line.account, line]));
    expect(byAccount.get(ACCOUNTS.receivable)!.debitCents).toBe(12900);
    expect(byAccount.get(ACCOUNTS.revenue)!.creditCents).toBe(12000);
    expect(byAccount.get(ACCOUNTS.taxPayable)!.creditCents).toBe(900);
  });

  it("omits the tax line when there is no tax", () => {
    // A zero row is something an accountant has to read and dismiss.
    const entry = journalForInvoice({ ...invoice, taxCents: 0, totalCents: 12000 })!;
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines.some((line) => line.account === ACCOUNTS.taxPayable)).toBe(false);
  });

  it("posts nothing for a draft or a void", () => {
    // A draft was never issued and a void never existed.
    expect(journalForInvoice({ ...invoice, status: "draft" })).toBeNull();
    expect(journalForInvoice({ ...invoice, status: "void" })).toBeNull();
    expect(journalForInvoice({ ...invoice, issuedOn: null })).toBeNull();
  });

  it("refuses to build an entry that does not balance", () => {
    // The guard that makes every other test here meaningful.
    expect(() => journalForInvoice({ ...invoice, totalCents: 99999 }))
      .toThrow(UnbalancedEntry);
    expect(() => journalForInvoice({ ...invoice, totalCents: 99999 }))
      .toThrow(/does not balance/i);
  });
});

describe("money moving", () => {
  it("takes a payment into undeposited funds and shrinks the debt", () => {
    const entry = journalForPayment({
      invoiceNumber: "INV-3310", customerName: "Marisol Vance",
      receivedOn: "2026-03-02", amountCents: 5000, method: "card",
    });
    expect(entry.lines[0].account).toBe(ACCOUNTS.undeposited);
    expect(entry.lines[0].debitCents).toBe(5000);
    expect(entry.lines[1].account).toBe(ACCOUNTS.receivable);
    expect(entry.lines[1].creditCents).toBe(5000);
  });

  it("mirrors a payment for a refund rather than negating one", () => {
    const entry = journalForRefund({
      invoiceNumber: "INV-3310", customerName: "Marisol Vance",
      refundedOn: "2026-03-09", amountCents: 5000,
    });
    // Debits and credits swap; no line carries a negative amount.
    expect(entry.lines[0].account).toBe(ACCOUNTS.receivable);
    expect(entry.lines[0].debitCents).toBe(5000);
    expect(entry.lines.every((line) => line.debitCents >= 0 && line.creditCents >= 0)).toBe(true);
  });

  it("writes off only what is still outstanding", () => {
    // Half was paid; only the rest becomes an expense.
    const entry = journalForWriteOff({
      ...invoice, status: "uncollectible", paidCents: 4900,
    })!;
    expect(entry.lines[0].account).toBe(ACCOUNTS.badDebt);
    expect(entry.lines[0].debitCents).toBe(8000);

    expect(journalForWriteOff(invoice)).toBeNull();
    expect(journalForWriteOff({
      ...invoice, status: "uncollectible", paidCents: 12900,
    })).toBeNull();
  });
});

describe("what the file looks like", () => {
  it("renders cents by integer arithmetic", () => {
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(5)).toBe("0.05");
    expect(formatAmount(100)).toBe("1.00");
    expect(formatAmount(12900)).toBe("129.00");
    expect(formatAmount(123456789)).toBe("1234567.89");
    expect(formatAmount(-2550)).toBe("-25.50");
  });

  it("renders the values floating division gets wrong", () => {
    // The reason this is not (cents / 100).toFixed(2): some values land a
    // hair below the rounding boundary and a ledger goes out by a penny.
    for (const cents of [1, 2, 3, 5, 7, 8, 29, 57, 8815, 100000000007]) {
      const [whole, fraction] = formatAmount(cents).split(".");
      expect(Number(whole) * 100 + Number(fraction), `${cents}`).toBe(cents);
    }
  });

  it("survives names that would break the file", () => {
    expect(csvField("Marisol Vance")).toBe("Marisol Vance");
    // Ordinary names, all of which break a naive writer.
    expect(csvField("Vance, Marisol")).toBe('"Vance, Marisol"');
    expect(csvField('The "Pest" People')).toBe('"The ""Pest"" People"');
    expect(csvField("Harborview\nFoods")).toBe('"Harborview\nFoods"');
  });

  it("writes a header, one row per line, and a trailing newline", () => {
    const csv = toJournalCsv([journalForInvoice(invoice)!]);
    const rows = csv.split("\n");
    expect(rows[0]).toBe("Date,Reference,Account,Name,Memo,Debit,Credit");
    expect(rows).toHaveLength(5); // header + three lines + trailing empty
    expect(csv.endsWith("\n")).toBe(true);
    // An empty cell, not a zero: a zero in a debit column reads as a posting.
    expect(rows[2].endsWith(",,120.00")).toBe(true);
  });

  it("keeps a comma in a name inside one field", () => {
    const csv = toJournalCsv([
      journalForInvoice({ ...invoice, customerName: "Vance, Marisol", taxCents: 0, totalCents: 12000 })!,
    ]);
    const dataRow = csv.split("\n")[1];
    expect(dataRow).toContain('"Vance, Marisol"');
    // Seven columns, not eight, despite the comma in the name.
    expect(dataRow.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g)).toHaveLength(6);
  });
});

describe("the whole file", () => {
  it("balances across every kind of entry", () => {
    const entries = [
      journalForInvoice(invoice)!,
      journalForInvoice({ ...invoice, number: "INV-3311", taxCents: 0, totalCents: 12000 })!,
      journalForPayment({
        invoiceNumber: "INV-3310", customerName: "Marisol Vance",
        receivedOn: "2026-03-02", amountCents: 5000, method: "card",
      }),
      journalForRefund({
        invoiceNumber: "INV-3310", customerName: "Marisol Vance",
        refundedOn: "2026-03-09", amountCents: 1500,
      }),
      journalForWriteOff({ ...invoice, number: "INV-3312", status: "uncollectible", paidCents: 0 })!,
    ];

    const totals = journalTotals(entries);
    expect(totals.entries).toBe(5);
    expect(totals.balanced).toBe(true);
    // The check an accountant makes first.
    expect(totals.debitCents).toBe(totals.creditCents);
    expect(totals.debitCents).toBeGreaterThan(0);
  });

  it("reports an empty export as balanced rather than broken", () => {
    const totals = journalTotals([]);
    expect(totals).toEqual({
      entries: 0, lines: 0, debitCents: 0, creditCents: 0, balanced: true,
    });
    expect(toJournalCsv([])).toBe("Date,Reference,Account,Name,Memo,Debit,Credit\n");
  });
});
