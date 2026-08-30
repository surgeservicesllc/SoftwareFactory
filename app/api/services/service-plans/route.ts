import { z } from "zod";

import {
  CRM_SERVICE_PLAN_COLUMNS,
  CRM_SERVICE_RECURRENCES,
  toServicePlanView,
  type CrmServicePlanRow,
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
 * Recurring service plans: the agreements that keep a book of business
 * serviced. A plan says when the next visit is due; the generate route
 * turns that into a real work order and advances the plan. The list rides
 * with a dueCount — active plans at or past their date — so the dispatch
 * board can say "3 plans need visits" from the same read.
 */

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    propertyId: z.string().uuid(),
    serviceType: z.string().trim().min(1).max(120),
    recurrence: z.enum(CRM_SERVICE_RECURRENCES),
    nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD."),
    technicianId: z.string().uuid().nullish(),
    valueCents: z.number().int().min(0).max(100_000_000_000).nullish(),
    notes: z.string().trim().min(1).max(2000).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_service_plans")
      .select(CRM_SERVICE_PLAN_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("active", { ascending: false })
      .order("next_due", { ascending: true })
      .limit(300);
    if (error) return databaseErrorResponse(error);

    const plans = ((data ?? []) as unknown as CrmServicePlanRow[]).map(toServicePlanView);
    const today = new Date().toISOString().slice(0, 10);
    return jsonNoStore({
      plans,
      dueCount: plans.filter((plan) => plan.active && plan.nextDue <= today).length,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_service_plans_unavailable", message: "Service plans could not be listed." } },
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
      .from("crm_service_plans")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        property_id: payload.propertyId,
        service_type: payload.serviceType,
        recurrence: payload.recurrence,
        next_due: payload.nextDue,
        technician_id: payload.technicianId ?? null,
        value_cents: payload.valueCents ?? null,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_SERVICE_PLAN_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message:
                "The account, property or technician is not in this workspace — and the property must belong to the account.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { plan: toServicePlanView(data as unknown as CrmServicePlanRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_service_plan",
            message: error.issues[0]?.message ?? "The service plan could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_service_plan_not_recorded", message: "The service plan could not be recorded." } },
      { status: 500 },
    );
  }
}
