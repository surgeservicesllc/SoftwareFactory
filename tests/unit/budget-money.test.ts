// @vitest-environment node

import { describe, expect, it } from "vitest";

import { formatBps, formatCents, parseMoneyToCents, percentOf } from "@/lib/budget/money";

/**
 * Money is where a rounding shortcut becomes somebody's rent.
 *
 * The cases below are the ones that actually appear in bank exports, not
 * invented edge cases: accounting parentheses, currency symbols, thousands
 * separators, the non-breaking spaces Excel leaves behind, and blank cells
 * that must not read as zero.
 */

describe("parseMoneyToCents", () => {
  it("reads a plain number", () => {
    expect(parseMoneyToCents(93.26)).toEqual({ ok: true, cents: 9326 });
  });

  it("reads accounting parentheses as negative", () => {
    // "(93.26)" in the amount column means money left the account. Reading it
    // as positive would invert an entire expense column.
    expect(parseMoneyToCents("(93.26)")).toEqual({ ok: true, cents: -9326 });
    expect(parseMoneyToCents("$ (1,234.56)")).toEqual({ ok: true, cents: -123456 });
  });

  it("reads currency symbols and thousands separators", () => {
    expect(parseMoneyToCents("$5,123.00")).toEqual({ ok: true, cents: 512300 });
    expect(parseMoneyToCents("-775.00")).toEqual({ ok: true, cents: -77500 });
  });

  it("refuses a blank cell rather than calling it zero", () => {
    // A row that imports as $0.00 looks like data. A row that refuses to
    // import is visible, and that difference is the whole point.
    for (const blank of ["", "   ", "$", "$ -", "-", null, undefined]) {
      expect(parseMoneyToCents(blank).ok).toBe(false);
    }
  });

  it("refuses text that is not an amount", () => {
    expect(parseMoneyToCents("PENDING").ok).toBe(false);
    expect(parseMoneyToCents("n/a").ok).toBe(false);
    expect(parseMoneyToCents({}).ok).toBe(false);
  });

  it("refuses a figure larger than the column can hold", () => {
    expect(parseMoneyToCents(20_000_000_000).ok).toBe(false);
  });

  it("refuses infinity and NaN", () => {
    expect(parseMoneyToCents(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseMoneyToCents(Number.NaN).ok).toBe(false);
  });

  it("rounds half-cents rather than truncating them away", () => {
    expect(parseMoneyToCents(0.005)).toEqual({ ok: true, cents: 1 });
  });

  it("survives the float error the source spreadsheet carries", () => {
    // The workbook's running total column holds 5402.860000000001 after
    // eight thousand floating-point additions. As cents it is exact.
    expect(parseMoneyToCents(5402.860000000001)).toEqual({ ok: true, cents: 540286 });
  });
});

describe("formatCents", () => {
  it("shows an em dash for a missing figure, never $0.00", () => {
    // A missing figure and a zero figure mean different things. Showing one
    // as the other tells the reader something untrue.
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats negatives with the sign outside the currency symbol", () => {
    expect(formatCents(-123456)).toBe("-$1,234.56");
  });

  it("adds a plus only when asked", () => {
    expect(formatCents(512300)).toBe("$5,123.00");
    expect(formatCents(512300, { signed: true })).toBe("+$5,123.00");
  });

  it("drops the cents when asked for a whole figure", () => {
    expect(formatCents(512300, { whole: true })).toBe("$5,123");
  });
});

describe("formatBps", () => {
  it("renders basis points as a rate", () => {
    expect(formatBps(1899)).toBe("18.99%");
    expect(formatBps(0)).toBe("0.00%");
  });

  it("shows an em dash when no rate is recorded", () => {
    // An unrecorded rate is not a zero rate, and this is the display half of
    // that rule — the payoff order enforces the other half.
    expect(formatBps(null)).toBe("—");
  });
});

describe("percentOf", () => {
  it("computes a share", () => {
    expect(percentOf(320000, 500000)).toBe(64);
  });

  it("drops the float artifact rather than showing it", () => {
    // 92000 of 80000 is 115%. An unrounded division returns
    // 114.99999999999999, which is harmless in a bar width and embarrassing
    // in a number.
    expect(percentOf(92000, 80000)).toBe(115);
  });

  it("returns null rather than dividing by zero", () => {
    expect(percentOf(100, 0)).toBeNull();
    expect(percentOf(100, null)).toBeNull();
  });
});
