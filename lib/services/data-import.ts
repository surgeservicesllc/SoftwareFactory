import { CRM_ACCOUNT_KINDS, CRM_ACCOUNT_STATUSES } from "@/lib/services/crm";

/**
 * Importing a spreadsheet without inventing anything (ADR-230).
 *
 * HubSpot "creates new properties if I don't set everything correctly".
 * This importer does the opposite: every column in the file must be
 * explicitly mapped to a field this product already has, or explicitly
 * ignored, before a single row is considered — and a dry run says exactly
 * what would happen before anything is written.
 *
 * Everything here is pure: the parser, the mapping, the validation. The
 * route adds the two things only the database knows — which rows are
 * duplicates of accounts already on file, and the write itself.
 */

export const IMPORT_FIELDS = [
  { key: "account.name", label: "Account name", required: true },
  { key: "account.kind", label: "Account kind (residential / commercial)", required: false },
  { key: "account.status", label: "Account status (lead / prospect / customer / inactive)", required: false },
  { key: "account.email", label: "Account email", required: false },
  { key: "account.phone", label: "Account phone", required: false },
  { key: "account.source", label: "Source", required: false },
  { key: "account.billing_address", label: "Billing address", required: false },
  { key: "account.notes", label: "Account notes", required: false },
  { key: "property.label", label: "Service location label", required: false },
  { key: "property.address", label: "Service location address", required: false },
  { key: "contact.first_name", label: "Contact first name", required: false },
  { key: "contact.last_name", label: "Contact last name", required: false },
  { key: "contact.email", label: "Contact email", required: false },
  { key: "contact.phone", label: "Contact phone", required: false },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export type ImportMapping = Readonly<Record<string, ImportField | "ignore">>;

const FIELD_KEYS = new Set<string>(IMPORT_FIELDS.map((field) => field.key));
export function isImportField(value: string): value is ImportField {
  return FIELD_KEYS.has(value);
}

/**
 * RFC 4180: comma-separated, double-quoted fields with "" escapes, CRLF or
 * LF line endings, a trailing newline tolerated. No library, because the
 * whole grammar is forty lines and a dependency would be the bigger risk.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  // A leading byte-order mark is a spreadsheet's habit, not a column name.
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

export type ImportRow = {
  line: number;
  account: {
    name: string;
    kind: "residential" | "commercial";
    status: "lead" | "prospect" | "customer" | "inactive";
    email: string | null;
    phone: string | null;
    source: string | null;
    billing_address: string | null;
    notes: string | null;
  };
  property: { label: string; address: string } | null;
  contact: { first_name: string; last_name: string | null; email: string | null; phone: string | null } | null;
};

export type ImportPlan = {
  headers: string[];
  /** Columns present in the file that the mapping does not name at all. */
  unmapped: string[];
  /** Mapping keys that are not columns of the file. */
  unknownColumns: string[];
  missingRequired: ImportField[];
  rows: ImportRow[];
  invalid: Array<{ line: number; reason: string }>;
  /** Rows that duplicate an EARLIER row of the same file, by name/email/phone. */
  duplicatesInFile: Array<{ line: number; ofLine: number; on: string }>;
};

const PHONE = /^[0-9+() .\-]{7,32}$/;

function cell(cells: string[], index: number | undefined): string | null {
  if (index === undefined) return null;
  const value = (cells[index] ?? "").trim();
  return value.length === 0 ? null : value;
}

function bounded(value: string | null, max: number, what: string, problems: string[]): string | null {
  if (value === null) return null;
  if (value.length > max) problems.push(`${what} is longer than ${max} characters`);
  return value;
}

/**
 * The plan: what the file would become, and everything that is wrong with
 * it — before any duplicate check against the database and before any
 * write. Refuses to guess: an unmapped column stops the whole import.
 */
