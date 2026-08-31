import {
  CRM_COMMISSION_COLUMNS,
  CRM_EMPLOYEE_COLUMNS,
  CRM_OPEN_OPPORTUNITY_STAGES,
  CRM_OPPORTUNITY_COLUMNS,
  employeeName,
  toCommissionView,
  toEmployeeView,
  toOpportunityView,
  type CrmCommissionRow,
  type CrmEmployeeRow,
  type CrmOpportunityRow,
} from "@/lib/services/crm";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The sales leaderboard: what each rep has open, what they closed, at what
 * rate, and what it earned them.
 *
 * Every figure is derived from the rows the pipeline and the commission
 * ledger already hold — the same authority the board and the payout page
 * read. A rep with no deals appears with zeroes rather than being dropped:
 * a leaderboard that silently omits the people at the bottom is a
 * flattering chart, not a report.
 *
 * Win rate is reported as null, not zero, for a rep with nothing decided
 * yet. Zero would read as "loses everything", which is a different claim.
 */

const OPEN = new Set<string>(CRM_OPEN_OPPORTUNITY_STAGES);

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const [employeeRows, opportunityRows, commissionRows] = await Promise.all([
      client
        .from("crm_employees")
        .select(CRM_EMPLOYEE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .limit(600),
      client
        .from("crm_opportunities")
        .select(CRM_OPPORTUNITY_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .limit(5000),
      client
        .from("crm_commissions")
        .select(CRM_COMMISSION_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .limit(5000),
    ]);
    if (employeeRows.error) return databaseErrorResponse(employeeRows.error);
    if (opportunityRows.error) return databaseErrorResponse(opportunityRows.error);
    if (commissionRows.error) return databaseErrorResponse(commissionRows.error);

    const employees = ((employeeRows.data ?? []) as unknown as CrmEmployeeRow[]).map(toEmployeeView);
    const opportunities = ((opportunityRows.data ?? []) as unknown as CrmOpportunityRow[]).map(
      toOpportunityView,
    );
    const commissions = ((commissionRows.data ?? []) as unknown as CrmCommissionRow[]).map(
      toCommissionView,
    );

    const rows = employees
      // Only people who can own a deal belong on a sales board.
      .filter((employee) => employee.commissionBps !== null || employee.monthlyQuotaCents !== null)
      .map((employee) => {
        const mine = opportunities.filter(
          (opportunity) => opportunity.ownerEmployeeId === employee.id,
        );
        const won = mine.filter((opportunity) => opportunity.stage === "won");
        const lost = mine.filter((opportunity) => opportunity.stage === "lost");
        const open = mine.filter((opportunity) => OPEN.has(opportunity.stage));
        const decided = won.length + lost.length;
        const earned = commissions.filter((commission) => commission.employeeId === employee.id);
        const value = (list: { valueCents: number | null }[]) =>
          list.reduce((sum, item) => sum + (item.valueCents ?? 0), 0);
        const wonValueCents = value(won);

        return {
          employeeId: employee.id,
          name: employeeName(employee),
          role: employee.role,
          branchId: employee.branchId,
          active: employee.active,
          openCount: open.length,
          openValueCents: value(open),
          wonCount: won.length,
          wonValueCents,
          lostCount: lost.length,
          // Null, not zero, when nothing has been decided yet.
          winRate: decided === 0 ? null : Math.round((won.length / decided) * 100),
          quotaCents: employee.monthlyQuotaCents,
          // Attainment needs a quota to be a fraction of.
          quotaAttainment:
            employee.monthlyQuotaCents === null || employee.monthlyQuotaCents === 0
              ? null
              : Math.round((wonValueCents / employee.monthlyQuotaCents) * 100),
          commissionAccruedCents: earned
            .filter((commission) => commission.status === "accrued")
            .reduce((sum, commission) => sum + commission.amountCents, 0),
          commissionPaidCents: earned
            .filter((commission) => commission.status === "paid")
            .reduce((sum, commission) => sum + commission.amountCents, 0),
        };
      })
      .sort((left, right) => right.wonValueCents - left.wonValueCents);

    return jsonNoStore({
      rows,
      totals: {
        reps: rows.length,
        wonValueCents: rows.reduce((sum, row) => sum + row.wonValueCents, 0),
        openValueCents: rows.reduce((sum, row) => sum + row.openValueCents, 0),
        commissionPaidCents: rows.reduce((sum, row) => sum + row.commissionPaidCents, 0),
        // Deals nobody owns: the honest denominator behind every row above.
        unownedOpportunities: opportunities.filter(
          (opportunity) => opportunity.ownerEmployeeId === null,
        ).length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_leaderboard_unavailable", message: "The leaderboard could not be built." } },
      { status: 500 },
    );
  }
}
