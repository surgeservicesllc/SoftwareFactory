import { z } from "zod";

import {
  CRM_INVOICE_COLUMNS,
  CRM_PAYMENT_COLUMNS,
  CRM_REFUND_COLUMNS,
  toInvoiceView,
  toRefundView,
  type CrmInvoiceRow,
  type CrmPaymentRow,
  type CrmRefundRow,
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
 * Refunds: the contra entry. Append-only like the payments they credit.
 *
 * A refund can never exceed what was paid, and the rule is not enforced
 * here — a database trigger locks the payment, sums the refunds already
 * against it and refuses the excess, so two refunds racing each other
 * cannot together overdraw one payment. This route reports that refusal;
 * it does not attempt to pre-empt it.
 */

const createSchema = z
  .object({
    paymentId: z.string().uuid(),
    amountCents: z.number().int().positive().max(100_000_000_000),
    reason: z.string().trim().min(1).max(300),
    refundedAt: z.string().datetime().nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_refunds")
      .select(CRM_REFUND_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("refunded_at", { ascending: false })
      .limit(300);
    if (error) return databaseErrorResponse(error);

    const refunds = ((data ?? []) as unknown as CrmRefundRow[]).map(toRefundView);
    return jsonNoStore({
      refunds,
      refundedCents: refunds.reduce((sum, refund) => sum + refund.amountCents, 0),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_refunds_unavailable", message: "Refunds could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const payment = await client
      .from("crm_payments")
      .select(CRM_PAYMENT_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.paymentId)
      .maybeSingle();
    if (payment.error) return databaseErrorResponse(payment.error);
    if (!payment.data) {
      return jsonNoStore(
        { error: { code: "payment_not_found", message: "No such payment in this workspace." } },
        { status: 404 },
      );
    }
    const credited = payment.data as unknown as CrmPaymentRow;

    const created = await client
      .from("crm_refunds")
      .insert({
        organization_id: activeOrganization.id,
        payment_id: credited.id,
        amount_cents: payload.amountCents,
        reason: payload.reason,
        refunded_at: payload.refundedAt ?? new Date().toISOString(),
        created_by: user.id,
      })
      .select(CRM_REFUND_COLUMNS)
      .single();
    if (created.error) {
      // The guard raises a check_violation when the credit would overdraw.
      if (created.error.code === "23514") {
        return jsonNoStore(
          {
            error: {
              code: "refund_exceeds_payment",
              message: "That credit is larger than what remains of the payment it refunds.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(created.error);
    }

    // The refund may have reopened the invoice; report what the ledger says.
    const invoice = await client
      .from("crm_invoices")
      .select(CRM_INVOICE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", credited.invoice_id)
      .maybeSingle();
    if (invoice.error) return databaseErrorResponse(invoice.error);

    return jsonNoStore(
      {
        refund: toRefundView(created.data as unknown as CrmRefundRow),
        invoice: invoice.data ? toInvoiceView(invoice.data as unknown as CrmInvoiceRow) : null,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_refund",
            message: error.issues[0]?.message ?? "The refund could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_refund_not_recorded", message: "The refund could not be recorded." } },
      { status: 500 },
    );
  }
}
