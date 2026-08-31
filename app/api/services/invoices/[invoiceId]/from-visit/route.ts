import { z } from "zod";

import {
  CRM_INVOICE_COLUMNS,
  CRM_INVOICE_LINE_COLUMNS,
  toInvoiceLineView,
  toInvoiceView,
  type CrmInvoiceLineRow,
  type CrmInvoiceRow,
} from "@/lib/services/crm";
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
 * Build a draft invoice's lines from the visit it bills (ADR-212).
 *
 * Every refusal the database makes here is a real one — an unfinished
 * visit, a visit already billed, a document the customer already holds —
 * so this route's job is to carry each one back as its own status and
 * message rather than flattening them into a 500. An operator who is told
 * "that visit is already billed on INV-1042" can act; one told "the
 * invoice could not be built" cannot.
 */

const paramsSchema = z.object({ invoiceId: z.string().uuid() }).strict();
const bodySchema = z.object({ workOrderId: z.string().uuid() }).strict();

/** The database's own words, mapped to a status the surface can act on. */
const REFUSALS: { pattern: RegExp; code: string; status: number }[] = [
  { pattern: /no such invoice/i, code: "invoice_not_found", status: 404 },
  { pattern: /no such work order/i, code: "work_order_not_found", status: 404 },
  { pattern: /a visit is billed after it happens/i, code: "visit_not_completed", status: 409 },
  { pattern: /already built from a visit/i, code: "invoice_already_built", status: 409 },
  { pattern: /already billed on invoice/i, code: "visit_already_billed", status: 409 },
  { pattern: /can no longer be rebuilt/i, code: "invoice_not_draft", status: 409 },
  { pattern: /different account than this invoice/i, code: "account_mismatch", status: 409 },
];

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_invoice_id", message: "The invoice id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = bodySchema.parse(await readBoundedJson(request, 4_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const built = await client.rpc("crm_invoice_lines_from_visit", {
      p_invoice: parsed.data.invoiceId,
      p_work_order: payload.workOrderId,
    });
    if (built.error) {
      const message = built.error.message ?? "";
      const refusal = REFUSALS.find((candidate) => candidate.pattern.test(message));
      if (refusal) {
        return jsonNoStore(
          { error: { code: refusal.code, message } },
          { status: refusal.status },
        );
      }
      return databaseErrorResponse(built.error);
    }

    // Re-read the invoice rather than computing its totals here: the
    // function already recomputed them, and a second arithmetic in this
    // file is a second chance to disagree with the document.
    const invoice = await client
      .from("crm_invoices")
      .select(CRM_INVOICE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.invoiceId)
      .single();
    if (invoice.error) return databaseErrorResponse(invoice.error);

    const lines = await client
      .from("crm_invoice_lines")
      .select(CRM_INVOICE_LINE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("invoice_id", parsed.data.invoiceId)
      .order("position", { ascending: true });
    if (lines.error) return databaseErrorResponse(lines.error);

    return jsonNoStore({
      invoice: toInvoiceView(invoice.data as unknown as CrmInvoiceRow),
      lines: ((lines.data ?? []) as unknown as CrmInvoiceLineRow[]).map(toInvoiceLineView),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_visit",
            message: error.issues[0]?.message ?? "A work order id is required.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_invoice_not_built", message: "The invoice could not be built." } },
      { status: 500 },
    );
  }
}
