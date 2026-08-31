import {
  type ExportInvoice,
  journalFromLedgers,
  journalTotals,
  toJournalCsv,
} from "@/lib/services/accounting-export";
import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * A general-journal file for this workspace, built from its own ledgers
 * (ADR-219).
 *
 * THIS IS AN EXPORT, NOT A SYNC. Nothing is pushed to any accounting
 * package; a person downloads a file and imports it. The competitor row
 * this addresses asks for a QuickBooks *sync*, which needs an Intuit
 * account nobody has opened — but a balanced journal file is what a great
 * many small shops actually hand their accountant, and it needs nothing
 * external at all.
 *
 * Reads through the caller's own RLS-scoped session, so a workspace can
 * only ever export its own books.
 *
 * `format=csv` returns the file; the default returns the totals, so a page
 * can show what the file will contain — and whether it balances — before
 * anybody downloads anything.
 */

type InvoiceRow = {
  id: string;
  account_id: string;
  number: string;
  issued_on: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  status: ExportInvoice["status"];
};

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;

    /*
     * Four plain reads joined in memory rather than PostgREST embeddings.
     * The relationships here run through COMPOSITE foreign keys, and a
     * refund points at a PAYMENT rather than at an invoice — so the
     * embedding syntax would have to name constraints and traverse two
     * hops. Doing it here is a few more lines and no guesswork.
     */
    const invoices = await client
      .from("crm_invoices")
      .select("id, account_id, number, issued_on, subtotal_cents, tax_cents,"
        + " total_cents, paid_cents, status")
      .eq("organization_id", organizationId)
      .order("issued_on", { ascending: true })
      .limit(5000);
    if (invoices.error) throw invoices.error;
    const invoiceRows = (invoices.data ?? []) as unknown as InvoiceRow[];

    const accounts = await client
      .from("crm_accounts")
      .select("id, name")
      .eq("organization_id", organizationId)
      .limit(5000);
    if (accounts.error) throw accounts.error;
    const nameById = new Map(
      (accounts.data ?? []).map((row) => [row.id as string, row.name as string]),
    );
    const nameOf = (accountId: string) => nameById.get(accountId) ?? "Unknown customer";

    const payments = await client
      .from("crm_payments")
      .select("id, invoice_id, amount_cents, method, received_at")
      .eq("organization_id", organizationId)
      .order("received_at", { ascending: true })
      .limit(5000);
    if (payments.error) throw payments.error;

    const refunds = await client
      .from("crm_refunds")
      .select("payment_id, amount_cents, refunded_at")
      .eq("organization_id", organizationId)
      .order("refunded_at", { ascending: true })
      .limit(5000);
    if (refunds.error) throw refunds.error;

    /*
     * The mapping lives in the service, shared with the suite that runs it
     * against a real seeded book. A mapping only the route knew would be a
     * mapping only production ever exercised.
     */
    const entries = journalFromLedgers({
      invoices: invoiceRows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        number: row.number,
        issuedOn: row.issued_on,
        subtotalCents: Number(row.subtotal_cents),
        taxCents: Number(row.tax_cents),
        totalCents: Number(row.total_cents),
        paidCents: Number(row.paid_cents),
        status: row.status,
      })),
      payments: (payments.data ?? []).map((row) => ({
        id: row.id as string,
        invoiceId: row.invoice_id as string,
        amountCents: Number(row.amount_cents),
        method: String(row.method),
        receivedOn: row.received_at as string | null,
      })),
      refunds: (refunds.data ?? []).map((row) => ({
        paymentId: row.payment_id as string,
        amountCents: Number(row.amount_cents),
        refundedOn: row.refunded_at as string | null,
      })),
      names: nameById,
    });

    const totals = journalTotals(entries);

    if (new URL(request.url).searchParams.get("format") === "csv") {
      return new Response(toJournalCsv(entries), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="general-journal.csv"',
          "cache-control": "no-store",
        },
      });
    }

    return jsonNoStore({ totals });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      {
        error: {
          code: "crm_accounting_export_unavailable",
          message: "The accounting export could not be built.",
        },
      },
      { status: 500 },
    );
  }
}
