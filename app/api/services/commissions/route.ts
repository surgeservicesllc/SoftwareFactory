import { z } from "zod";

import {
  CRM_COMMISSION_COLUMNS,
  toCommissionView,
  type CrmCommissionRow,
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
 * Commissions: what a sale earned the person who made it.
 *
 * The payout is NOT taken from the caller. A commission states what was
 * sold (the basis) and at what rate; a database trigger multiplies them.
 * There is deliberately no `amountCents` in either schema below — a payout
 * that disagreed with its own arithmetic is exactly the kind of number that
 * gets believed.
 *
 * Approval and payment are transitions, in that order, and each records its
 * own moment. Nothing here is deletable: a commission raised in error is
 * voided, and the void stays on the record.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    employeeId: z.string().uuid(),
    opportunityId: z.string().uuid().nullish(),
    contractId: z.string().uuid().nullish(),
    invoiceId: z.string().uuid().nullish(),
    basisCents: z.number().int().min(0).max(100_000_000_000),
    rateBps: z.number().int().min(0).max(10_000),
    earnedOn: z.string().regex(DATE, "A date, as YYYY-MM-DD."),
    note: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.opportunityId ?? value.contractId ?? value.invoiceId),
    { message: "A commission is earned on a deal, a contract or an invoice." },
  );

const patchSchema = z
  .object({
    commissionId: z.string().uuid(),
    status: z.enum(["accrued", "approved", "paid", "void"]),
    note: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const url = new URL(request.url);
    const employeeId = url.searchParams.get("employeeId");

    let query = client
      .from("crm_commissions")
      .select(CRM_COMMISSION_COLUMNS)
      .eq("organization_id", activeOrganization.id);
    if (employeeId !== null && employeeId !== "") query = query.eq("employee_id", employeeId);

    const { data, error } = await query.order("earned_on", { ascending: false }).limit(500);
    if (error) return databaseErrorResponse(error);

    const commissions = ((data ?? []) as unknown as CrmCommissionRow[]).map(toCommissionView);
    const total = (status: string) =>
      commissions
        .filter((commission) => commission.status === status)
        .reduce((sum, commission) => sum + commission.amountCents, 0);

    return jsonNoStore({
      commissions,
      totals: {
        accruedCents: total("accrued"),
        approvedCents: total("approved"),
        paidCents: total("paid"),
        // Voided commissions are reported apart rather than netted away.
        voidCents: total("void"),
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_commissions_unavailable", message: "Commissions could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_commissions")
      .insert({
        organization_id: activeOrganization.id,
        employee_id: payload.employeeId,
        opportunity_id: payload.opportunityId ?? null,
        contract_id: payload.contractId ?? null,
        invoice_id: payload.invoiceId ?? null,
        basis_cents: payload.basisCents,
        rate_bps: payload.rateBps,
        earned_on: payload.earnedOn,
        note: payload.note ?? null,
        created_by: user.id,
      })
      .select(CRM_COMMISSION_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message: "The person, deal, contract or invoice is not in this workspace.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    // The amount comes back from the database, because the database is what
    // computed it.
    return jsonNoStore(
      { commission: toCommissionView(data as unknown as CrmCommissionRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "invalid_commission", "crm_commission_not_recorded", "The commission could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const existing = await client
      .from("crm_commissions")
      .select(CRM_COMMISSION_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.commissionId)
      .maybeSingle();
    if (existing.error) return databaseErrorResponse(existing.error);
    if (!existing.data) {
      return jsonNoStore(
        { error: { code: "commission_not_found", message: "No such commission in this workspace." } },
        { status: 404 },
      );
    }
    const before = toCommissionView(existing.data as unknown as CrmCommissionRow);

    const now = new Date().toISOString();
    const changes: Record<string, unknown> = { status: payload.status };
    if (payload.note !== undefined) changes.note = payload.note;
    if (payload.status === "accrued") {
      // Sending one back to accrued takes its approval with it.
      changes.approved_at = null;
      changes.paid_at = null;
    } else if (payload.status === "approved") {
      changes.approved_at = before.approvedAt ?? now;
      changes.paid_at = null;
    } else if (payload.status === "paid") {
      // Paying an unapproved commission approves it in the same moment —
      // the schema refuses a payment with no approval behind it.
      changes.approved_at = before.approvedAt ?? now;
      changes.paid_at = before.paidAt ?? now;
    }

    const { data, error } = await client
      .from("crm_commissions")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.commissionId)
      .select(CRM_COMMISSION_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23514") {
        return jsonNoStore(
          {
            error: {
              code: "commission_transition_refused",
              message: "That transition was refused — a paid commission carries both its approval and its payment.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "commission_not_found", message: "No such commission in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ commission: toCommissionView(data as unknown as CrmCommissionRow) });
  } catch (error) {
    return failure(error, "invalid_commission_change", "crm_commission_not_updated", "The commission could not be updated.");
  }
}

function failure(error: unknown, invalidCode: string, failureCode: string, message: string) {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { error: { code: invalidCode, message: error.issues[0]?.message ?? message } },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code: failureCode, message } }, { status: 500 });
}
