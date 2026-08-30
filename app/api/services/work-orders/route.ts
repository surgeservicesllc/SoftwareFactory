import { z } from "zod";

import {
  CRM_WORK_ORDER_COLUMNS,
  CRM_WORK_ORDER_STATUSES,
  toWorkOrderView,
  type CrmWorkOrderRow,
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
 * Work orders: list the schedule and create a visit. The list carries
 * whole-book counts by status from a second read of the same table, so the
 * dispatch board's headline and its lanes are one authority. New visits
 * start scheduled — completion and cancellation are moves the database
 * records on the account timeline itself.
 */

const listQuerySchema = z
  .object({
    status: z.enum(CRM_WORK_ORDER_STATUSES).optional(),
    technicianId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    propertyId: z.string().uuid(),
    technicianId: z.string().uuid().nullish(),
    serviceType: z.string().trim().min(1).max(120),
    scheduledStart: z.string().datetime({ offset: true }),
    scheduledEnd: z.string().datetime({ offset: true }),
    instructions: z.string().trim().min(1).max(2000).nullish(),
  })
  .strict()
  .refine((value) => new Date(value.scheduledEnd) > new Date(value.scheduledStart), {
    message: "The visit must end after it starts.",
  });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      technicianId: url.searchParams.get("technicianId") ?? undefined,
      accountId: url.searchParams.get("accountId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_work_orders_query", message: "The schedule query is invalid." } },
        { status: 400 },
      );
    }

    const { client, activeOrganization } = await requireActiveOrganization();

    let query = client
      .from("crm_work_orders")
      .select(CRM_WORK_ORDER_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("scheduled_start", { ascending: true })
      .limit(300);
    if (parsed.data.status) query = query.eq("status", parsed.data.status);
    if (parsed.data.technicianId) query = query.eq("technician_id", parsed.data.technicianId);
    if (parsed.data.accountId) query = query.eq("account_id", parsed.data.accountId);
    if (parsed.data.from) query = query.gte("scheduled_start", `${parsed.data.from}T00:00:00Z`);
    if (parsed.data.to) query = query.lte("scheduled_start", `${parsed.data.to}T23:59:59Z`);
    const { data, error } = await query;
    if (error) return databaseErrorResponse(error);

    const counted = await client
      .from("crm_work_orders")
      .select("status")
      .eq("organization_id", activeOrganization.id)
      .limit(10_000);
    if (counted.error) return databaseErrorResponse(counted.error);
    const byStatus: Record<string, number> = {};
    for (const status of CRM_WORK_ORDER_STATUSES) byStatus[status] = 0;
    for (const row of (counted.data ?? []) as { status: string }[]) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    }

    return jsonNoStore({
      workOrders: ((data ?? []) as unknown as CrmWorkOrderRow[]).map(toWorkOrderView),
      counts: { byStatus, total: (counted.data ?? []).length },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_work_orders_unavailable", message: "The schedule could not be listed." } },
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
      .from("crm_work_orders")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        property_id: payload.propertyId,
        technician_id: payload.technicianId ?? null,
        service_type: payload.serviceType,
        scheduled_start: payload.scheduledStart,
        scheduled_end: payload.scheduledEnd,
        instructions: payload.instructions ?? null,
        created_by: user.id,
      })
      .select(CRM_WORK_ORDER_COLUMNS)
      .single();
    if (error) {
      // The composite keys refuse an account/property pair that is not one
      // account's own site, and a technician outside this organization.
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
      { workOrder: toWorkOrderView(data as unknown as CrmWorkOrderRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_work_order",
            message: error.issues[0]?.message ?? "The work order could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_work_order_not_recorded", message: "The work order could not be recorded." } },
      { status: 500 },
    );
  }
}
