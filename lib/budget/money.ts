/**
 * Money, as integer cents.
 *
 * The spreadsheets this replaces carry running totals like
 * `5402.860000000001` — the accumulated error of eight thousand binary
 * floating-point additions. Every figure in this product is an integer number
 * of cents for exactly that reason, and the only place a fractional number is
 * allowed to exist is at the boundary where a person types one.
 *
 * Nothing here rounds silently in a way that loses money: `parseMoneyToCents`
 * refuses input it cannot read rather than guessing zero, because a row that
 * imports as $0.00 is worse than a row that refuses to import — the first
 * looks like data.
 */

/** The largest figure any column accepts, matching the database's own bound. */
export const MAX_CENTS = 1_000_000_000_000;

export type MoneyParse =
  | { readonly ok: true; readonly cents: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Read a spreadsheet cell as cents.
 *
 * Accepts what real exports actually contain: plain numbers, currency
 * symbols, thousands separators, a trailing or leading minus, and accounting
 * parentheses — `(93.26)` is negative ninety-three dollars and twenty-six
 * cents, and reading it as positive would invert a household's entire expense
 * column.
 */
export function parseMoneyToCents(raw: unknown): MoneyParse {
  if (raw === null || raw === undefined) return { ok: false, reason: "empty" };

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "not a finite number" };
    return boundedCents(Math.round(raw * 100));
  }

  if (typeof raw !== "string") return { ok: false, reason: "not a number or text" };

  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "$" || trimmed === "$ -") {
    return { ok: false, reason: "empty" };
  }

  /*
   * Symbols come off before the parentheses are looked for, because a real
   * export writes the accounting negative as `$ (1,234.56)` — currency symbol
   * outside the bracket. Testing for brackets first misses that form entirely,
   * and the row then reads as unparseable or, worse, as positive.
   *
   * `\s` does not cover the non-breaking space Excel leaves in exported text,
   * so it is named explicitly.
   */
  const stripped = trimmed.replace(/[$\s\u00a0]/g, "");
  const parenthesised = /^\(.*\)$/.test(stripped);
  const body = parenthesised ? stripped.slice(1, -1) : stripped;

  // Thousands separators last, keeping sign and decimal point.
  const cleaned = body.replace(/,/g, "");
  if (cleaned === "" || cleaned === "-") return { ok: false, reason: "empty" };
  if (!/^[+-]?\d*\.?\d*$/.test(cleaned)) return { ok: false, reason: `unreadable amount: ${raw}` };
  if (!/\d/.test(cleaned)) return { ok: false, reason: `unreadable amount: ${raw}` };

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, reason: `unreadable amount: ${raw}` };

  const signed = parenthesised ? -Math.abs(value) : value;
  return boundedCents(Math.round(signed * 100));
}

function boundedCents(cents: number): MoneyParse {
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: "amount out of range" };
  if (cents > MAX_CENTS || cents < -MAX_CENTS) return { ok: false, reason: "amount out of range" };
  return { ok: true, cents };
}

/**
 * Format cents for display.
 *
 * `null` formats as an em dash, never as `$0.00`. A missing figure and a zero
 * figure mean different things, and a budget that shows one as the other
 * tells its reader something untrue.
 */
export function formatCents(
  cents: number | null | undefined,
  options: { readonly signed?: boolean; readonly whole?: boolean } = {},
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";

  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: options.whole ? 0 : 2,
    maximumFractionDigits: options.whole ? 0 : 2,
  }).format(absolute / 100);

  if (negative) return `-${formatted}`;
  return options.signed ? `+${formatted}` : formatted;
}

/** Basis points as a rate for display: 1899 → "18.99%". */
export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * A percentage of a whole, guarded against the zero denominator.
 *
 * Rounded to four decimal places, which is far finer than anything displays
 * and coarse enough to drop the float artifact: 92000 of 80000 is 115%, and
 * an unrounded division returns 114.99999999999999. That value is harmless in
 * a bar's width and embarrassing in a number, and the same rounding removes
 * both cases at once.
 */
export function percentOf(part: number, whole: number | null | undefined): number | null {
  if (whole === null || whole === undefined || whole <= 0) return null;
  return Math.round(((part / whole) * 100 + Number.EPSILON) * 10_000) / 10_000;
}
