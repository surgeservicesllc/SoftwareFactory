// @vitest-environment node

import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  classifyKind,
  contentHash,
  detectColumns,
  excelSerialToIsoDate,
  normalizeDescription,
  readCellDate,
  readTransactions,
} from "@/lib/budget/import";
import { columnIndexFromRef, readCsv, readWorkbook, type Sheet } from "@/lib/budget/spreadsheet";

/**
 * The importer, against the shapes a real bank export actually has.
 *
 * The cases here were taken from a twenty-year checking-account workbook:
 * a header that is not row one, dates missing on continuation rows, counters
 * sitting in the date column, accounting negatives, and repeated identical
 * charges on a single day.
 */

function sheet(rows: (string | number | null)[][], name = "Test"): Sheet {
  return { name, rows, truncated: false };
}

const HEADER = ["Posted Date", "Type", "Transaction Description", "Transaction Amount", "Running Total"];

describe("detectColumns", () => {
  it("finds the header even when it is not the first row", () => {
    const found = detectColumns(
      sheet([
        ["Household finances", null, null, null, null],
        [null, null, null, null, null],
        HEADER,
        [45900, "Debit", "PHONE BILL", -9900, 100000],
      ]),
    );
    expect(found).toEqual({
      ok: true,
      headerRow: 2,
      columns: { date: 0, kind: 1, description: 2, amount: 3, balance: 4 },
    });
  });

  it("refuses a sheet with no description or amount column", () => {
    const found = detectColumns(sheet([["Name", "Notes"], ["a", "b"]]));
    expect(found.ok).toBe(false);
  });
});

describe("excelSerialToIsoDate", () => {
  it("converts a real serial", () => {
    // 38503 is 2005-05-31 in Excel's calendar, day zero being 1899-12-30.
    expect(excelSerialToIsoDate(38503)).toBe("2005-05-31");
  });

  it("refuses a counter that would otherwise look like a plausible date", () => {
    /*
     * The source workbook keeps running counters in the same column as dates.
     * Read as serials, 184 and 1721 become 1900-07-01 and 1904-09-16 — dates
     * that sort and chart perfectly well and are not dates at all.
     */
    expect(excelSerialToIsoDate(184)).toBeNull();
    expect(excelSerialToIsoDate(1721)).toBeNull();
    expect(excelSerialToIsoDate(0)).toBeNull();
  });

  it("refuses a serial beyond the column's own bound", () => {
    expect(excelSerialToIsoDate(400_000)).toBeNull();
  });
});

describe("readCellDate", () => {
  it("reads ISO and US-slashed text", () => {
    expect(readCellDate("2026-09-04")).toBe("2026-09-04");
    expect(readCellDate("9/4/2026")).toBe("2026-09-04");
    expect(readCellDate("9/4/26")).toBe("2026-09-04");
  });

  it("returns null for anything else", () => {
    expect(readCellDate("")).toBeNull();
    expect(readCellDate("Sept")).toBeNull();
    expect(readCellDate(null)).toBeNull();
  });
});

describe("classifyKind", () => {
  it("types a move between the person's own accounts as a transfer", () => {
    // Counting a transfer as spending overstates every expense total built
    // on it, and counting it as income overstates the other side.
    expect(classifyKind("Debit", -2_000_000, "TRANSFER TO SAVINGS 0001")).toBe("transfer_out");
    expect(classifyKind("Deposit", 364_106, "TRANSFER FRM SAVINGS 0001")).toBe("transfer_in");
  });

  it("lets the amount's sign overrule a contradictory label", () => {
    // The amount is the fact; the label describes it. The database enforces
    // the same agreement, so disagreeing here would be a failed insert.
    expect(classifyKind("Debit", 4000, "REFUND")).toBe("deposit");
    expect(classifyKind("Deposit", -4000, "REVERSAL")).toBe("debit");
  });

  it("keeps a check a check and a fee a fee", () => {
    expect(classifyKind("Check", -6129, "CHECK NUMBER 181")).toBe("check");
    expect(classifyKind("Fee", -1200, "SERVICE FEE")).toBe("fee");
  });

  it("types a zero-amount row as an adjustment", () => {
    // The source sheet uses zero rows as placeholders. They cannot be a debit
    // — the sign constraint forbids it — and dropping them loses the row.
    expect(classifyKind("Debit", 0, "HOME DEPOT")).toBe("adjustment");
  });
});

