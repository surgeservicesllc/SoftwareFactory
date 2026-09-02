/**
 * The schedule bends (ADR-239): the pure side of bulk visit edits and
 * multi-day projects. The database does the edit and the counting; this
 * file maps its rows and says, in one sentence, what a batch did.
 */

export type CrmBulkEditRow = {
  work_order_id: string;
  applied: boolean;
  reason: string | null;
  technician_id: string | null;
  scheduled_start: string | null;
  status: string | null;
};

export type BulkEditOutcome = {
  workOrderId: string;
  applied: boolean;
  reason: string | null;
  technicianId: string | null;
  scheduledStart: string | null;
  status: string | null;
};

export function toBulkEditOutcome(row: CrmBulkEditRow): BulkEditOutcome {
  return {
    workOrderId: row.work_order_id,
    applied: row.applied,
    reason: row.reason,
    technicianId: row.technician_id,
    scheduledStart: row.scheduled_start,
    status: row.status,
  };
}

/** "7 of 9 changed; 2 not: 1 completed, 1 on a route." */
export function summarizeBulkEdit(outcomes: readonly BulkEditOutcome[]): { applied: number; refused: number; sentence: string } {
  const applied = outcomes.filter((outcome) => outcome.applied).length;
  const refused = outcomes.length - applied;
  if (outcomes.length === 0) return { applied: 0, refused: 0, sentence: "Nothing was selected." };
  if (refused === 0) {
    return { applied, refused, sentence: `${applied} of ${outcomes.length} changed.` };
  }
  const reasons = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.applied) continue;
    const key = outcome.reason === null ? "refused"
      : /^completed/.test(outcome.reason) ? "completed"
      : /^on route/.test(outcome.reason) ? "on a route"
      : /not found/.test(outcome.reason) ? "not found"
      : "refused";
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const parts = [...reasons.entries()].map(([key, count]) => `${count} ${key}`);
  return { applied, refused, sentence: `${applied} of ${outcomes.length} changed; ${refused} not: ${parts.join(", ")}.` };
}

export const PROJECT_STATES = ["planned", "active", "done", "cancelled"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export const PROJECT_STATE_LABELS: Readonly<Record<ProjectState, string>> = {
  planned: "Planned",
  active: "Under way",
  done: "Done",
  cancelled: "Cancelled",
};

export type CrmProjectProgressRow = {
  project_id: string;
  name: string;
  account_id: string;
  account_name: string;
  property_id: string;
  property_label: string | null;
  technician_id: string | null;
  technician_name: string | null;
  service_type: string;
  starts_on: string;
  ends_on: string;
  status: string;
  note: string | null;
  days: number;
  completed: number;
  cancelled: number;
  remaining: number;
  next_day: string | null;
  state: string;
};

export type ProjectProgressView = {
  projectId: string;
  name: string;
  accountId: string;
  accountName: string;
  propertyId: string;
  propertyLabel: string | null;
  technicianId: string | null;
  technicianName: string | null;
  serviceType: string;
  startsOn: string;
  endsOn: string;
  note: string | null;
  days: number;
  completed: number;
  cancelled: number;
  remaining: number;
  nextDay: string | null;
  state: ProjectState;
};

function projectState(value: string): ProjectState {
  return (PROJECT_STATES as readonly string[]).includes(value) ? (value as ProjectState) : "planned";
}

export function toProjectProgressView(row: CrmProjectProgressRow): ProjectProgressView {
  return {
    projectId: row.project_id,
    name: row.name,
    accountId: row.account_id,
    accountName: row.account_name,
    propertyId: row.property_id,
    propertyLabel: row.property_label,
    technicianId: row.technician_id,
    technicianName: row.technician_name,
    serviceType: row.service_type,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    note: row.note,
    days: Number(row.days),
    completed: Number(row.completed),
    cancelled: Number(row.cancelled),
    remaining: Number(row.remaining),
    nextDay: row.next_day,
    state: projectState(row.state),
  };
}

/** "Day 2 of 4" for a visit that is one day of a project; null for any other visit. */
export function projectDayLabel(
  visit: { projectId: string | null; scheduledStart: string },
  siblings: ReadonlyArray<{ projectId: string | null; scheduledStart: string }>,
): string | null {
  if (visit.projectId === null) return null;
  const days = siblings
    .filter((entry) => entry.projectId === visit.projectId)
    .map((entry) => entry.scheduledStart.slice(0, 10))
    .filter((day, index, all) => all.indexOf(day) === index)
    .sort();
  const index = days.indexOf(visit.scheduledStart.slice(0, 10));
  if (index === -1) return null;
  return `Day ${index + 1} of ${days.length}`;
}
