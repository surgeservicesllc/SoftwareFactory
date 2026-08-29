import { createHash } from "node:crypto";

import { parseMoneyToCents } from "@/lib/budget/money";
import type { Sheet, SheetRow } from "@/lib/budget/spreadsheet";

/**
 * Turning a bank export into ledger rows.
 *
 * The rule this module is built around: a row that cannot be read is
 * *reported*, never guessed. An import that silently drops a row, or files it
 * as $0.00, produces a ledger that looks complete and is not — and the whole
 * point of a running total is that it reconciles. So every skipped row is
 * counted and the reason travels back to the person importing.
 */

export type TransactionKind =
  | "deposit"
  | "debit"
  | "check"
  | "fee"
  | "atm_credit"
  | "transfer_in"
  | "transfer_out"
  | "adjustment";

export type ImportedTransaction = {
  readonly postedOn: string;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly amountCents: number;
  readonly balanceAfterCents: number | null;
  readonly contentHash: string;
};

export type ImportResult = {
  readonly transactions: readonly ImportedTransaction[];
  readonly rowsRead: number;
  readonly rowsSkipped: number;
  /** Human-readable, bounded, and never containing a row's own contents. */
  readonly notices: readonly string[];
};

export type ColumnMap = {
  readonly date: number;
  readonly kind: number;
  readonly description: number;
  readonly amount: number;
  readonly balance: number | null;
};

/** Excel leaves non-breaking spaces in exported text; they are still spaces. */
const WHITESPACE = /[\s ]+/g;

const HEADER_PATTERNS: Record<keyof ColumnMap, readonly RegExp[]> = {
  date: [/posted\s*date/i, /^date$/i, /transaction\s*date/i],
  kind: [/^type$/i, /transaction\s*type/i],
  description: [/description/i, /^payee$/i, /^memo$/i],
  amount: [/transaction\s*amount/i, /^amount$/i],
  balance: [/running\s*total/i, /^balance$/i],
};

/**
 * Find the header row and the columns that matter.
 *
 * Real exports do not start at A1 — this workbook's own sheets carry titles
 * and merged headings above the table — so the header is searched for rather
 * than assumed, within the first stretch of rows.
 */
export function detectColumns(
  sheet: Sheet,
):
  | { readonly ok: true; readonly headerRow: number; readonly columns: ColumnMap }
  | { readonly ok: false; readonly reason: string } {
  const limit = Math.min(sheet.rows.length, 30);
  for (let index = 0; index < limit; index += 1) {
    const row = sheet.rows[index];
    const found: Partial<Record<keyof ColumnMap, number>> = {};
    for (let column = 0; column < row.length; column += 1) {
      const cell = row[column];
      if (typeof cell !== "string") continue;
      for (const key of Object.keys(HEADER_PATTERNS) as (keyof ColumnMap)[]) {
        if (found[key] !== undefined) continue;
        if (HEADER_PATTERNS[key].some((pattern) => pattern.test(cell))) found[key] = column;
      }
    }
    if (found.description !== undefined && found.amount !== undefined) {
      return {
        ok: true,
        headerRow: index,
        columns: {
          date: found.date ?? -1,
          kind: found.kind ?? -1,
          description: found.description,
          amount: found.amount,
          balance: found.balance ?? null,
        },
      };
    }
  }
  return {
    ok: false,
    reason: "no header row found — the sheet needs a description column and an amount column",
  };
}

/** Excel's day zero is 1899-12-30: serial 1 is 1900-01-01, 1900 leap-year bug included. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/*
 * The plausible range for a date in a bank ledger, as Excel serials: 25569 is
 * 1970-01-01 and 73415 is 2100-01-01 — deliberately the same bounds the
 * `posted_on` column enforces, so the importer refuses exactly what the
 * database would refuse rather than discovering it one insert later.
 *
 * The bound is not decoration. The real workbook this was built against keeps
 * running counters in the same column as dates — values like 184 and 1721 —
 * and read as serials those become 1900-07-01 and 1904-09-16: dates that look
 * plausible enough to sort and chart, and are not dates at all. Anything
 * outside the range is treated as "no date here", which lets the row take the
 * date of the row above and be counted in the notice.
 */
const MIN_SERIAL = 25_569;
const MAX_SERIAL = 73_415;