describe("readTransactions", () => {
  it("leaves the trailing undated block out, because a plan is not history", () => {
    /*
     * A household ledger is usually kept with posted history at the top and a
     * forward plan underneath: payee and amount, deliberately no date, because
     * it has not happened. Carrying the date down into those turns a plan into
     * history — in the workbook this was built against, 914 such rows all
     * became one day and invented over a million dollars of activity in a
     * single month, which then dominated every chart drawn from it.
     */
    const result = readTransactions(
      sheet([
        HEADER,
        [45900, "Deposit", "PAYROLL", 512300, null],
        [45901, "Debit", "MORTGAGE", -123456, null],
        // Everything below is the forward plan: no date, to the end.
        [null, "Debit", "PLANNED CARD PAYMENT", -20000, null],
        [null, "Debit", "PLANNED UTILITIES", -9900, null],
        [null, "Deposit", "PLANNED PAYCHECK", 512300, null],
      ]),
      "account-1",
    );

    expect(result.transactions.map((t) => t.description)).toEqual(["PAYROLL", "MORTGAGE"]);
    expect(result.rowsSkipped).toBe(3);
    expect(result.notices).toContain(
      "3 rows after the last dated row carried no date and were left out as planned, not posted.",
    );
  });

  it("still carries a date down for a continuation row between dated rows", () => {
    // The other half of the rule: an undated row *inside* the posted history
    // means "same day as the line above", and that reading is still right.
    const result = readTransactions(
      sheet([
        HEADER,
        [45900, "Deposit", "PAYROLL", 512300, null],
        [null, "Debit", "SAME DAY CHARGE", -1000, null],
        [45901, "Debit", "NEXT DAY", -2000, null],
      ]),
      "account-1",
    );

    expect(result.transactions.map((t) => [t.description, t.postedOn])).toEqual([
      ["PAYROLL", "2025-08-31"],
      ["SAME DAY CHARGE", "2025-08-31"],
      ["NEXT DAY", "2025-09-01"],
    ]);
    expect(result.notices).toContain(
      "1 row carried no date and took the date of the row above.",
    );
  });

  it("imports only the chosen window, and says what it left out", () => {
    const rows = [
      HEADER,
      [45900, "Deposit", "OLD PAYROLL", 512300, null],
      [46000, "Debit", "IN WINDOW", -9900, null],
      [46100, "Debit", "TOO NEW", -1000, null],
    ];
    const result = readTransactions(sheet(rows), "account-1", {
      from: "2025-11-01",
      to: "2026-02-28",
    });

    expect(result.transactions.map((t) => t.description)).toEqual(["IN WINDOW"]);
    expect(result.notices).toContain(
      "2 rows fell outside the chosen dates (2025-11-01 to 2026-02-28) and were not imported.",
    );
  });

  it("judges a continuation row on the date it inherits, not the blank cell", () => {
    /*
     * The window is applied after the date is resolved. Filtering on the raw
     * cell would drop a row that belongs inside the window purely because its
     * own date cell is empty.
     */
    const result = readTransactions(
      sheet([
        HEADER,
        [46000, "Deposit", "DATED", 512300, null],
        [null, "Debit", "SAME DAY, NO DATE CELL", -9900, null],
        [46100, "Debit", "LATER", -1000, null],
      ]),
      "account-1",
      { from: "2025-12-01", to: "2025-12-31" },
    );

    expect(result.transactions.map((t) => t.description)).toEqual([
      "DATED",
      "SAME DAY, NO DATE CELL",
    ]);
  });

  it("counts a row it cannot read rather than importing it as zero", () => {
    const result = readTransactions(
      sheet([
        HEADER,
        [45900, "Deposit", "PAYROLL", 512300, 512300],
        [45901, "Debit", "PENDING CHARGE", "n/a", null],
      ]),
      "account-1",
    );
    expect(result.transactions).toHaveLength(1);
    expect(result.rowsSkipped).toBe(1);
    expect(result.notices).toContain(
      "1 row had an amount that could not be read and were skipped.",
    );
  });

  it("keeps two identical charges on one day, with different hashes", () => {
    const result = readTransactions(
      sheet([
        HEADER,
        [45900, "Debit", "STORE CARD", -14000, null],
        [45900, "Debit", "STORE CARD", -14000, null],
      ]),
      "account-1",
    );
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].contentHash).not.toBe(result.transactions[1].contentHash);
  });

  it("produces the same hashes when the same file is read again", () => {
    // This is what makes a re-import a no-op instead of a doubled ledger.
    const rows = [
      HEADER,
      [45900, "Debit", "STORE CARD", -14000, null],
      [45900, "Debit", "STORE CARD", -14000, null],
      [45901, "Deposit", "PAYROLL", 512300, null],
    ];
    const first = readTransactions(sheet(rows), "account-1");
    const second = readTransactions(sheet(rows), "account-1");
    expect(first.transactions.map((t) => t.contentHash)).toEqual(
      second.transactions.map((t) => t.contentHash),
    );
  });

  it("hashes the same row differently for a different account", () => {
    const rows = [HEADER, [45900, "Debit", "STORE CARD", -14000, null]];
    const a = readTransactions(sheet(rows), "account-1");
    const b = readTransactions(sheet(rows), "account-2");
    expect(a.transactions[0].contentHash).not.toBe(b.transactions[0].contentHash);
  });

  it("reads accounting negatives and keeps the stated balance as evidence", () => {
    const result = readTransactions(
      sheet([HEADER, ["9/4/2026", "Debit", "HOME MORTGAGE", "$ (1,234.56)", "$999.44"]]),
      "account-1",
    );
    expect(result.transactions[0]).toMatchObject({
      postedOn: "2026-09-04",
      kind: "debit",
      amountCents: -123456,
      balanceAfterCents: 99944,
    });
  });

  it("normalizes the non-breaking spaces an export leaves behind", () => {
    const result = readTransactions(
      sheet([HEADER, [45900, "Deposit", "EXAMPLE CORP\u00a0 DIR DEP\u00a0", 512300, null]]),
      "account-1",
    );
    expect(result.transactions[0].description).toBe("EXAMPLE CORP DIR DEP");
  });

  it("says so when the sheet was longer than the reader's limit", () => {
    const result = readTransactions(
      { name: "Big", rows: [HEADER, [45900, "Deposit", "PAYROLL", 100, null]], truncated: true },
      "account-1",
    );
    expect(result.notices).toContain(
      "The sheet was longer than the import limit and was read only in part.",
    );
  });
});

