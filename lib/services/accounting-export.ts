/**
 * A general-journal export a bookkeeper can post (ADR-219).
 *
 * "QuickBooks sync" is a competitor row this product does not have, and
 * the API sync genuinely needs an Intuit account nobody has opened. But
 * the row was carrying a bare GAP with no gating reason attached, and most
 * of it does not need one: a file of balanced journal entries is what a
 * great many small shops actually hand their accountant, and every field
 * it needs is already in the invoice, payment and refund ledgers.
 *
 * SO THIS IS AN EXPORT, NOT A SYNC, and nothing here should be labelled
 * otherwise. Nothing is pushed anywhere; a person downloads a file and
 * imports it.
 *
 * THE INVARIANT THE WHOLE FILE EXISTS FOR: EVERY ENTRY BALANCES.
 *
 * An accountant's first act is to check that debits equal credits. A file
 * that does not balance is not "mostly right" — it is rejected at the
 * import screen, and if it is accepted anyway it silently corrupts a set
 * of books. Every entry is built as a balanced whole rather than assembled
 * from lines that are hoped to add up, and the totals are asserted.
 *
 * All arithmetic is in integer cents. Money in floating point drifts, and
 * a ledger that is out by a penny is out.
 */

/**
 * A default chart of accounts. Deliberately plain names rather than
 * numbers: every package numbers its accounts differently, and a
 * bookkeeper maps names at import in a minute. Numbers invented here
 * would look authoritative and be wrong everywhere.
 */
export const ACCOUNTS = {
  receivable: "Accounts Receivable",
  revenue: "Service Revenue",
  taxPayable: "Sales Tax Payable",
  undeposited: "Undeposited Funds",
  badDebt: "Bad Debt Expense",
} as const;

export interface JournalLine {
  account: string;
  debitCents: number;
  creditCents: number;
  memo: string;
}

export interface JournalEntry {
  /** YYYY-MM-DD. */
  date: string;
  reference: string;
  customerName: string;
  lines: JournalLine[];
}

export interface ExportInvoice {
  number: string;
  customerName: string;
  issuedOn: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  status: "draft" | "open" | "void" | "uncollectible";
}

export interface ExportPayment {
  invoiceNumber: string;
  customerName: string;
  receivedOn: string;
  amountCents: number;
  method: string;
}

export interface ExportRefund {
  invoiceNumber: string;
  customerName: string;
  refundedOn: string;
  amountCents: number;
}

export class UnbalancedEntry extends Error {}

function balanced(entry: JournalEntry): JournalEntry {
  const debits = entry.lines.reduce((sum, line) => sum + line.debitCents, 0);
  const credits = entry.lines.reduce((sum, line) => sum + line.creditCents, 0);
  if (debits !== credits) {
    // Built here rather than discovered at an import screen. If this ever
    // throws, the bug is in this file and not in the books.
    throw new UnbalancedEntry(
      `Entry ${entry.reference} does not balance: ${debits} in debits against `
      + `${credits} in credits. A journal file that does not balance is rejected, `
      + `and one that is accepted anyway corrupts a ledger.`,
    );
  }
  return entry;
}

/**
 * Raising an invoice: the customer owes us, we have earned revenue, and
 * the tax belongs to the tax authority rather than to us.
 *
 * A draft has not been issued and a void never existed, so neither posts —
 * returning null rather than a zero entry, because a zero-value row in a
 * journal is noise an accountant has to read and dismiss.
 */
export function journalForInvoice(invoice: ExportInvoice): JournalEntry | null {
  if (invoice.status === "draft" || invoice.status === "void") return null;
  if (invoice.issuedOn === null) return null;

  const lines: JournalLine[] = [
    {
      account: ACCOUNTS.receivable,
      debitCents: invoice.totalCents,
      creditCents: 0,
      memo: `Invoice ${invoice.number}`,
    },
    {
      account: ACCOUNTS.revenue,
      debitCents: 0,
      creditCents: invoice.subtotalCents,
      memo: `Invoice ${invoice.number}`,
    },
  ];
  // No tax, no tax line. An empty line is something to read and dismiss.
  if (invoice.taxCents > 0) {
    lines.push({
      account: ACCOUNTS.taxPayable,
      debitCents: 0,
      creditCents: invoice.taxCents,
      memo: `Tax on invoice ${invoice.number}`,
    });
  }

  return balanced({
    date: invoice.issuedOn,
    reference: invoice.number,
    customerName: invoice.customerName,
    lines,
  });
}

