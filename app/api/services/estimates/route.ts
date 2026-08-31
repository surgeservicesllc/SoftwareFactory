import { z } from "zod";

import {
  CRM_ESTIMATE_COLUMNS,
  CRM_ESTIMATE_LINE_COLUMNS,
  toEstimateView,
  toLineView,
  type CrmEstimateLineRow,
  type CrmEstimateRow,
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
 * Estimates: the priced proposal a book of business runs on. An estimate
 * carries its own lines, and the money is derived here rather than taken
 * from the caller — a browser cannot assert a subtotal that disagrees with
 * the lines it sent, because the subtotal is computed from them.
 */

const lineSchema = z
  .object({
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(100_000),
    unitPriceCents: z.number().int().min(0).max(100_000_000_000),
  })
  .strict();

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    propertyId: z.string().uuid().nullish(),
    opportunityId: z.string().uuid().nullish(),
    number: z.string().trim().min(3).max(40),
    taxCents: z.number().int().min(0).max(100_000_000_000).default(0),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.").nullish(),
    terms: z.string().trim().min(1).max(4000).nullish(),
    notes: z.string().trim().min(1).max(4000).nullish(),
    lines: z.array(lineSchema).min(1).max(500),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_estimates")
      .select(CRM_ESTIMATE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return databaseErrorResponse(error);

    const estimates = ((data ?? []) as unknown as CrmEstimateRow[]).map(toEstimateView);
    const lineRows =
      estimates.length === 0
        ? { data: [], error: null }
        : await client
            .from("crm_estimate_lines")
            .select(CRM_ESTIMATE_LINE_COLUMNS)
            .eq("organization_id", activeOrganization.id)
            .in(
              "estimate_id",
              estimates.map((estimate) => estimate.id),
            )
            .order("position", { ascending: true })
            .limit(2000);
    if (lineRows.error) return databaseErrorResponse(lineRows.error);

    const linesByEstimate = new Map<string, ReturnType<typeof toLineView>[]>();
    for (const row of (lineRows.data ?? []) as unknown as CrmEstimateLineRow[]) {
      const bucket = linesByEstimate.get(row.estimate_id) ?? [];
      bucket.push(toLineView(row));
      linesByEstimate.set(row.estimate_id, bucket);
    }

    return jsonNoStore({
      estimates: estimates.map((estimate) => ({
        ...estimate,
        lines: linesByEstimate.get(estimate.id) ?? [],
      })),
      openValueCents: estimates
        .filter((estimate) => estimate.status === "draft" || estimate.status === "sent")
        .reduce((sum, estimate) => sum + estimate.totalCents, 0),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_estimates_unavailable", message: "Estimates could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 200_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    // The money is the lines' money. Rounding happens once, per line.
    const lines = payload.lines.map((line, index) => ({
      position: index + 1,
      description: line.description,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      amount_cents: Math.round(line.quantity * line.unitPriceCents),
    }));
    const subtotal = lines.reduce((sum, line) => sum + line.amount_cents, 0);

    const created = await client
      .from("crm_estimates")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        property_id: payload.propertyId ?? null,
        opportunity_id: payload.opportunityId ?? null,
        number: payload.number,
        status: "draft",
        subtotal_cents: subtotal,
        tax_cents: payload.taxCents,
        total_cents: subtotal + payload.taxCents,
        valid_until: payload.validUntil ?? null,
        terms: payload.terms ?? null,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_ESTIMATE_COLUMNS)
      .single();
    if (created.error) {
      if (created.error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "estimate_number_taken",
              message: "That estimate number is already in use in this workspace.",
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
              message:
                "The account, property or opportunity is not in this workspace — and the property must belong to the account.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(created.error);
    }

    const estimate = toEstimateView(created.data as unknown as CrmEstimateRow);
    const insertedLines = await client
      .from("crm_estimate_lines")
      .insert(
        lines.map((line) => ({
          organization_id: activeOrganization.id,
          estimate_id: estimate.id,
          ...line,
        })),
      )
      .select(CRM_ESTIMATE_LINE_COLUMNS);
    if (insertedLines.error) return databaseErrorResponse(insertedLines.error);

    return jsonNoStore(
      {
        estimate: {
          ...estimate,
          lines: ((insertedLines.data ?? []) as unknown as CrmEstimateLineRow[]).map(toLineView),
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
            code: "invalid_estimate",
            message: error.issues[0]?.message ?? "The estimate could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_estimate_not_recorded", message: "The estimate could not be recorded." } },
      { status: 500 },
    );
  }
}