export function planImport(text: string, mapping: ImportMapping): ImportPlan {
  const parsed = parseCsv(text);
  const headers = (parsed[0] ?? []).map((header) => header.trim());
  const unmapped = headers.filter((header) => header.length > 0 && !(header in mapping));
  const unknownColumns = Object.keys(mapping).filter((column) => !headers.includes(column));
  const indexOf = new Map<ImportField, number>();
  for (const [column, field] of Object.entries(mapping)) {
    if (field === "ignore") continue;
    const index = headers.indexOf(column);
    if (index >= 0) indexOf.set(field, index);
  }
  const missingRequired = IMPORT_FIELDS.filter((field) => field.required && !indexOf.has(field.key)).map(
    (field) => field.key,
  );

  const rows: ImportRow[] = [];
  const invalid: ImportPlan["invalid"] = [];
  const duplicatesInFile: ImportPlan["duplicatesInFile"] = [];
  if (unmapped.length > 0 || unknownColumns.length > 0 || missingRequired.length > 0) {
    return { headers, unmapped, unknownColumns, missingRequired, rows, invalid, duplicatesInFile };
  }

  const seenName = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();

  parsed.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    const problems: string[] = [];
    const name = bounded(cell(cells, indexOf.get("account.name")), 200, "the account name", problems);
    if (name === null) problems.push("the account name is empty");

    const kindRaw = cell(cells, indexOf.get("account.kind"))?.toLowerCase() ?? "residential";
    if (!(CRM_ACCOUNT_KINDS as readonly string[]).includes(kindRaw)) {
      problems.push(`"${kindRaw}" is not an account kind (residential or commercial)`);
    }
    const statusRaw = cell(cells, indexOf.get("account.status"))?.toLowerCase() ?? "lead";
    if (!(CRM_ACCOUNT_STATUSES as readonly string[]).includes(statusRaw)) {
      problems.push(`"${statusRaw}" is not an account status`);
    }
    const email = bounded(cell(cells, indexOf.get("account.email")), 320, "the email", problems);
    if (email !== null && (email.indexOf("@") < 1 || email.length < 3)) problems.push(`"${email}" is not an email address`);
    const phone = bounded(cell(cells, indexOf.get("account.phone")), 32, "the phone", problems);
    if (phone !== null && !PHONE.test(phone)) problems.push(`"${phone}" is not a phone number`);
    const source = bounded(cell(cells, indexOf.get("account.source")), 120, "the source", problems);
    const billing = bounded(cell(cells, indexOf.get("account.billing_address")), 500, "the billing address", problems);
    const notes = bounded(cell(cells, indexOf.get("account.notes")), 4000, "the notes", problems);

    const propertyAddress = bounded(cell(cells, indexOf.get("property.address")), 500, "the service address", problems);
    const propertyLabel = bounded(cell(cells, indexOf.get("property.label")), 120, "the location label", problems);
    const property = propertyAddress === null
      ? null
      : { label: propertyLabel ?? "Service address", address: propertyAddress };
    if (propertyAddress === null && propertyLabel !== null) {
      problems.push("a location label was given without an address");
    }

    const firstName = bounded(cell(cells, indexOf.get("contact.first_name")), 100, "the contact's first name", problems);
    const lastName = bounded(cell(cells, indexOf.get("contact.last_name")), 100, "the contact's last name", problems);
    const contactEmail = bounded(cell(cells, indexOf.get("contact.email")), 320, "the contact email", problems);
    if (contactEmail !== null && contactEmail.indexOf("@") < 1) problems.push(`"${contactEmail}" is not an email address`);
    const contactPhone = bounded(cell(cells, indexOf.get("contact.phone")), 32, "the contact phone", problems);
    if (contactPhone !== null && !PHONE.test(contactPhone)) problems.push(`"${contactPhone}" is not a phone number`);
    const contactGiven = lastName !== null || contactEmail !== null || contactPhone !== null;
    if (firstName === null && contactGiven) problems.push("a contact was given without a first name");
    const contact = firstName === null
      ? null
      : { first_name: firstName, last_name: lastName, email: contactEmail, phone: contactPhone };

    if (problems.length > 0 || name === null) {
      invalid.push({ line, reason: problems.join("; ") });
      return;
    }

    const nameKey = name.toLowerCase().replace(/\s+/g, " ");
    const emailKey = email?.toLowerCase() ?? null;
    const phoneKey = phone?.replace(/[^0-9+]/g, "") ?? null;
    const earlier =
      (seenName.has(nameKey) && { ofLine: seenName.get(nameKey)!, on: "name" })
      || (emailKey !== null && seenEmail.has(emailKey) && { ofLine: seenEmail.get(emailKey)!, on: "email" })
      || (phoneKey !== null && seenPhone.has(phoneKey) && { ofLine: seenPhone.get(phoneKey)!, on: "phone" })
      || null;
    if (earlier) {
      duplicatesInFile.push({ line, ofLine: earlier.ofLine, on: earlier.on });
      return;
    }
    seenName.set(nameKey, line);
    if (emailKey !== null) seenEmail.set(emailKey, line);
    if (phoneKey !== null) seenPhone.set(phoneKey, line);

    rows.push({
      line,
      account: {
        name,
        kind: kindRaw as ImportRow["account"]["kind"],
        status: statusRaw as ImportRow["account"]["status"],
        email,
        phone,
        source,
        billing_address: billing,
        notes,
      },
      property,
      contact,
    });
  });

  return { headers, unmapped, unknownColumns, missingRequired, rows, invalid, duplicatesInFile };
}
