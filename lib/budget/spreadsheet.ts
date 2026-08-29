import { inflateRawSync } from "node:zlib";

/**
 * A spreadsheet reader for import, with no third-party parser behind it.
 *
 * An `.xlsx` file is a ZIP archive of XML parts, and both halves of that are
 * in the standard library already — `node:zlib` inflates the entries and the
 * parts we need are simple enough to read with bounded regular expressions.
 * Adding a parsing dependency to read a household's bank statements would put
 * a third party's code on the path of the most sensitive data in the product,
 * for a format this file handles in a few hundred lines.
 *
 * Everything here treats its input as hostile, because it is: an uploaded
 * file is attacker-controlled by definition. Entry counts, part sizes and the
 * total inflated size are all capped, so a small archive that claims to
 * expand into gigabytes is refused rather than served.
 */

/** Caps. A real export of twenty years of banking is a few megabytes. */
const MAX_ENTRIES = 512;
const MAX_PART_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_ROWS = 100_000;

export type SheetRow = readonly (string | number | null)[];

export type Sheet = {
  readonly name: string;
  readonly rows: readonly SheetRow[];
  /** Set when the sheet was cut short by MAX_ROWS, so a caller can say so. */
  readonly truncated: boolean;
};

export type WorkbookRead =
  | { readonly ok: true; readonly sheets: readonly Sheet[] }
  | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

type ZipEntry = { readonly name: string; readonly bytes: Buffer };

function readZip(buffer: Buffer): { ok: true; entries: ZipEntry[] } | { ok: false; reason: string } {
  // The end-of-central-directory record sits at the tail, after a comment of
  // at most 65535 bytes. Scan backwards for its signature.
  const signature = 0x06054b50;
  let eocd = -1;
  const from = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= from; index -= 1) {
    if (buffer.readUInt32LE(index) === signature) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: "not a readable .xlsx file (no ZIP directory)" };

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > MAX_ENTRIES) return { ok: false, reason: "workbook has too many parts" };
  if (directoryOffset >= buffer.length) return { ok: false, reason: "ZIP directory is out of range" };

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  let inflatedTotal = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length) return { ok: false, reason: "ZIP directory ends early" };
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      return { ok: false, reason: "ZIP directory entry is malformed" };
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    // Only the parts this reader actually uses are inflated. A workbook's
    // images, themes and printer settings are dead weight here, and skipping
    // them is also what keeps the size caps honest.
    if (!isWantedPart(name)) continue;
    if (uncompressedSize > MAX_PART_BYTES) return { ok: false, reason: `part too large: ${name}` };
    inflatedTotal += uncompressedSize;
    if (inflatedTotal > MAX_TOTAL_BYTES) return { ok: false, reason: "workbook expands too large" };

    if (localOffset + 30 > buffer.length) return { ok: false, reason: "ZIP entry is out of range" };
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      return { ok: false, reason: "ZIP entry header is malformed" };
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) return { ok: false, reason: "ZIP entry data is out of range" };

    const raw = buffer.subarray(dataStart, dataEnd);
    try {
      const bytes = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
      entries.push({ name, bytes });
    } catch {
      return { ok: false, reason: `could not decompress ${name}` };
    }
  }

  return { ok: true, entries };
}

function isWantedPart(name: string): boolean {
  return (
    name === "xl/workbook.xml" ||
    name === "xl/_rels/workbook.xml.rels" ||
    name === "xl/sharedStrings.xml" ||
    /^xl\/worksheets\/[^/]+\.xml$/.test(name)
  );
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (match) => XML_ENTITIES[match] ?? match);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Shared strings, in file order — a cell with `t="s"` indexes into this. */
function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const items = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>|<si\b[^>]*\/>/g);
  if (!items) return strings;
  for (const item of items) {
    // A styled string is split across runs; every <t> inside one <si> is one
    // string. Concatenating them is the whole of it.
    const parts = item.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g);
    if (!parts) {
      strings.push("");
      continue;
    }
    strings.push(
      parts
        .map((part) => decodeXmlText(part.replace(/^<t\b[^>]*>/, "").replace(/<\/t>$/, "")))
        .join(""),
    );
  }
  return strings;
}

