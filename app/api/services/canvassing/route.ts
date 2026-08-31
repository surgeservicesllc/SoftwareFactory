import { z } from "zod";

import {
  CRM_CANVASS_ROUTE_COLUMNS,
  CRM_CANVASS_STATUSES,
  CRM_KNOCK_COLUMNS,
  isProductiveKnock,
  toCanvassRouteView,
  toKnockView,
  type CrmCanvassRouteRow,
  type CrmKnockRow,
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
 * Canvassing: a rep walking a territory on a day, and what happened at each
 * door.
 *
 * The list rides with the numbers a sales manager opens this page for —
 * doors knocked, and the share of them that produced a callback, an
 * appointment or a sale. Counting "no answer" as an outcome would flatter
 * every route on the board, so it is counted apart.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    territoryId: z.string().uuid().nullish(),
    repId: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(160),
    walkedOn: z.string().regex(DATE, "A date, as YYYY-MM-DD."),
    notes: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    canvassRouteId: z.string().uuid(),
    status: z.enum(CRM_CANVASS_STATUSES),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const [routeRows, knockRows] = await Promise.all([
      client
        .from("crm_canvass_routes")
        .select(CRM_CANVASS_ROUTE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("walked_on", { ascending: false })
        .limit(400),
      client
        .from("crm_knocks")
        .select(CRM_KNOCK_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("knocked_at", { ascending: false })
        .limit(2000),
    ]);
    if (routeRows.error) return databaseErrorResponse(routeRows.error);
    if (knockRows.error) return databaseErrorResponse(knockRows.error);

    const routes = ((routeRows.data ?? []) as unknown as CrmCanvassRouteRow[]).map(toCanvassRouteView);
    const knocks = ((knockRows.data ?? []) as unknown as CrmKnockRow[]).map(toKnockView);

    const knocksByRoute = new Map<string, number>();
    const productiveByRoute = new Map<string, number>();
    const byDisposition: Record<string, number> = {};
    for (const knock of knocks) {
      knocksByRoute.set(knock.canvassRouteId, (knocksByRoute.get(knock.canvassRouteId) ?? 0) + 1);
      byDisposition[knock.disposition] = (byDisposition[knock.disposition] ?? 0) + 1;
      if (isProductiveKnock(knock.disposition)) {
        productiveByRoute.set(
          knock.canvassRouteId,
          (productiveByRoute.get(knock.canvassRouteId) ?? 0) + 1,
        );
      }
    }

    const productive = knocks.filter((knock) => isProductiveKnock(knock.disposition)).length;
    return jsonNoStore({
      routes: routes.map((route) => ({
        ...route,
        knockCount: knocksByRoute.get(route.id) ?? 0,
        productiveCount: productiveByRoute.get(route.id) ?? 0,
      })),
      knocks: knocks.slice(0, 300),
      counts: {
        routes: routes.length,
        knocks: knocks.length,
        productive,
        sold: byDisposition.sold ?? 0,
        // Null rather than 0 when nobody has knocked: a rate over no doors
        // is not a rate.
        productiveRate: knocks.length === 0 ? null : Math.round((productive / knocks.length) * 100),
        byDisposition,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_canvassing_unavailable", message: "Canvassing could not be read." } },
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
      .from("crm_canvass_routes")
      .insert({
        organization_id: activeOrganization.id,
        territory_id: payload.territoryId ?? null,
        rep_id: payload.repId ?? null,
        name: payload.name,
        status: "planned",
        walked_on: payload.walkedOn,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_CANVASS_ROUTE_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "reference_not_found", message: "That territory or rep is not in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { route: toCanvassRouteView(data as unknown as CrmCanvassRouteRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "invalid_canvass_route", "crm_canvass_route_not_recorded", "The route could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const existing = await client
      .from("crm_canvass_routes")
      .select(CRM_CANVASS_ROUTE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.canvassRouteId)
      .maybeSingle();
    if (existing.error) return databaseErrorResponse(existing.error);
    if (!existing.data) {
      return jsonNoStore(
        { error: { code: "canvass_route_not_found", message: "No such route in this workspace." } },
        { status: 404 },
      );
    }
    const before = toCanvassRouteView(existing.data as unknown as CrmCanvassRouteRow);

    const now = new Date().toISOString();
    const changes: Record<string, unknown> = { status: payload.status };
    if (payload.notes !== undefined) changes.notes = payload.notes;
    // Walking a route starts it; finishing one ends it. The schema refuses a
    // walked route with no start and a complete one with no end, so both
    // moments are recorded here rather than left to the caller.
    if (payload.status === "walking") {
      changes.started_at = before.startedAt ?? now;
      changes.ended_at = null;
    } else if (payload.status === "complete") {
      changes.started_at = before.startedAt ?? now;
      changes.ended_at = before.endedAt ?? now;
    } else if (payload.status === "planned") {
      changes.started_at = null;
      changes.ended_at = null;
    }

    const { data, error } = await client
      .from("crm_canvass_routes")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.canvassRouteId)
      .select(CRM_CANVASS_ROUTE_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "canvass_route_not_found", message: "No such route in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ route: toCanvassRouteView(data as unknown as CrmCanvassRouteRow) });
  } catch (error) {
    return failure(error, "invalid_canvass_change", "crm_canvass_route_not_updated", "The route could not be updated.");
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
