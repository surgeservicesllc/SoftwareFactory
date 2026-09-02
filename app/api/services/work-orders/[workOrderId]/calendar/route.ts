import { z } from "zod";

import { buildCalendar, calendarFilename } from "@/lib/services/ics";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The same calendar file, for staff: a technician or dispatcher drops a
 * visit into their own calendar. Read under the caller's RLS; the dispatch
 * instructions go in, because this file is for the person doing the visit.
 */

type WorkOrderRow = {
  id: string;
  service_type: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string | null;
  instructions: string | null;
  crm_properties: { label: string; address: string } | null;
  crm_technicians: { first_name: string; last_name: string | null } | null;
  crm_accounts: { name: string } | null;
};

export async function GET(_request: Request, context: { params: Promise<{ workOrderId: string }> }) {
  try {
    const parsed = z.string().uuid().safeParse((await context.params).workOrderId);
    if (!parsed.success) return jsonNoStore({ error: { code: "work_order_not_found", message: "No such visit." } }, { status: 404 });
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_work_orders")
      .select("id, service_type, status, scheduled_start, scheduled_end, instructions, crm_properties(label, address), crm_technicians(first_name, last_name), crm_accounts(name)")
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    const row = data as unknown as WorkOrderRow | null;
    if (!row) return jsonNoStore({ error: { code: "work_order_not_found", message: "No such visit." } }, { status: 404 });

    const technician = row.crm_technicians === null ? null : `${row.crm_technicians.first_name}${row.crm_technicians.last_name ? ` ${row.crm_technicians.last_name}` : ""}`;
    const account = row.crm_accounts?.name ?? "the account";
    const lines = [
      `${row.service_type} for ${account}.`,
      technician === null ? "Technician: unassigned." : `Technician: ${technician}.`,
      `Status: ${row.status}.`,
      ...(row.instructions ? [`Instructions: ${row.instructions}`] : []),
    ];
    const where = row.crm_properties === null ? null : `${row.crm_properties.label}, ${row.crm_properties.address}`;
    const body = buildCalendar({
      uid: `visit-${row.id}@softwarefactory-services`,
      start: row.scheduled_start,
      end: row.scheduled_end,
      summary: `${row.service_type} — ${account}`,
      description: lines.join("\n"),
      location: where,
      organizer: activeOrganization.name ?? "Services",
      stamp: new Date().toISOString(),
    });
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${calendarFilename(row.service_type, row.scheduled_start)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "calendar_unavailable", message: "The calendar file could not be built." } }, { status: 500 });
  }
}