/** Sheet name → part path, resolved through the workbook's relationships. */
function readSheetIndex(
  workbookXml: string,
  relsXml: string,
): readonly { readonly name: string; readonly path: string }[] {
  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attributes = match[1];
    const id = /\bId="([^"]+)"/.exec(attributes)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attributes)?.[1];
    if (!id || !target) continue;
    const normalized = target.replace(/^\/?xl\//, "").replace(/^\.\//, "");
    targets.set(id, `xl/${normalized}`);
  }

  const sheets: { name: string; path: string }[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attributes = match[1];
    const name = /\bname="([^"]*)"/.exec(attributes)?.[1];
    const relationId = /\br:id="([^"]+)"/.exec(attributes)?.[1];
    if (!name || !relationId) continue;
    const path = targets.get(relationId);
    if (!path) continue;
    sheets.push({ name: decodeXmlText(name), path });
  }
  return sheets;
}

/** "BC12" → 54. The column letters are base-26 with no zero. */
export function columnIndexFromRef(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference)?.[1];
  if (!letters) return 0;
  let index = 0;
  for (const character of letters) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function readSheet(xml: string, sharedStrings: readonly string[], name: string): Sheet {
  const rows: SheetRow[] = [];
  let truncated = false;

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const cells: (string | number | null)[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const column = reference ? columnIndexFromRef(reference) : cells.length;
      while (cells.length < column) cells.push(null);
      cells[column] = readCell(attributes, body, sharedStrings);
    }
    rows.push(cells);
  }

  return { name, rows, truncated };
}

function readCell(
  attributes: string,
  body: string,
  sharedStrings: readonly string[],
): string | number | null {
  const type = /\bt="([^"]+)"/.exec(attributes)?.[1] ?? "n";

  if (type === "inlineStr") {
    const parts = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g);
    if (!parts) return null;
    return parts
      .map((part) => decodeXmlText(part.replace(/^<t\b[^>]*>/, "").replace(/<\/t>$/, "")))
      .join("");
  }

  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (value === undefined) return null;

  if (type === "s") {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) return null;
    return sharedStrings[index];
  }
  if (type === "str" || type === "e") return decodeXmlText(value);
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : decodeXmlText(value);
}

/**
 * Read every sheet in an `.xlsx` workbook.
 *
 * Returns a reason rather than throwing: this runs on an uploaded file, and
 * the person who uploaded it needs to be told what was wrong with it.
 */
export function readWorkbook(buffer: Buffer): WorkbookRead {
  const zip = readZip(buffer);
  if (!zip.ok) return zip;

  const parts = new Map(zip.entries.map((entry) => [entry.name, entry.bytes.toString("utf8")]));
  const workbookXml = parts.get("xl/workbook.xml");
  const relsXml = parts.get("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return { ok: false, reason: "workbook is missing its index" };

  const sharedStrings = readSharedStrings(parts.get("xl/sharedStrings.xml") ?? "");
  const sheets: Sheet[] = [];
  for (const entry of readSheetIndex(workbookXml, relsXml)) {
    const xml = parts.get(entry.path);
    if (!xml) continue;
    sheets.push(readSheet(xml, sharedStrings, entry.name));
  }
  if (sheets.length === 0) return { ok: false, reason: "workbook contains no readable sheets" };
  return { ok: true, sheets };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Read a CSV export as one sheet.
 *
 * Handles quoted fields, embedded commas and newlines, and doubled quotes —
 * the parts a split on commas gets wrong on exactly the rows that matter, the
 * ones with a comma in the payee name.
 */
export function readCsv(text: string, name = "CSV"): Sheet {
  const rows: SheetRow[] = [];
  let cells: (string | number | null)[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;

  const push = () => {
    cells.push(field === "" ? null : field);
    field = "";
  };
  const endRow = () => {
    push();
    rows.push(cells);
    cells = [];
  };

  const body = text.replace(/^﻿/, "");
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quoted) {
      if (character === '"') {
        if (body[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      push();
    } else if (character === "\n") {
      endRow();
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (!truncated && (field !== "" || cells.length > 0)) endRow();

  return { name, rows, truncated };
}