export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const day = Math.floor(serial);
  if (day < MIN_SERIAL || day > MAX_SERIAL) return null;
  const date = new Date(EXCEL_EPOCH_MS + day * 86_400_000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function readCellDate(cell: string | number | null): string | null {
  if (typeof cell === "number") return excelSerialToIsoDate(cell);
  if (typeof cell !== "string") return null;
  const trimmed = cell.trim();
  if (trimmed === "") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(trimmed);
  if (slashed) {
    const year = Number(slashed[3]) < 100 ? 2000 + Number(slashed[3]) : Number(slashed[3]);
    const month = String(Number(slashed[1])).padStart(2, "0");
    const day = String(Number(slashed[2])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

/** Whitespace-collapsed and upper-cased, so the same payee hashes the same way. */
export function normalizeDescription(value: string): string {
  return value.replace(WHITESPACE, " ").trim().toUpperCase();
}

function tidy(value: string): string {
  return value.replace(WHITESPACE, " ").trim();
}

const KIND_BY_LABEL: Record<string, TransactionKind> = {
  deposit: "deposit",
  debit: "debit",
  check: "check",
  fee: "fee",
  "atm credit": "atm_credit",
  "atm debit": "debit",
  credit: "deposit",
  withdrawal: "debit",
};

/**
 * Classify a row.
 *
 * A move between the person's own accounts is not spending, and counting it
 * as spending overstates every expense total built on it — so transfers are
 * recognised by wording and typed distinctly. Sign always wins over label: a
 * row labelled Debit carrying a positive amount is a deposit, because the
 * amount is the fact and the label is a description of it. The database
 * enforces that agreement too, so a disagreement here is a failed insert
 * rather than a wrong total.
 */
export function classifyKind(
  label: unknown,
  amountCents: number,
  description: string,
): TransactionKind {
  if (amountCents === 0) return "adjustment";

  const normalized = normalizeDescription(description);
  if (/\bTRANSFER\b/.test(normalized)) {
    return amountCents > 0 ? "transfer_in" : "transfer_out";
  }

  const fromLabel =
    typeof label === "string" ? KIND_BY_LABEL[label.trim().toLowerCase()] : undefined;
  if (fromLabel) {
    const positive = amountCents > 0;
    const labelIsPositive = fromLabel === "deposit" || fromLabel === "atm_credit";
    if (positive === labelIsPositive) return fromLabel;
  }
  return amountCents > 0 ? "deposit" : "debit";
}

export function contentHash(
  accountId: string,
  postedOn: string,
  kind: TransactionKind,
  description: string,
  amountCents: number,
  occurrence: number,
): string {
  return createHash("sha256")
    .update(
      [
        accountId,
        postedOn,
        kind,
        normalizeDescription(description),
        String(amountCents),
        String(occurrence),
      ].join(" "),
    )
    .digest("hex");
}

/**
 * Read a sheet into transactions for one account.
 *
 * `occurrence` is what keeps the import idempotent without collapsing real
 * repeats: two identical charges on one day are the first and second
 * occurrence of that exact row, hash differently, and both survive — while a
 * second import of the same file reproduces the same ordinals and conflicts
 * on every row, as it should.
 */
export function readTransactions(
  sheet: Sheet,
  accountId: string,
  options: { readonly columns?: ColumnMap; readonly headerRow?: number } = {},
): ImportResult {
  let columns = options.columns;
  let headerRow = options.headerRow ?? -1;
  if (!columns) {
    const detected = detectColumns(sheet);
    if (!detected.ok) {
      return { transactions: [], rowsRead: 0, rowsSkipped: 0, notices: [detected.reason] };
    }
    columns = detected.columns;
    headerRow = detected.headerRow;
  }

  const transactions: ImportedTransaction[] = [];
  const occurrences = new Map<string, number>();
  const notices: string[] = [];
  let rowsRead = 0;
  let rowsSkipped = 0;
  let undated = 0;
  let unreadableAmounts = 0;
  let carriedDate: string | null = null;

  for (let index = headerRow + 1; index < sheet.rows.length; index += 1) {
    const row: SheetRow = sheet.rows[index];
    const rawDescription = row[columns.description];
    const description =
      typeof rawDescription === "string"
        ? tidy(rawDescription)
        : typeof rawDescription === "number"
          ? String(rawDescription)
          : "";

    const rawAmount = columns.amount >= 0 ? row[columns.amount] : null;
    const hasAnything = description !== "" || (rawAmount !== null && rawAmount !== undefined);
    if (!hasAnything) continue;

    rowsRead += 1;

    if (description === "") {
      rowsSkipped += 1;
      continue;
    }

    const amount = parseMoneyToCents(rawAmount);
    if (!amount.ok) {
      rowsSkipped += 1;
      unreadableAmounts += 1;
      continue;
    }

    const cellDate = columns.date >= 0 ? readCellDate(row[columns.date]) : null;
    if (cellDate) {
      carriedDate = cellDate;
    } else {
      undated += 1;
    }
    if (!carriedDate) {
      rowsSkipped += 1;
      continue;
    }
    const postedOn = cellDate ?? carriedDate;

    const kind = classifyKind(
      columns.kind >= 0 ? row[columns.kind] : null,
      amount.cents,
      description,
    );
    const key = `${postedOn}|${kind}|${normalizeDescription(description)}|${amount.cents}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);

    const balance = columns.balance !== null ? parseMoneyToCents(row[columns.balance]) : null;

    transactions.push({
      postedOn,
      kind,
      description: description.slice(0, 500),
      amountCents: amount.cents,
      balanceAfterCents: balance && balance.ok ? balance.cents : null,
      contentHash: contentHash(accountId, postedOn, kind, description, amount.cents, occurrence),
    });
  }

  if (undated > 0) {
    notices.push(
      `${undated} row${undated === 1 ? "" : "s"} carried no date and took the date of the row above.`,
    );
  }
  if (unreadableAmounts > 0) {
    notices.push(
      `${unreadableAmounts} row${unreadableAmounts === 1 ? "" : "s"} had an amount that could not be read and were skipped.`,
    );
  }
  if (sheet.truncated) {
    notices.push("The sheet was longer than the import limit and was read only in part.");
  }

  return { transactions, rowsRead, rowsSkipped, notices };
}