/**
 * Taking a payment: money arrives and the debt shrinks.
 *
 * Undeposited Funds rather than a bank account, because this product does
 * not know which bank the money landed in, and naming one would be a
 * guess an accountant then has to unpick.
 */
export function journalForPayment(payment: ExportPayment): JournalEntry {
  return balanced({
    date: payment.receivedOn,
    reference: payment.invoiceNumber,
    customerName: payment.customerName,
    lines: [
      {
        account: ACCOUNTS.undeposited,
        debitCents: payment.amountCents,
        creditCents: 0,
        memo: `Payment by ${payment.method} against ${payment.invoiceNumber}`,
      },
      {
        account: ACCOUNTS.receivable,
        debitCents: 0,
        creditCents: payment.amountCents,
        memo: `Payment against ${payment.invoiceNumber}`,
      },
    ],
  });
}

/** Giving it back: the mirror of a payment, never a negative payment. */
export function journalForRefund(refund: ExportRefund): JournalEntry {
  return balanced({
    date: refund.refundedOn,
    reference: refund.invoiceNumber,
    customerName: refund.customerName,
    lines: [
      {
        account: ACCOUNTS.receivable,
        debitCents: refund.amountCents,
        creditCents: 0,
        memo: `Refund against ${refund.invoiceNumber}`,
      },
      {
        account: ACCOUNTS.undeposited,
        debitCents: 0,
        creditCents: refund.amountCents,
        memo: `Refund against ${refund.invoiceNumber}`,
      },
    ],
  });
}

/**
 * Giving up on it: what is still owed becomes an expense rather than an
 * asset. Only what remains outstanding — a partly paid invoice written off
 * has already banked the part that was paid.
 */
export function journalForWriteOff(invoice: ExportInvoice): JournalEntry | null {
  if (invoice.status !== "uncollectible") return null;
  if (invoice.issuedOn === null) return null;
  const outstanding = invoice.totalCents - invoice.paidCents;
  if (outstanding <= 0) return null;

  return balanced({
    date: invoice.issuedOn,
    reference: invoice.number,
    customerName: invoice.customerName,
    lines: [
      {
        account: ACCOUNTS.badDebt,
        debitCents: outstanding,
        creditCents: 0,
        memo: `Written off: invoice ${invoice.number}`,
      },
      {
        account: ACCOUNTS.receivable,
        debitCents: 0,
        creditCents: outstanding,
        memo: `Written off: invoice ${invoice.number}`,
      },
    ],
  });
}

