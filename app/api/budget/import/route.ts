import { readTransactions } from "@/lib/budget/import";
import { readCsv, readWorkbook, type Sheet } from "@/lib/budget/spreadsheet";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Import a bank export into one account's ledger.
 *
 * The file never leaves this request: it is parsed in memory, written as
 * rows, and dropped. Nothing is stored on disk, nothing is sent anywhere, and
 * the file's own bytes are never logged.
 *
 * Re-importing the same file is safe by construction. Every row carries a
 * content hash unique per person, so a second import conflicts row by row and
 * is reported as skipped rather than doubling the ledger — which means a
 * partial import can simply be run again.
 */

/** A generous bound for twenty years of banking, and a firm one. */
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
/** Postgres has a parameter ceiling; batches keep one statement under it. */
const INSERT_BATCH = 500;

type ImportedRow = {
  organization_id: string;
  user_id: string;
  account_id: string;
  import_batch_id: string;
  posted_on: string;
  kind: string;
  description: string;
  amount_cents: number;
  balance_after_cents: number | null;
  content_hash: string;
};

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const form = await request.formData().catch(() => null);
    if (!form) {
      throw new ApiRequestError(400, "not_a_file_upload", "Attach a spreadsheet to import.");
    }
    const file = form.get("file");
    const accountId = String(form.get("accountId") ?? "");
    const requestedSheet = form.get("sheet") ? String(form.get("sheet")) : null;
    const dateBound = (field: string): string | null => {
      const raw = form.get(field);
      if (!raw) return null;
      const value = String(raw).trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    };
    const from = dateBound("from");
    const to = dateBound("to");

    if (!(file instanceof File)) {
      throw new ApiRequestError(400, "no_file", "Attach a .xlsx or .csv export to import.");
    }
    if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
      throw new ApiRequestError(400, "no_account", "Choose which account this file belongs to.");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiRequestError(413, "file_too_large", "That file is larger than the 24 MB limit.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";

    let sheets: readonly Sheet[];
    if (isCsv) {
      sheets = [readCsv(buffer.toString("utf8"), file.name)];
    } else {
      const workbook = readWorkbook(buffer);
      if (!workbook.ok) {
        throw new ApiRequestError(422, "unreadable_file", workbook.reason);
      }
      sheets = workbook.sheets;
    }

    const sheet = requestedSheet
      ? sheets.find((candidate) => candidate.name === requestedSheet)
      : sheets[0];
    if (!sheet) {
      throw new ApiRequestError(
        422,
        "sheet_not_found",
        `That workbook has no sheet named "${requestedSheet}".`,
      );
    }

    const parsed = readTransactions(sheet, accountId, { from, to });
    if (parsed.transactions.length === 0) {
      return jsonNoStore(
        {
          error: {
            code: "nothing_to_import",
            message:
              parsed.notices[0] ??
              "No transactions were found on that sheet. Check that it has a description column and an amount column.",
          },
          sheets: sheets.map((candidate) => candidate.name),
        },
        { status: 422 },
      );
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();

    // The account must be this person's before a batch is opened against it.
    // RLS would refuse the rows anyway; refusing here means an unusable batch
    // row is never written in the first place.
    const { data: account, error: accountError } = await client
      .from("budget_accounts")
      .select("id, name")
      .eq("id", accountId)
      .eq("organization_id", activeOrganization.id)
      .maybeSingle();
    if (accountError) return databaseErrorResponse(accountError);
    if (!account) {
      throw new ApiRequestError(404, "account_not_found", "That account is not yours to import into.");
    }

    const { data: batch, error: batchError } = await client
      .from("budget_import_batches")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        account_id: accountId,
        source_name: file.name.slice(0, 260),
        sheet_name: sheet.name.slice(0, 200),
        rows_read: parsed.rowsRead,
        rows_imported: 0,
        rows_skipped: parsed.rowsSkipped,
        notice: parsed.notices.join(" ").slice(0, 4000) || null,
      })
      .select("id")
      .single();
    if (batchError) return databaseErrorResponse(batchError);

    const rows: ImportedRow[] = parsed.transactions.map((transaction) => ({
      organization_id: activeOrganization.id,
      user_id: user.id,
      account_id: accountId,
      import_batch_id: batch.id as string,
      posted_on: transaction.postedOn,
      kind: transaction.kind,
      description: transaction.description,
      amount_cents: transaction.amountCents,
      balance_after_cents: transaction.balanceAfterCents,
      content_hash: transaction.contentHash,
    }));

    let imported = 0;
    const failures: string[] = [];
    for (let index = 0; index < rows.length; index += INSERT_BATCH) {
      const slice = rows.slice(index, index + INSERT_BATCH);
      /*
       * `ignoreDuplicates` on the person's content-hash key is what makes a
       * re-import a no-op instead of an error. The rows that land are the new
       * ones; the rest are already there, which is the correct outcome and
       * not a failure to report as one.
       */
      const { data, error } = await client
        .from("budget_transactions")
        .upsert(slice, { onConflict: "organization_id,user_id,content_hash", ignoreDuplicates: true })
        .select("id");
      if (error) {
        failures.push(error.message);
        break;
      }
      imported += data?.length ?? 0;
    }

    const skipped = parsed.rowsSkipped + (parsed.transactions.length - imported);
    const notices = [...parsed.notices];
    if (parsed.transactions.length - imported > 0) {
      notices.push(
        `${parsed.transactions.length - imported} row${
          parsed.transactions.length - imported === 1 ? " was" : "s were"
        } already in this account and were left as they are.`,
      );
    }
    if (failures.length > 0) {
      notices.push("The import stopped early; run it again to continue where it left off.");
    }

    await client
      .from("budget_import_batches")
      .update({
        rows_imported: imported,
        rows_skipped: Math.min(skipped, parsed.rowsRead),
        notice: notices.join(" ").slice(0, 4000) || null,
      })
      .eq("id", batch.id);

    return jsonNoStore(
      {
        batchId: batch.id,
        sheet: sheet.name,
        sheets: sheets.map((candidate) => candidate.name),
        rowsRead: parsed.rowsRead,
        rowsImported: imported,
        rowsSkipped: skipped,
        notices,
        // An import that stopped early says so rather than reporting success.
        complete: failures.length === 0,
      },
      { status: failures.length === 0 ? 201 : 207 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_import_failed", message: "The file could not be imported." } },
      { status: 500 },
    );
  }
}
