import { z } from "zod";

import {
  CRM_ATTRIBUTION_COLUMNS,
  CRM_TOUCH_POSITIONS,
  toAttributionView,
  type CrmAttributionRow,
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
 * Attribution: which touch brought which customer, and where in the journey
 * it sat.
 *
 * Append-only, because a touch is a thing that happened. The rollup reports
 * first-touch and last-touch separately rather than picking one and calling
 * it "the" source — every model is a choice, and hiding the choice behind a
 * single number is how attribution reports mislead.
 */

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    opportunityId: z.string().uuid().nullish(),
    campaignId: z.string().uuid().nullish(),
    knockId: z.string().uuid().nullish(),
    source: z.string().trim().min(1).max(120),
    medium: z.string().trim().min(1).max(120).nullish(),
    position: z.enum(CRM_TOUCH_POSITIONS),
    touchedAt: z.string().datetime().nullish(),
    note: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_attributions")
      .select(CRM_ATTRIBUTION_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("touched_at", { ascending: false })
      .limit(2000);
    if (error) return databaseErrorResponse(error);

    const touches = ((data ?? []) as unknown as CrmAttributionRow[]).map(toAttributionView);
    const bySource = (position: string) => {
      const counts: Record<string, number> = {};
      for (const touch of touches) {
        if (touch.position !== position) continue;
        counts[touch.source] = (counts[touch.source] ?? 0) + 1;
      }
      return counts;
    };

    return jsonNoStore({
      touches: touches.slice(0, 300),
      // Two models, reported side by side. Neither is called "the" answer.
      firstTouch: bySource("first"),
      lastTouch: bySource("last"),
      counts: {
        total: touches.length,
        accounts: new Set(touches.map((touch) => touch.accountId)).size,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_attribution_unavailable", message: "Attribution could not be read." } },
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
      .from("crm_attributions")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        opportunity_id: payload.opportunityId ?? null,
        campaign_id: payload.campaignId ?? null,
        knock_id: payload.knockId ?? null,
        source: payload.source,
        medium: payload.medium ?? null,
        position: payload.position,
        touched_at: payload.touchedAt ?? new Date().toISOString(),
        note: payload.note ?? null,
        created_by: user.id,
      })
      .select(CRM_ATTRIBUTION_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message: "The customer, deal, campaign or knock is not in this workspace.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { touch: toAttributionView(data as unknown as CrmAttributionRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_touch",
            message: error.issues[0]?.message ?? "The touch could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_touch_not_recorded", message: "The touch could not be recorded." } },
      { status: 500 },
    );
  }
}
