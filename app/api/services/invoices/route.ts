import { z } from "zod";

import {
  CRM_INVOICE_COLUMNS,
  CRM_INVOICE_LINE_COLUMNS,
  isInvoiceOverdue,
  toInvoiceView,
  toInvoiceLineView,
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
 * Invoices: what is owed, and what the ledger says has been settled. The
 * paid total and the `paid` status are the database's to decide — they are
 * maintained by the payment triggers and are read-only here. A caller
 * raises an invoice; only money marks one paid.
 */

const lineSchema = z
  .object({
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(100_000),
    unitPriceCents: z.number().int().min(0).max(100_000_000_000),
  })
  .strict();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    contractId: z.string().uuid().nullish(),
    workOrderId: z.string().uuid().nullish(),
    number: z.string().trim().min(3).max(40),
    taxCents: z.number().int().min(0).max(100_000_000_000).default(0),
    issuedOn: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullish(),
    dueOn: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullish(),
    memo: z.string().trim().min(1).max(2000).nullish(),
    lines: z.array(lineSchema).min(1).max(500),
    /** Raise it straight to the customer, rather than keeping a draft. */
    issue: z.boolean().default(true),
  })
  .strict()
  .refine((value) => !value.dueOn || !value.issuedOn || value.dueOn >= value.issuedOn, {
    message: "An invoice cannot fall due before it is issued.",
  });

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_invoices")
      .select(CRM_INVOICE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("issued_on", { ascending: false, nullsFirst: false })
      .limit(300);
    if (error) return databaseErrorResponse(error);

    const invoices = ((data ?? []) as unknown as CrmInvoiceRow[]).map(toInvoiceView);
    const lineRows =
      invoices.length === 0
        ? { data: [], error: null }
        : await client
            .from("crm_invoice_lines")
            .select(CRM_INVOICE_LINE_COLUMNS)
            .eq("organization_id", activeOrganization.id)
            .in(
              "invoice_id",
              invoices.map((invoice) => invoice.id),
            )
            .order("position", { ascending: true })
            .limit(2000);
    if (lineRows.error) return databaseErrorResponse(lineRows.error);

    const linesByInvoice = new Map<string, ReturnType<typeof toInvoiceLineView>[]>();
    for (const row of (lineRows.data ?? []) as unknown as CrmInvoiceLineRow[]) {
      const bucket = linesByInvoice.get(row.invoice_id) ?? [];
      bucket.push(toInvoiceLineView(row));
      linesByInvoice.set(row.invoice_id, bucket);
    }

    const today = new Date().toISOString().slice(0, 10);
    return jsonNoStore({
      invoices: invoices.map((invoice) => ({
        ...invoice,
        overdue: isInvoiceOverdue(invoice, today),
        lines: linesByInvoice.get(invoice.id) ?? [],
      })),
      // What the book is actually owed, and how much of it is late.
      outstandingCents: invoices
        .filter((invoice) => invoice.status === "open")
        .reduce((sum, invoice) => sum + invoice.balanceCents, 0),
      overdueCents: invoices
        .filter((invoice) => isInvoiceOverdue(invoice, today))
        .reduce((sum, invoice) => sum + invoice.balanceCents, 0),
      collectedCents: invoices.reduce((sum, invoice) => sum + invoice.paidCents, 0),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_invoices_unavailable", message: "Invoices could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 200_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const lines = payload.lines.map((line, index) => ({
      position: index + 1,
      description: line.description,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      amount_cents: Math.round(line.quantity * line.unitPriceCents),
    }));
    const subtotal = lines.reduce((sum, line) => sum + line.amount_cents, 0);

    const created = await client
      .from("crm_invoices")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        contract_id: payload.contractId ?? null,
        work_order_id: payload.workOrderId ?? null,
        number: payload.number,
        status: payload.issue ? "open" : "draft",
        subtotal_cents: subtotal,
        tax_cents: payload.taxCents,
        total_cents: subtotal + payload.taxCents,
        issued_on: payload.issuedOn ?? (payload.issue ? new Date().toISOString().slice(0, 10) : null),
        due_on: payload.dueOn ?? null,
        memo: payload.memo ?? null,
        created_by: user.id,
      })
      .select(CRM_INVOICE_COLUMNS)
      .single();
    if (created.error) {
      if (created.error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "invoice_number_taken",
              message: "That invoice number is already in use in this workspace.",
            },
          },
          { status: 409 },
        );
      }
      if (created.error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message: "The account, contract or work order is not in this workspace.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(created.error);
    }

    const invoice = toInvoiceView(created.data as unknown as CrmInvoiceRow);
    const insertedLines = await client
      .from("crm_invoice_lines")
      .insert(
        lines.map((line) => ({
          organization_id: activeOrganization.id,
          invoice_id: invoice.id,
          ...line,
        })),
      )
      .select(CRM_INVOICE_LINE_COLUMNS);
    if (insertedLines.error) return databaseErrorResponse(insertedLines.error);

    return jsonNoStore(
      {
        invoice: {
          ...invoice,
          overdue: false,
          lines: ((insertedLines.data ?? []) as unknown as CrmInvoiceLineRow[]).map(toInvoiceLineView),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_invoice",
            message: error.issues[0]?.message ?? "The invoice could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_invoice_not_recorded", message: "The invoice could not be recorded." } },
      { status: 500 },
    );
  }
}
