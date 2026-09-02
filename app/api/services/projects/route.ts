import { z } from "zod";

import { toProjectProgressView, type CrmProjectProgressRow } from "@/lib/services/schedule-bends";
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
 * Multi-day projects (ADR-239): read with their days counted live from
 * their visits; created as the project plus one visit per working day,
 * in one database call so a half-made project cannot exist.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    propertyId: z.string().uuid(),
    technicianId: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(160),
    serviceType: z.string().trim().min(1).max(120),
    startsOn: z.string().regex(DATE),
    endsOn: z.string().regex(DATE),
    dailyStart: z.string().regex(TIME),
    dailyEnd: z.string().regex(TIME),
    includeWeekends: z.boolean().default(false),
    note: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict()
  .refine((value) => value.endsOn >= value.startsOn, { message: "The last day comes before the first." })
  .refine((value) => (Date.parse(value.endsOn) - Date.parse(value.startsOn)) / 86_400_000 <= 30, {
    message: "A project spans at most 31 days; a longer job is two projects.",
  })
  .refine((value) => value.dailyEnd > value.dailyStart, { message: "The daily window ends before it starts." });

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("crm_project_progress", { p_organization: activeOrganization.id }).limit(500);
    if (error) return databaseErrorResponse(error);
    const projects = ((data ?? []) as unknown as CrmProjectProgressRow[]).map(toProjectProgressView);
    return jsonNoStore({
      projects,
      counts: {
        total: projects.length,
        active: projects.filter((project) => project.state === "active").length,
        planned: projects.filter((project) => project.state === "planned").length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "projects_unavailable", message: "Projects could not be listed." } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 8_000));
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("crm_project_create", {
      p_organization: activeOrganization.id,
      p_account: payload.accountId,
      p_property: payload.propertyId,
      p_name: payload.name,
      p_service_type: payload.serviceType,
      p_technician: payload.technicianId ?? null,
      p_starts_on: payload.startsOn,
      p_ends_on: payload.endsOn,
      p_daily_start: payload.dailyStart,
      p_daily_end: payload.dailyEnd,
      p_include_weekends: payload.includeWeekends,
      p_note: payload.note ?? null,
    });
    if (error) {
      if (error.code === "23514" || error.code === "P0001") {
        return jsonNoStore({ error: { code: "project_refused", message: error.message } }, { status: 422 });
      }
      if (error.code === "23503") {
        return jsonNoStore({ error: { code: "project_refused", message: "The site is not on that account, or the technician is not in this workspace." } }, { status: 422 });
      }
      return databaseErrorResponse(error);
    }
    const row = ((data ?? []) as Array<{ project_id: string; visits: number }>)[0];
    if (!row) return jsonNoStore({ error: { code: "project_refused", message: "The project was not created." } }, { status: 422 });
    return jsonNoStore({ projectId: row.project_id, visits: Number(row.visits) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_project", message: error.issues[0]?.message ?? "Invalid project." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "project_not_created", message: "The project could not be created." } }, { status: 500 });
  }
}
