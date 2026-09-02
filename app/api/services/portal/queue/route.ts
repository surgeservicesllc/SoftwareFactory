import { toRequestQueueView, type CrmRequestQueueRow, type QueueEmployee } from "@/lib/services/conversation-routing";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The help desk by person (ADR-240): every open request with who has it,
 * the suggestion for those nobody has, the people it could go to, and the
 * caller's own staff record so "mine" is a filter and not a guess.
 */

type EmployeeRow = { id: string; first_name: string; last_name: string | null; role: string };

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const [queue, employees, me] = await Promise.all([
      client.rpc("crm_request_queue", { p_organization: activeOrganization.id }).limit(500),
      client.from("crm_employees").select("id, first_name, last_name, role").eq("organization_id", activeOrganization.id).eq("active", true).order("last_name", { ascending: true }).limit(500),
      client.rpc("crm_my_employee"),
    ]);
    if (queue.error) return databaseErrorResponse(queue.error);
    if (employees.error) return databaseErrorResponse(employees.error);
    if (me.error) return databaseErrorResponse(me.error);
    const rows = ((queue.data ?? []) as unknown as CrmRequestQueueRow[]).map(toRequestQueueView);
    const people: QueueEmployee[] = ((employees.data ?? []) as EmployeeRow[]).map((row) => ({
      id: row.id,
      name: `${row.first_name}${row.last_name ? ` ${row.last_name}` : ""}`,
      role: row.role,
    }));
    return jsonNoStore({
      queue: rows,
      employees: people,
      myEmployeeId: (me.data as string | null) ?? null,
      counts: {
        open: rows.length,
        unassigned: rows.filter((row) => row.assigneeEmployeeId === null).length,
        mine: rows.filter((row) => row.assigneeEmployeeId !== null && row.assigneeEmployeeId === ((me.data as string | null) ?? null)).length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "queue_unavailable", message: "The help desk queue could not be read." } }, { status: 500 });
  }
}
