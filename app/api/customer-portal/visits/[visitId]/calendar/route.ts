import { z } from "zod";

import { buildCalendar, calendarFilename } from "@/lib/services/ics";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/**
 * A calendar file for one booked visit on the caller's own account
 * (ADR-237). The definer returns no row for a visit that is not theirs or
 * is not booked, and both read as 404 — the same sentence, on purpose.
 */

type CalendarRow = {
  id: string;
  service_type: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string | null;
  property_label: string | null;
  address: string | null;
  technician_name: string | null;
  organization_name: string;
};

export function visitCalendar(row: CalendarRow, stamp: string): { filename: string; body: string } {
  const where = [row.property_label, row.address].filter((part): part is string => part !== null && part.length > 0).join(", ");
  const lines = [
    `${row.service_type} visit from ${row.organization_name}.`,
    row.technician_name === null ? "Technician: to be confirmed." : `Technician: ${row.technician_name}.`,
    row.status === "scheduled" ? "Status: scheduled." : `Status: ${row.status}.`,
  ];
  return {
    filename: calendarFilename(row.service_type, row.scheduled_start),
    body: buildCalendar({
      uid: `visit-${row.id}@softwarefactory-services`,
      start: row.scheduled_start,
      end: row.scheduled_end,
      summary: `${row.service_type} — ${row.organization_name}`,
      description: lines.join("\n"),
      location: where.length > 0 ? where : null,
      organizer: row.organization_name,
      stamp,
    }),
  };
}

export async function GET(_request: Request, context: { params: Promise<{ visitId: string }> }) {
  try {
    const parsed = z.string().uuid().safeParse((await context.params).visitId);
    if (!parsed.success) return jsonNoStore({ error: { code: "visit_not_found", message: "No such visit." } }, { status: 404 });
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_visit_calendar", { p_work_order: parsed.data });
    if (error) throw error;
    const row = ((data ?? []) as CalendarRow[])[0];
    if (!row) return jsonNoStore({ error: { code: "visit_not_found", message: "No such visit." } }, { status: 404 });
    const { filename, body } = visitCalendar(row, new Date().toISOString());
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_calendar_unavailable", "The calendar file could not be built.");
  }
}