/**
 * Cents as an accountant reads them, by integer arithmetic.
 *
 * `(cents / 100).toFixed(2)` is the obvious version and it is wrong often
 * enough to matter: floating division puts some values a hair below the
 * rounding boundary, so a ledger goes out by a penny in a file nobody
 * re-adds by hand.
 */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${negative ? "-" : ""}${whole}.${String(remainder).padStart(2, "0")}`;
}

/**
 * One CSV field.
 *
 * A customer called `Vance, Marisol` breaks an unquoted file into the
 * wrong number of columns, and one called `The "Pest" People` breaks a
 * naively quoted one. Both are ordinary names, so both are handled rather
 * than assumed away.
 */
export function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

const HEADER = ["Date", "Reference", "Account", "Name", "Memo", "Debit", "Credit"];

/** The file. One row per line, entries in the order given. */
export function toJournalCsv(entries: readonly JournalEntry[]): string {
  const rows: string[] = [HEADER.join(",")];
  for (const entry of entries) {
    for (const line of entry.lines) {
      rows.push([
        entry.date,
        csvField(entry.reference),
        csvField(line.account),
        csvField(entry.customerName),
        csvField(line.memo),
        line.debitCents === 0 ? "" : formatAmount(line.debitCents),
        line.creditCents === 0 ? "" : formatAmount(line.creditCents),
      ].join(","));
    }
  }
  // A trailing newline: some importers drop the last row without one.
  return `${rows.join("\n")}\n`;
}

export interface JournalTotals {
  entries: number;
  lines: number;
  debitCents: number;
  creditCents: number;
  balanced: boolean;
}

/**
 * What the file says about itself, so a page can show it before anybody
 * downloads anything. Each entry balances by construction; this is the
 * whole-file check an accountant would do first.
 */
export function journalTotals(entries: readonly JournalEntry[]): JournalTotals {
  let debitCents = 0;
  let creditCents = 0;
  let lines = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      debitCents += line.debitCents;
      creditCents += line.creditCents;
      lines += 1;
    }
  }
  return {
    entries: entries.length,
    lines,
    debitCents,
    creditCents,
    balanced: debitCents === creditCents,
  };
}

export interface LedgerInvoice {
  id: string;
  accountId: string;
  number: string;
  issuedOn: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  status: ExportInvoice["status"];
}

export interface LedgerPayment {
  id: string;
  invoiceId: string;
  amountCents: number;
  method: string;
  receivedOn: string | null;
}

export interface LedgerRefund {
  paymentId: string;
  amountCents: number;
  refundedOn: string | null;
}

export interface Ledgers {
  invoices: readonly LedgerInvoice[];
  payments: readonly LedgerPayment[];
  refunds: readonly LedgerRefund[];
  /** Account id to customer name. */
  names: ReadonlyMap<string, string>;
}

/**
 * A day, however the driver handed it over.
 *
 * A date column arrives as a string from PostgREST and as a Date from the
 * local harness, and `String(new Date(...))` yields "Wed Jul 23 2025 ..."
 * rather than a day — which is a mistake this repository has now made
 * twice, once in a seed and once in a test assertion.
 */
export function isoDay(value: string | Date | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * Every entry a workspace's ledgers produce, in one place.
 *
 * Shared by the download route and by the suite that runs it against a
 * real seeded book: a mapping that only the route knew would be a mapping
 * only production ever exercised.
 */
export function journalFromLedgers(ledgers: Ledgers): JournalEntry[] {
  const nameOf = (accountId: string) => ledgers.names.get(accountId) ?? "Unknown customer";
  const invoiceById = new Map(ledgers.invoices.map((invoice) => [invoice.id, invoice]));
  // A refund names the PAYMENT it reverses, so reaching the invoice is two
  // hops rather than one.
  const invoiceIdByPayment = new Map(
    ledgers.payments.map((payment) => [payment.id, payment.invoiceId]),
  );

  const entries: JournalEntry[] = [];

  for (const row of ledgers.invoices) {
    const invoice: ExportInvoice = {
      number: row.number,
      customerName: nameOf(row.accountId),
      issuedOn: isoDay(row.issuedOn),
      subtotalCents: row.subtotalCents,
      taxCents: row.taxCents,
      totalCents: row.totalCents,
      paidCents: row.paidCents,
      status: row.status,
    };
    const raised = journalForInvoice(invoice);
    if (raised !== null) entries.push(raised);
    // A write-off is a SECOND entry, not a replacement: the invoice was
    // genuinely raised before it was given up on, and both facts post.
    const writtenOff = journalForWriteOff(invoice);
    if (writtenOff !== null) entries.push(writtenOff);
  }

  for (const payment of ledgers.payments) {
    const invoice = invoiceById.get(payment.invoiceId);
    const day = isoDay(payment.receivedOn);
    if (invoice === undefined || day === null) continue;
    entries.push(journalForPayment({
      invoiceNumber: invoice.number,
      customerName: nameOf(invoice.accountId),
      receivedOn: day,
      amountCents: payment.amountCents,
      method: payment.method,
    }));
  }

  for (const refund of ledgers.refunds) {
    const invoiceId = invoiceIdByPayment.get(refund.paymentId);
    const invoice = invoiceId === undefined ? undefined : invoiceById.get(invoiceId);
    const day = isoDay(refund.refundedOn);
    if (invoice === undefined || day === null) continue;
    entries.push(journalForRefund({
      invoiceNumber: invoice.number,
      customerName: nameOf(invoice.accountId),
      refundedOn: day,
      amountCents: refund.amountCents,
    }));
  }

  return entries;
}
