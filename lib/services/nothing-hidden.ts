/**
 * Nothing hidden (ADR-232): the pure side of three functions that open a
 * figure up — the schedule audit, the automation dry run and the dashboard
 * drill-down. Everything here is a mapping or a count over rows the
 * database already computed under the caller's RLS; nothing is inferred.
 */

/* --- schedule audit ------------------------------------------------------ */

export type CrmScheduleFindingRow = {
  finding: string;
  severity: string;
  occurs_on: string;
  work_order_id: string | null;
  other_work_order_id: string | null;
  plan_id: string | null;
  route_id: string | null;
  account_id: string;
  account_name: string;
  technician_id: string | null;
  technician_name: string | null;
  detail: string;
};

export type FindingSeverity = "high" | "medium" | "low";

export type ScheduleFindingView = {
  finding: string;
  label: string;
  severity: FindingSeverity;
  occursOn: string;
  workOrderId: string | null;
  otherWorkOrderId: string | null;
  planId: string | null;
  routeId: string | null;
  accountId: string;
  accountName: string;
  technicianId: string | null;
  technicianName: string | null;
  detail: string;
};

/** Every finding the audit can raise, in the words a dispatcher uses. */
export const FINDING_LABELS: Readonly<Record<string, string>> = {
  double_booked: "Double-booked technician",
  slipped: "Window passed, visit still open",
  unrouted: "Scheduled but on no route",
  plan_due_unscheduled: "Plan due with no visit",
  arrival_outside_window: "Planned arrival outside the promised window",
  technician_mismatch: "Routed under a different technician",
};

function severityOf(value: string): FindingSeverity {
  return value === "high" || value === "medium" ? value : "low";
}

export function toScheduleFindingView(row: CrmScheduleFindingRow): ScheduleFindingView {
  return {
    finding: row.finding,
    label: FINDING_LABELS[row.finding] ?? row.finding.replace(/_/g, " "),
    severity: severityOf(row.severity),
    occursOn: String(row.occurs_on).slice(0, 10),
    workOrderId: row.work_order_id,
    otherWorkOrderId: row.other_work_order_id,
    planId: row.plan_id,
    routeId: row.route_id,
    accountId: row.account_id,
    accountName: row.account_name,
    technicianId: row.technician_id,
    technicianName: row.technician_name,
    detail: row.detail,
  };
}

export type ScheduleAuditSummary = {
  total: number;
  bySeverity: Record<FindingSeverity, number>;
  byFinding: Array<{ finding: string; label: string; count: number }>;
};

export function summarizeFindings(findings: ReadonlyArray<ScheduleFindingView>): ScheduleAuditSummary {
  const bySeverity: Record<FindingSeverity, number> = { high: 0, medium: 0, low: 0 };
  const counts = new Map<string, number>();
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    counts.set(finding.finding, (counts.get(finding.finding) ?? 0) + 1);
  }
  const byFinding = Object.keys(FINDING_LABELS)
    .filter((key) => counts.has(key))
    .map((key) => ({ finding: key, label: FINDING_LABELS[key], count: counts.get(key) ?? 0 }));
  for (const [key, count] of counts) {
    if (!(key in FINDING_LABELS)) byFinding.push({ finding: key, label: key.replace(/_/g, " "), count });
  }
  return { total: findings.length, bySeverity, byFinding };
}

/* --- automation dry run -------------------------------------------------- */

export type CrmDryRunRow = {
  record_kind: string;
  record_id: string;
  account_id: string;
  account_name: string;
  occurred_at: string;
  fires_at: string;
  would_do: string;
  blocked_reason: string | null;
};

export type DryRunRecordView = {
  recordKind: string;
  recordId: string;
  accountId: string;
  accountName: string;
  occurredAt: string;
  firesAt: string;
  wouldDo: string;
  blockedReason: string | null;
};

export function toDryRunRecordView(row: CrmDryRunRow): DryRunRecordView {
  return {
    recordKind: row.record_kind,
    recordId: row.record_id,
    accountId: row.account_id,
    accountName: row.account_name,
    occurredAt: row.occurred_at,
    firesAt: row.fires_at,
    wouldDo: row.would_do,
    blockedReason: row.blocked_reason,
  };
}

export type DryRunSummary = {
  records: number;
  wouldAct: number;
  blocked: number;
  byReason: Array<{ reason: string; count: number }>;
};

export function summarizeDryRun(records: ReadonlyArray<DryRunRecordView>): DryRunSummary {
  const reasons = new Map<string, number>();
  let blocked = 0;
  for (const record of records) {
    if (record.blockedReason === null) continue;
    blocked += 1;
    reasons.set(record.blockedReason, (reasons.get(record.blockedReason) ?? 0) + 1);
  }
  return {
    records: records.length,
    wouldAct: records.length - blocked,
    blocked,
    byReason: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

/* --- dashboard drill-down ------------------------------------------------ */

export const DASHBOARD_FIGURES = [
  "invoiced_month",
  "overdue",
  "aging",
  "no_plan",
  "retention",
  "technician",
  "route_day",
] as const;

export type DashboardFigure = (typeof DASHBOARD_FIGURES)[number];

const AGING_BUCKETS = new Set(["current", "1-30", "31-60", "61-90", "90+", "undated"]);
const RETENTION_KEYS = new Set(["customer", "inactive", "prospect"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The key a figure takes, checked in code so the database never sees a
 * key shaped for a different figure. Returns the reason a key is wrong,
 * or null when it is acceptable.
 */
export function figureKeyProblem(figure: DashboardFigure, key: string | null): string | null {
  switch (figure) {
    case "invoiced_month":
      return key !== null && DATE.test(key) ? null : "invoiced_month takes a month as YYYY-MM-DD.";
    case "aging":
      return key !== null && AGING_BUCKETS.has(key) ? null : "aging takes a bucket name.";
    case "retention":
      return key !== null && RETENTION_KEYS.has(key) ? null : "retention takes customer, inactive or prospect.";
    case "technician":
      return key !== null && UUID.test(key) ? null : "technician takes a technician id.";
    case "route_day": {
      const [day, technician, extra] = (key ?? "").split("|");
      return extra === undefined && DATE.test(day ?? "") && UUID.test(technician ?? "")
        ? null
        : "route_day takes YYYY-MM-DD|technician-id.";
    }
    case "overdue":
    case "no_plan":
      return key === null || key === "" ? null : `${figure} takes no key.`;
  }
}

export type CrmDashboardRowRow = {
  row_kind: string;
  row_id: string;
  account_id: string;
  account_name: string;
  label: string;
  occurred_on: string | null;
  amount_cents: number | string | null;
  status: string;
};

export type DashboardRowView = {
  rowKind: string;
  rowId: string;
  accountId: string;
  accountName: string;
  label: string;
  occurredOn: string | null;
  amountCents: number | null;
  status: string;
};

export function toDashboardRowView(row: CrmDashboardRowRow): DashboardRowView {
  return {
    rowKind: row.row_kind,
    rowId: row.row_id,
    accountId: row.account_id,
    accountName: row.account_name,
    label: row.label,
    occurredOn: row.occurred_on === null ? null : String(row.occurred_on).slice(0, 10),
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    status: row.status,
  };
}
