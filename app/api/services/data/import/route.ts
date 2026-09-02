import { z } from "zod";

import {
  CRM_ACCOUNT_COLUMNS,
  normalizeAccountEmail,
  normalizeAccountName,
  normalizeAccountPhone,
} from "@/lib/services/crm";
import { IMPORT_FIELDS, planImport, type ImportMapping, type ImportRow } from "@/lib/services/data-import";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Import a CSV of accounts, locations and contacts.
 *
 * Nothing is invented: every column must be mapped to a field this product
 * has or explicitly ignored, or the whole import is refused with the list.
 * A dry run returns exactly what a commit would do — rows to create,
 * duplicates of accounts already on file, invalid rows with their reasons
 * — and writes nothing. A commit writes accounts, then their locations and
 * contacts, and records what it did in `crm_imports`.
 */

const fieldEnum = z.enum([
  ...(IMPORT_FIELDS.map((field) => field.key) as [string, ...string[]]),
  "ignore",
]);

const schema = z
  .object({
    csv: z.string().min(1).max(2_000_000),
    mapping: z.record(z.string().min(1).max(200), fieldEnum),
    sourceLabel: z.string().trim().min(1).max(160).default("CSV import"),
    dryRun: z.boolean().default(true),
    allowDuplicates: z.boolean().default(false),
  })
  .strict();

type ExistingAccount = {
  id: string; name: string; name_normal: string | null; email_normal: string | null; phone_normal: string | null;
};

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = schema.parse(await readBoundedJson(request, 2_500_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;

    const plan = planImport(payload.csv, payload.mapping as ImportMapping);
    if (plan.unmapped.length > 0 || plan.unknownColumns.length > 0 || plan.missingRequired.length > 0) {
      return jsonNoStore(
        {
          error: {
            code: "mapping_incomplete",
            message: plan.unmapped.length > 0
              ? `Every column must be mapped or ignored before anything is imported. Unmapped: ${plan.unmapped.join(", ")}.`
              : plan.missingRequired.length > 0
                ? `A required field is not mapped: ${plan.missingRequired.join(", ")}.`
                : `The mapping names columns the file does not have: ${plan.unknownColumns.join(", ")}.`,
          },
          headers: plan.headers,
          unmapped: plan.unmapped,
          unknownColumns: plan.unknownColumns,
          missingRequired: plan.missingRequired,
        },
        { status: 422 },
      );
    }

    // Duplicates against the book: the database's own normals, read once.
    const existingRead = await client
      .from("crm_accounts")
      .select("id, name, name_normal, email_normal, phone_normal")
      .eq("organization_id", organizationId)
      .limit(20_000);
    if (existingRead.error) return databaseErrorResponse(existingRead.error);
    const existing = (existingRead.data ?? []) as ExistingAccount[];
    const byName = new Map<string, ExistingAccount>();
    const byEmail = new Map<string, ExistingAccount>();
    const byPhone = new Map<string, ExistingAccount>();
    for (const account of existing) {
      if (account.name_normal) byName.set(account.name_normal, account);
      if (account.email_normal) byEmail.set(account.email_normal, account);
      if (account.phone_normal) byPhone.set(account.phone_normal, account);
    }

    const creates: ImportRow[] = [];
    const duplicates: Array<{ line: number; name: string; matches: string; on: string }> = [];
    for (const row of plan.rows) {
      const nameNormal = normalizeAccountName(row.account.name);
      const emailNormal = normalizeAccountEmail(row.account.email);
      const phoneNormal = normalizeAccountPhone(row.account.phone);
      const match =
        (nameNormal && byName.get(nameNormal) && { on: "name", account: byName.get(nameNormal)! })
        || (emailNormal && byEmail.get(emailNormal) && { on: "email", account: byEmail.get(emailNormal)! })
        || (phoneNormal && byPhone.get(phoneNormal) && { on: "phone", account: byPhone.get(phoneNormal)! })
        || null;
      if (match && !payload.allowDuplicates) {
        duplicates.push({ line: row.line, name: row.account.name, matches: match.account.name, on: match.on });
        continue;
      }
      creates.push(row);
    }

    const summary = {
      rowCount: plan.rows.length + plan.invalid.length + plan.duplicatesInFile.length,
      wouldCreate: {
        accounts: creates.length,
        properties: creates.filter((row) => row.property !== null).length,
        contacts: creates.filter((row) => row.contact !== null).length,
      },
      duplicates,
      duplicatesInFile: plan.duplicatesInFile,
      invalid: plan.invalid,
    };

    if (payload.dryRun) {
      return jsonNoStore({ dryRun: true, ...summary });
    }

    // Commit: accounts first, in the file's order, then what hangs off them.
    let createdAccounts = 0;
    let createdProperties = 0;
    let createdContacts = 0;
    const BATCH = 200;
    for (let offset = 0; offset < creates.length; offset += BATCH) {
      const slice = creates.slice(offset, offset + BATCH);
      const inserted = await client
        .from("crm_accounts")
        .insert(slice.map((row) => ({ organization_id: organizationId, ...row.account, created_by: user.id })))
        .select(CRM_ACCOUNT_COLUMNS);
      if (inserted.error) return databaseErrorResponse(inserted.error);
      const ids = ((inserted.data ?? []) as Array<{ id: string }>).map((row) => row.id);
      createdAccounts += ids.length;

      const propertyRows = slice.flatMap((row, index) =>
        row.property === null || ids[index] === undefined
          ? []
          : [{ organization_id: organizationId, account_id: ids[index], label: row.property.label, address: row.property.address }]);
      if (propertyRows.length > 0) {
        const properties = await client.from("crm_properties").insert(propertyRows).select("id");
        if (properties.error) return databaseErrorResponse(properties.error);
        createdProperties += properties.data?.length ?? 0;
      }
      const contactRows = slice.flatMap((row, index) =>
        row.contact === null || ids[index] === undefined
          ? []
          : [{ organization_id: organizationId, account_id: ids[index], ...row.contact, is_primary: true }]);
      if (contactRows.length > 0) {
        const contacts = await client.from("crm_contacts").insert(contactRows).select("id");
        if (contacts.error) return databaseErrorResponse(contacts.error);
        createdContacts += contacts.data?.length ?? 0;
      }
    }

    const log = await client
      .from("crm_imports")
      .insert({
        organization_id: organizationId,
        source_label: payload.sourceLabel,
        mapping: payload.mapping,
        row_count: summary.rowCount,
        created_accounts: createdAccounts,
        created_properties: createdProperties,
        created_contacts: createdContacts,
        skipped_duplicates: duplicates.length + plan.duplicatesInFile.length,
        invalid_rows: plan.invalid.length,
        created_by: user.id,
      })
      .select("id, created_at")
      .single();
    if (log.error) return databaseErrorResponse(log.error);

    return jsonNoStore(
      {
        dryRun: false,
        importId: log.data.id,
        created: { accounts: createdAccounts, properties: createdProperties, contacts: createdContacts },
        ...summary,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_import", message: error.issues[0]?.message ?? "The import could not be read." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "crm_import_failed", message: "The import could not be run." } }, { status: 500 });
  }
}
