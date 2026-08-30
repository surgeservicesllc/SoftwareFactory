import { z } from "zod";

import {
  CRM_INVOICE_COLUMNS,
  CRM_PAYMENT_COLUMNS,
  CRM_PAYMENT_METHODS,
  toInvoiceView,
  toPaymentView,
  type CrmInvoiceRow,
  type CrmPaymentRow,
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
 * Payments: money that moved. The table takes select and insert only — a
 * payment recorded in error is corrected by recording the opposite movement
 * as a refund, exactly as a ledger is corrected by a contra entry. There is
 * deliberately no PATCH and no DELETE here, and no grant that would let one
 * exist.
 *
 * Recording one settles its invoice and writes a `payment` event onto the
 * account timeline, both in the same transaction, both by trigger.
 */

const createSchema = z
  .object({
    invoiceId: z.string().uuid(),
    amountCents: z.number().int().positive().max(100_000_000_000),
    method: z.enum(CRM_PAYMENT_METHODS),
    reference: z.string().trim().min(1).max(120).nullish(),
    receivedAt: z.string().datetime().nullish(),
    note: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_payments")
      .select(CRM_PAYMENT_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("received_at", { ascending: false })
      .limit(300);
    if (error) return databaseErrorResponse(error);

    const payments = ((data ?? []) as unknown as CrmPaymentRow[]).map(toPaymentView);
    return jsonNoStore({
      payments,
      receivedCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_payments_unavailable", message: "Payments could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    // The account is the invoice's account. Taking it from the caller would
    // let a payment be filed against the wrong customer.
    const invoice = await client
      .from("crm_invoices")
      .select(CRM_INVOICE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.invoiceId)
      .maybeSingle();
    if (invoice.error) return databaseErrorResponse(invoice.error);
    if (!invoice.data) {
      return jsonNoStore(
        { error: { code: "invoice_not_found", message: "No such invoice in this workspace." } },
        { status: 404 },
      );
    }
    const target = toInvoiceView(invoice.data as unknown as CrmInvoiceRow);
    if (target.status === "void" || target.status === "draft") {
      return jsonNoStore(
        {
          error: {
            code: "invoice_not_payable",
            message:
              target.status === "void"
                ? "That invoice was voided; a void is part of the record and takes no payment."
                : "That invoice is still a draft — issue it before recording payment.",
          },
        },
        { status: 409 },
      );
    }

    const created = await client
      .from("crm_payments")
      .insert({
        organization_id: activeOrganization.id,
        account_id: target.accountId,
        invoice_id: target.id,
        amount_cents: payload.amountCents,
        method: payload.method,
        reference: payload.reference ?? null,
        received_at: payload.receivedAt ?? new Date().toISOString(),
        note: payload.note ?? null,
        created_by: user.id,
      })
      .select(CRM_PAYMENT_COLUMNS)
      .single();
    if (created.error) return databaseErrorResponse(created.error);

    // Read the invoice back: the trigger has just decided its paid total
    // and its status, and the caller should see what the ledger says.
    const settled = await client
      .from("crm_invoices")
      .select(CRM_INVOICE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", target.id)
      .maybeSingle();
    if (settled.error) return databaseErrorResponse(settled.error);

    return jsonNoStore(
      {
        payment: toPaymentView(created.data as unknown as CrmPaymentRow),
        invoice: settled.data ? toInvoiceView(settled.data as unknown as CrmInvoiceRow) : null,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_payment",
            message: error.issues[0]?.message ?? "The payment could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_payment_not_recorded", message: "The payment could not be recorded." } },
      { status: 500 },
    );
  }
}
