import { z } from "zod";

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
 * Edit one category.
 *
 * `kind` is deliberately not editable: transactions were classified under
 * the kind the category had when they were recorded, and changing it in
 * place would silently reclassify history — every past month's income and
 * spend figures would move with no record of why. Rename, retone, adjust
 * the ceiling, or archive; a different kind is a new category.
 *
 * There is no DELETE. Rows in the ledger reference categories with
 * `on delete set null`, so a delete would strip the classification off
 * history. Archiving hides a category from pickers and keeps every past
 * row honest.
 */

const paramsSchema = z.object({ categoryId: z.string().uuid() });

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    tone: z
      .enum(["neutral", "income", "essential", "discretionary", "debt", "savings", "warning"])
      .optional(),
    monthlyLimitCents: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

const CATEGORY_COLUMNS = "id, name, kind, tone, monthly_limit_cents, is_archived";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ categoryId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { categoryId } = paramsSchema.parse(await context.params);
    const payload = patchSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.tone !== undefined) changes.tone = payload.tone;
    if (payload.monthlyLimitCents !== undefined) changes.monthly_limit_cents = payload.monthlyLimitCents;
    if (payload.isArchived !== undefined) changes.is_archived = payload.isArchived;

    const { data, error } = await client
      .from("budget_categories")
      .update(changes)
      .eq("id", categoryId)
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .select(CATEGORY_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "budget_category_not_found", message: "That category is not yours to edit." } },
        { status: 404 },
      );
    }

    const row = data as unknown as {
      id: string; name: string; kind: string; tone: string;
      monthly_limit_cents: number | null; is_archived: boolean;
    };
    return jsonNoStore({
      category: {
        id: row.id,
        name: row.name,
        kind: row.kind,
        tone: row.tone,
        monthlyLimitCents: row.monthly_limit_cents === null ? null : Number(row.monthly_limit_cents),
        isArchived: row.is_archived,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_category_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_category_not_updated", message: "The category could not be updated." } },
      { status: 500 },
    );
  }
}
