import { z } from "zod";

import {
  CRM_FORECAST_ASSUMPTIONS_COLUMNS,
  readBps,
  toForecastAssumptionsView,
  toForecastScenarioMonthView,
  totalScenario,
  type CrmForecastAssumptionsRow,
  type CrmForecastScenarioRow,
} from "@/lib/services/trust";
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
 * The forecast with the owner's assumptions applied, beside the recorded
 * one. The assumptions come from the workspace's stored row unless the
 * request supplies its own (a what-if that is not saved); either way the
 * payload says which was applied and prints the factor per month, so the
 * scenario is a sum somebody can check rather than a model nobody can see.
 */

function months(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 12;
  return Math.min(parsed, 36);
}

const saveSchema = z
  .object({
    annualChurnBps: z.number().int().min(0).max(10_000),
    annualGrowthBps: z.number().int().min(0).max(10_000),
    note: z.string().trim().min(1).max(300).nullable().optional(),
  })
  .strict();

type Client = Awaited<ReturnType<typeof requireActiveOrganization>>["client"];

async function readAssumptions(client: Client, organizationId: string) {
  const read = await client
    .from("crm_forecast_assumptions")
    .select(CRM_FORECAST_ASSUMPTIONS_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (read.error) return { error: read.error, assumptions: null };
  return {
    error: null,
    assumptions: read.data ? toForecastAssumptionsView(read.data as unknown as CrmForecastAssumptionsRow) : null,
  };
}

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const params = new URL(request.url).searchParams;
    const window = months(params.get("months"));
    const stored = await readAssumptions(client, activeOrganization.id);
    if (stored.error) return databaseErrorResponse(stored.error);
    const queryChurn = readBps(params.get("churnBps"));
    const queryGrowth = readBps(params.get("growthBps"));
    const fromQuery = queryChurn !== null || queryGrowth !== null;
    const churnBps = fromQuery ? (queryChurn ?? 0) : (stored.assumptions?.annualChurnBps ?? 0);
    const growthBps = fromQuery ? (queryGrowth ?? 0) : (stored.assumptions?.annualGrowthBps ?? 0);
    const read = await client.rpc("crm_revenue_forecast_scenario", {
      p_months: window,
      p_churn_bps: churnBps,
      p_growth_bps: growthBps,
    });
    if (read.error) return databaseErrorResponse(read.error);
    const rows = ((read.data ?? []) as unknown as CrmForecastScenarioRow[]).map(toForecastScenarioMonthView);
    return jsonNoStore({
      window: { months: window },
      assumptions: stored.assumptions,
      applied: {
        churnBps,
        growthBps,
        source: fromQuery ? "query" : stored.assumptions ? "stored" : "none",
      },
      months: rows,
      totals: totalScenario(rows),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_forecast_scenario_unavailable", message: "The scenario could not be read." } },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = saveSchema.parse(await readBoundedJson(request, 4_000));
    const { client, activeOrganization, user } = await requireActiveOrganization();
    const write = await client
      .from("crm_forecast_assumptions")
      .upsert(
        {
          organization_id: activeOrganization.id,
          annual_churn_bps: payload.annualChurnBps,
          annual_growth_bps: payload.annualGrowthBps,
          note: payload.note ?? null,
          updated_by: user.id,
        },
        { onConflict: "organization_id" },
      )
      .select(CRM_FORECAST_ASSUMPTIONS_COLUMNS)
      .single();
    if (write.error) return databaseErrorResponse(write.error);
    return jsonNoStore({ assumptions: toForecastAssumptionsView(write.data as unknown as CrmForecastAssumptionsRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_assumptions", message: error.issues[0]?.message ?? "The assumptions could not be saved." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_assumptions_not_saved", message: "The assumptions could not be saved." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { client, activeOrganization } = await requireActiveOrganization();
    const write = await client.from("crm_forecast_assumptions").delete().eq("organization_id", activeOrganization.id);
    if (write.error) return databaseErrorResponse(write.error);
    return jsonNoStore({ assumptions: null });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_assumptions_not_cleared", message: "The assumptions could not be cleared." } },
      { status: 500 },
    );
  }
}
