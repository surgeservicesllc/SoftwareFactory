/**
 * Job profitability (ADR-231): what a visit earned and what it cost, with
 * every input beside the margin and every unknown counted rather than
 * zeroed. The per-visit rows come from `crm_visit_profitability`; the
 * groupings here are sums over the visits whose margin is KNOWN, with the
 * unknown ones counted beside them, so a technician's line reads "12
 * visits, 9 with a known margin of $1,240, 3 unknown".
 */

export type CrmVisitProfitabilityRow = {
  work_order_id: string;
  account_id: string;
  account_name: string;
  service_type: string;
  completed_at: string;
  technician_id: string | null;
  technician_name: string | null;
  branch_id: string | null;
  revenue_cents: number | null;
  invoice_count: number;
  labour_minutes: number;
  labour_basis: "timesheet" | "window";
  hourly_cost_cents: number | null;
  labour_cost_cents: number | null;
  chemical_cost_cents: number;
  applications: number;
  uncosted_applications: number;
  margin_cents: number | null;
  margin_bps: number | null;
};

export function toVisitProfitabilityView(row: CrmVisitProfitabilityRow) {
  return {
    workOrderId: row.work_order_id,
    accountId: row.account_id,
    accountName: row.account_name,
    serviceType: row.service_type,
    completedAt: row.completed_at,
    technicianId: row.technician_id,
    technicianName: row.technician_name,
    branchId: row.branch_id,
    revenueCents: row.revenue_cents === null ? null : Number(row.revenue_cents),
    invoiceCount: Number(row.invoice_count),
    labourMinutes: Number(row.labour_minutes),
    labourBasis: row.labour_basis,
    hourlyCostCents: row.hourly_cost_cents,
    labourCostCents: row.labour_cost_cents === null ? null : Number(row.labour_cost_cents),
    chemicalCostCents: Number(row.chemical_cost_cents),
    applications: Number(row.applications),
    uncostedApplications: Number(row.uncosted_applications),
    marginCents: row.margin_cents === null ? null : Number(row.margin_cents),
    marginBps: row.margin_bps,
  };
}
export type VisitProfitabilityView = ReturnType<typeof toVisitProfitabilityView>;

/** Why a visit's margin is unknown, in the words the page prints. */
export function unknownReasons(visit: VisitProfitabilityView): string[] {
  const reasons: string[] = [];
  if (visit.revenueCents === null) reasons.push("no invoice is linked to this visit");
  if (visit.hourlyCostCents === null) {
    reasons.push(visit.technicianId === null ? "no technician is recorded" : "the technician has no hourly cost on file");
  }
  if (visit.uncostedApplications > 0) {
    reasons.push(
      `${visit.uncostedApplications} application${visit.uncostedApplications === 1 ? "" : "s"} with no lot cost or a unit that does not match the lot`,
    );
  }
  return reasons;
}

export type ProfitabilityGroup = {
  key: string;
  name: string;
  visits: number;
  known: number;
  unknown: number;
  revenueCents: number;
  labourCostCents: number;
  chemicalCostCents: number;
  marginCents: number;
  /** Null over no known visits: a share of nothing is not a share. */
  marginBps: number | null;
};

function groupBy(
  visits: readonly VisitProfitabilityView[],
  keyOf: (visit: VisitProfitabilityView) => { key: string; name: string },
): ProfitabilityGroup[] {
  const groups = new Map<string, ProfitabilityGroup>();
  for (const visit of visits) {
    const { key, name } = keyOf(visit);
    const group = groups.get(key) ?? {
      key, name, visits: 0, known: 0, unknown: 0,
      revenueCents: 0, labourCostCents: 0, chemicalCostCents: 0, marginCents: 0, marginBps: null,
    };
    group.visits += 1;
    if (visit.marginCents === null || visit.revenueCents === null || visit.labourCostCents === null) {
      group.unknown += 1;
    } else {
      group.known += 1;
      group.revenueCents += visit.revenueCents;
      group.labourCostCents += visit.labourCostCents;
      group.chemicalCostCents += visit.chemicalCostCents;
      group.marginCents += visit.marginCents;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      marginBps: group.known === 0 || group.revenueCents === 0
        ? null
        : Math.round((group.marginCents * 10000) / group.revenueCents),
    }))
    .sort((a, b) => a.marginCents - b.marginCents || b.visits - a.visits);
}

export function summarizeProfitability(visits: readonly VisitProfitabilityView[]) {
  const totals = groupBy(visits, () => ({ key: "all", name: "All visits" }))[0] ?? {
    key: "all", name: "All visits", visits: 0, known: 0, unknown: 0,
    revenueCents: 0, labourCostCents: 0, chemicalCostCents: 0, marginCents: 0, marginBps: null,
  };
  return {
    totals,
    byTechnician: groupBy(visits, (visit) => ({
      key: visit.technicianId ?? "none",
      name: visit.technicianName ?? "No technician recorded",
    })),
    byService: groupBy(visits, (visit) => ({ key: visit.serviceType, name: visit.serviceType })),
    byBranch: groupBy(visits, (visit) => ({ key: visit.branchId ?? "none", name: visit.branchId ?? "No branch" })),
    unknowns: {
      visitsWithoutInvoice: visits.filter((visit) => visit.revenueCents === null).length,
      visitsWithoutRate: visits.filter((visit) => visit.hourlyCostCents === null).length,
      visitsOnWindowBasis: visits.filter((visit) => visit.labourBasis === "window").length,
      uncostedApplications: visits.reduce((sum, visit) => sum + visit.uncostedApplications, 0),
    },
  };
}
