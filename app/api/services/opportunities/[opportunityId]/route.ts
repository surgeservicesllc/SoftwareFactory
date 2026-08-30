import { z } from "zod";

import {
  CRM_OPPORTUNITY_COLUMNS,
  CRM_OPPORTUNITY_STAGES,
  toOpportunityView,
  type CrmOpportunityRow,
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
 * Correct or move one opportunity. A stage move is the pipeline's whole
 * verb: the database writes the move onto the account timeline and keeps
 * closed_at truthful in the same transaction, so this route only states the
 * new stage. A loss reason travels with a move to lost and nowhere else —
 * the schema's CHECK backs the same rule this validates politely.
 */

const paramsSchema = z.object({ opportunityId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    stage: z.enum(CRM_OPPORTUNITY_STAGES).optional(),
    valueCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
    expectedCloseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.")
      .nullable()
      .optional(),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
    lostReason: z.string().trim().min(1).max(300).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." })
  .refine(
    (value) => !(typeof value.lostReason === "string" && value.stage !== "lost"),
    { message: "A loss reason travels with a move to lost." },
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ opportunityId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_opportunity_id", message: "The opportunity id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.stage !== undefined) changes.stage = payload.stage;
    if (payload.valueCents !== undefined) changes.value_cents = payload.valueCents;
    if (payload.expectedCloseDate !== undefined) changes.expected_close_date = payload.expectedCloseDate;
    if (payload.notes !== undefined) changes.notes = payload.notes;
    if (payload.lostReason !== undefined) changes.lost_reason = payload.lostReason;
    // Leaving lost clears the reason with the move; a reason without its
    // loss would contradict the schema's CHECK.
    if (payload.stage !== undefined && payload.stage !== "lost") changes.lost_reason = null;

    const { data, error } = await client
      .from("crm_opportunities")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.opportunityId)
      .select(CRM_OPPORTUNITY_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "opportunity_not_found", message: "No such opportunity in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ opportunity: toOpportunityView(data as unknown as CrmOpportunityRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_opportunity_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_opportunity_not_updated", message: "The opportunity could not be updated." } },
      { status: 500 },
    );
  }
}