describe("normalizeDescription and contentHash", () => {
  it("treats spacing and case as the same payee", () => {
    expect(normalizeDescription("  Car   Loan ")).toBe("CAR LOAN");
  });

  it("produces a 64-character hex digest the column will accept", () => {
    const hash = contentHash("account-1", "2026-09-04", "debit", "CAR LOAN", -25000, 1);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// The readers themselves
// ---------------------------------------------------------------------------

describe("readCsv", () => {
  it("keeps a comma inside a quoted payee", () => {
    // Splitting on commas gets this wrong on exactly the rows that matter.
    const parsed = readCsv('Date,Description,Amount\n2026-09-04,"EXAMPLE CORP, INC.",5123.00\n');
    expect(parsed.rows[1]).toEqual(["2026-09-04", "EXAMPLE CORP, INC.", "5123.00"]);
  });

  it("reads a doubled quote as one quote", () => {
    const parsed = readCsv('a,b\n1,"say ""hi"""\n');
    expect(parsed.rows[1][1]).toBe('say "hi"');
  });

  it("reads an empty field as null rather than an empty string", () => {
    const parsed = readCsv("a,b,c\n1,,3\n");
    expect(parsed.rows[1]).toEqual(["1", null, "3"]);
  });
});

describe("columnIndexFromRef", () => {
  it("reads base-26 column letters", () => {
    expect(columnIndexFromRef("A1")).toBe(0);
    expect(columnIndexFromRef("Z9")).toBe(25);
    expect(columnIndexFromRef("AA1")).toBe(26);
    expect(columnIndexFromRef("BC12")).toBe(54);
  });
});

/** A minimal .xlsx: a ZIP of the four parts the reader looks at. */
function makeWorkbook(parts: Record<string, string>): Buffer {
  const entries: { name: string; local: Buffer; offset: number; compressed: Buffer; size: number }[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;

  for (const [name, xml] of Object.entries(parts)) {
    const raw = Buffer.from(xml, "utf8");
    const compressed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    entries.push({ name, local, offset, compressed, size: raw.length });
    chunks.push(local, nameBytes, compressed);
    offset += local.length + nameBytes.length + compressed.length;
  }

  const directoryOffset = offset;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(entry.compressed.length, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(entry.offset, 42);
    chunks.push(central, nameBytes);
    offset += central.length + nameBytes.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - directoryOffset, 12);
  end.writeUInt32LE(directoryOffset, 16);
  chunks.push(end);

  return Buffer.concat(chunks);
}

describe("readWorkbook", () => {
  const workbook = () =>
    makeWorkbook({
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="Checking" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml":
        "<sst><si><t>Transaction Description</t></si><si><r><t>EXAMPLE CORP, </t></r><r><t>INC.</t></r></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2" t="inlineStr"><is><t>inline</t></is></c></row>' +
        "</sheetData></worksheet>",
    });

  it("reads sheet names, shared strings and cell types", () => {
    const result = readWorkbook(workbook());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe("Checking");
    expect(result.sheets[0].rows[0]).toEqual(["Transaction Description", 42]);
    // A styled string is split across runs; the parts are one string.
    expect(result.sheets[0].rows[1][0]).toBe("EXAMPLE CORP, INC.");
    // A gap in the row is a gap, not a shifted column.
    expect(result.sheets[0].rows[1][1]).toBeNull();
    expect(result.sheets[0].rows[1][2]).toBe("inline");
  });

  it("refuses something that is not a ZIP at all", () => {
    const result = readWorkbook(Buffer.from("this is not a spreadsheet"));
    expect(result).toEqual({ ok: false, reason: "not a readable .xlsx file (no ZIP directory)" });
  });

  it("refuses a ZIP with no workbook index", () => {
    const result = readWorkbook(makeWorkbook({ "xl/sharedStrings.xml": "<sst/>" }));
    expect(result.ok).toBe(false);
  });
});
