import {
  summarizeProfitability,
  toVisitProfitabilityView,
  type CrmVisitProfitabilityRow,
} from "@/lib/services/profitability";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Per-visit profitability over a window, grouped by technician, service
 * and branch, with every unknown counted. The per-visit rows are computed
 * by `crm_visit_profitability` under the caller's RLS; the groupings sum
 * only the visits whose margin is known and count the rest beside them.
 */

function window(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

const VISIT_CEILING = 5000;

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;
    const days = window(new URL(request.url).searchParams.get("days"), 90, 730);

    const [visitsRead, techniciansRead, branchesRead, lotsRead] = await Promise.all([
      client
        .rpc("crm_visit_profitability", { p_organization: organizationId, p_days: days })
        .limit(VISIT_CEILING),
      client
        .from("crm_technicians")
        .select("id, first_name, last_name, active, hourly_cost_cents")
        .eq("organization_id", organizationId)
        .order("first_name")
        .limit(500),
      client
        .from("crm_branches")
        .select("id, name, code")
        .eq("organization_id", organizationId)
        .limit(200),
      client
        .from("crm_product_lots")
        .select("id, product_id, lot_number, unit, unit_cost_cents, received_on, quantity_remaining")
        .eq("organization_id", organizationId)
        .order("received_on", { ascending: false })
        .limit(200),
    ]);
    if (visitsRead.error) return databaseErrorResponse(visitsRead.error);
    if (techniciansRead.error) return databaseErrorResponse(techniciansRead.error);
    if (branchesRead.error) return databaseErrorResponse(branchesRead.error);
    if (lotsRead.error) return databaseErrorResponse(lotsRead.error);

    const visits = ((visitsRead.data ?? []) as unknown as CrmVisitProfitabilityRow[]).map(toVisitProfitabilityView);
    const summary = summarizeProfitability(visits);
    const branchName = new Map(
      ((branchesRead.data ?? []) as Array<{ id: string; name: string; code: string }>).map(
        (branch) => [branch.id, `${branch.name} (${branch.code})`],
      ),
    );

    return jsonNoStore({
      window: { days, visitCeiling: VISIT_CEILING, truncated: visits.length >= VISIT_CEILING },
      totals: summary.totals,
      byTechnician: summary.byTechnician,
      byService: summary.byService,
      byBranch: summary.byBranch.map((group) => ({ ...group, name: branchName.get(group.key) ?? group.name })),
      unknowns: summary.unknowns,
      // Worst first, as the function orders them; the page shows the tail.
      visits: visits.slice(0, 200),
      costs: {
        technicians: ((techniciansRead.data ?? []) as Array<{
          id: string; first_name: string; last_name: string | null; active: boolean; hourly_cost_cents: number | null;
        }>).map((technician) => ({
          id: technician.id,
          name: `${technician.first_name}${technician.last_name ? ` ${technician.last_name}` : ""}`,
          active: technician.active,
          hourlyCostCents: technician.hourly_cost_cents,
        })),
        lots: ((lotsRead.data ?? []) as Array<{
          id: string; product_id: string; lot_number: string; unit: string; unit_cost_cents: number | null;
          received_on: string; quantity_remaining: number;
        }>).map((lot) => ({
          id: lot.id,
          productId: lot.product_id,
          lotNumber: lot.lot_number,
          unit: lot.unit,
          unitCostCents: lot.unit_cost_cents,
          receivedOn: lot.received_on,
          quantityRemaining: Number(lot.quantity_remaining),
        })),
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_profitability_unavailable", message: "Profitability could not be computed." } },
      { status: 500 },
    );
  }
}
