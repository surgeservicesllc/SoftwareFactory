import { z } from "zod";

import {
  CRM_INVOICE_COLUMNS,
  CRM_SETTABLE_INVOICE_STATUSES,
  isInvoiceOverdue,
  toInvoiceView,
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
 * Issue, void or write off one invoice.
 *
 * `paid` is not in the settable set: an invoice becomes paid because money
 * arrived, and the payment trigger says so. Asserting it here would be the
 * hard-coded success this codebase refuses. Voiding names a reason — a void
 * without one is an erasure, and the schema will not hold it.
 */

const paramsSchema = z.object({ invoiceId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    status: z.enum(CRM_SETTABLE_INVOICE_STATUSES),
    voidReason: z.string().trim().min(1).max(300).optional(),
    memo: z.string().trim().min(1).max(2000).nullable().optional(),
    dueOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => value.status !== "void" || typeof value.voidReason === "string", {
    message: "A void names its reason.",
  })
  .refine((value) => value.status === "void" || value.voidReason === undefined, {
    message: "A void reason belongs only to a void.",
  });

export async function PATCH(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_invoice_id", message: "The invoice id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = { status: payload.status };
    if (payload.memo !== undefined) changes.memo = payload.memo;
    if (payload.dueOn !== undefined) changes.due_on = payload.dueOn;
    if (payload.status === "void") {
      changes.voided_at = new Date().toISOString();
      changes.void_reason = payload.voidReason;
    } else {
      changes.voided_at = null;
      changes.void_reason = null;
    }
    // Issuing an invoice that never had a date gives it today's.
    if (payload.status === "open") changes.issued_on = new Date().toISOString().slice(0, 10);

    const { data, error } = await client
      .from("crm_invoices")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.invoiceId)
      .select(CRM_INVOICE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23514") {
        return jsonNoStore(
          {
            error: {
              code: "invoice_change_refused",
              message:
                "The ledger refused the change — an invoice cannot fall due before it is issued, and a void must name its reason.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "invoice_not_found", message: "No such invoice in this workspace." } },
        { status: 404 },
      );
    }
    const invoice = toInvoiceView(data as unknown as CrmInvoiceRow);
    return jsonNoStore({ invoice: { ...invoice, overdue: isInvoiceOverdue(invoice) } });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_invoice_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_invoice_not_updated", message: "The invoice could not be updated." } },
      { status: 500 },
    );
  }
}
