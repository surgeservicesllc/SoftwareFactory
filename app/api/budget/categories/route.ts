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

/** Spending categories and their monthly ceilings. */

const CATEGORY_KINDS = ["income", "expense", "transfer", "debt", "savings"] as const;
const CATEGORY_TONES = [
  "neutral",
  "income",
  "essential",
  "discretionary",
  "debt",
  "savings",
  "warning",
] as const;

const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(CATEGORY_KINDS),
    tone: z.enum(CATEGORY_TONES).default("neutral"),
    monthlyLimitCents: z.number().int().min(0).max(1_000_000_000_000).nullish(),
  })
  .strict();

const CATEGORY_COLUMNS = "id, name, kind, tone, monthly_limit_cents, is_archived";

type CategoryRow = {
  id: string;
  name: string;
  kind: string;
  tone: string;
  monthly_limit_cents: number | null;
  is_archived: boolean;
};

export function toCategoryView(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    tone: row.tone,
    monthlyLimitCents: row.monthly_limit_cents === null ? null : Number(row.monthly_limit_cents),
    isArchived: row.is_archived,
  };
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("budget_categories")
      .select(CATEGORY_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("name", { ascending: true })
      .limit(300);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ categories: ((data ?? []) as unknown as CategoryRow[]).map(toCategoryView) });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_categories_unavailable", message: "Categories could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = categorySchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("budget_categories")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        name: payload.name,
        kind: payload.kind,
        tone: payload.tone,
        monthly_limit_cents: payload.monthlyLimitCents ?? null,
      })
      .select(CATEGORY_COLUMNS)
      .single();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ category: toCategoryView(data as unknown as CategoryRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_category",
            message: error.issues[0]?.message ?? "The category could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_category_not_recorded", message: "The category could not be recorded." } },
      { status: 500 },
    );
  }
}
