import { z } from "zod";

import {
  CRM_SERVICE_PLAN_COLUMNS,
  CRM_WORK_ORDER_COLUMNS,
  advanceServiceDate,
  toServicePlanView,
  toWorkOrderView,
  type CrmServicePlanRow,
  type CrmServiceRecurrence,
  type CrmWorkOrderRow,
} from "@/lib/services/crm";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Generate the plan's due visit: one real work order at the plan's next_due,
 * and the plan advanced by its recurrence.
 *
 * The advance is guarded on the exact prior next_due, so two dispatchers
 * clicking at once produce one visit and one honest 409, not two visits.
 * The advance happens first; if the work order insert then fails, the
 * advance is compensated back and the failure reported — the plan is never
 * left claiming a visit that does not exist.
 */

const paramsSchema = z.object({ planId: z.string().uuid() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_plan_id", message: "The plan id is not a UUID." } },
        { status: 400 },
      );
    }
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const planRead = await client
      .from("crm_service_plans")
      .select(CRM_SERVICE_PLAN_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.planId)
      .maybeSingle();
    if (planRead.error) return databaseErrorResponse(planRead.error);
    if (!planRead.data) {
      return jsonNoStore(
        { error: { code: "plan_not_found", message: "No such service plan in this workspace." } },
        { status: 404 },
      );
    }
    const plan = planRead.data as unknown as CrmServicePlanRow;
    if (!plan.active) {
      return jsonNoStore(
        { error: { code: "plan_inactive", message: "A paused plan does not generate visits." } },
        { status: 409 },
      );
    }

    const dueDate = plan.next_due;
    const advancedTo = advanceServiceDate(dueDate, plan.recurrence as CrmServiceRecurrence);
    const advanced = await client
      .from("crm_service_plans")
      .update({ next_due: advancedTo })
      .eq("organization_id", activeOrganization.id)
      .eq("id", plan.id)
      .eq("next_due", dueDate)
      .select(CRM_SERVICE_PLAN_COLUMNS)
      .maybeSingle();
    if (advanced.error) return databaseErrorResponse(advanced.error);
    if (!advanced.data) {
      return jsonNoStore(
        {
          error: {
            code: "plan_already_generated",
            message: "This due date's visit was already generated — the schedule has it.",
          },
        },
        { status: 409 },
      );
    }

    const inserted = await client
      .from("crm_work_orders")
      .insert({
        organization_id: activeOrganization.id,
        account_id: plan.account_id,
        property_id: plan.property_id,
        technician_id: plan.technician_id,
        plan_id: plan.id,
        service_type: plan.service_type,
        scheduled_start: `${dueDate}T09:00:00Z`,
        scheduled_end: `${dueDate}T11:00:00Z`,
        instructions: plan.notes,
        created_by: user.id,
      })
      .select(CRM_WORK_ORDER_COLUMNS)
      .single();
    if (inserted.error) {
      // Compensate: the plan must not claim a visit that was never created.
      await client
        .from("crm_service_plans")
        .update({ next_due: dueDate })
        .eq("organization_id", activeOrganization.id)
        .eq("id", plan.id)
        .eq("next_due", advancedTo);
      return databaseErrorResponse(inserted.error);
    }

    return jsonNoStore(
      {
        workOrder: toWorkOrderView(inserted.data as unknown as CrmWorkOrderRow),
        plan: toServicePlanView(advanced.data as unknown as CrmServicePlanRow),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_visit_not_generated", message: "The visit could not be generated." } },
      { status: 500 },
    );
  }
}
