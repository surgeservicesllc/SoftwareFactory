/**
 * The customer's side of the conversation (ADR-233): the pure side of the
 * SLA clock, the post-visit survey and the two-way message thread. Every
 * mapping here is over rows the database computed under the caller's RLS
 * (staff) or through a definer scoped to the caller's own account
 * (customer); nothing is inferred and nothing is stored here.
 */

/* --- the SLA clock -------------------------------------------------------- */

export const SLA_STATES = ["overdue", "breached", "waiting", "met", "unrecorded"] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const SLA_STATE_LABELS: Readonly<Record<SlaState, string>> = {
  overdue: "Overdue",
  breached: "Breached",
  waiting: "Within time",
  met: "Met",
  unrecorded: "Moment not recorded",
};

function slaState(value: string): SlaState {
  return (SLA_STATES as readonly string[]).includes(value) ? (value as SlaState) : "unrecorded";
}

export type CrmRequestSlaRow = {
  request_id: string;
  account_id: string;
  account_name: string;
  kind: string;
  status: string;
  summary: string;
  submitted_at: string;
  acknowledged_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  acknowledge_hours: number;
  resolve_hours: number;
  acknowledge_due_at: string;
  resolve_due_at: string;
  acknowledge_state: string;
  resolve_state: string;
  waiting_minutes: number | null;
};

export type RequestSlaView = {
  requestId: string;
  accountId: string;
  accountName: string;
  kind: string;
  status: string;
  summary: string;
  submittedAt: string;
  acknowledgedAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  acknowledgeHours: number;
  resolveHours: number;
  acknowledgeDueAt: string;
  resolveDueAt: string;
  acknowledgeState: SlaState;
  resolveState: SlaState;
  waitingMinutes: number | null;
  open: boolean;
};

export function toRequestSlaView(row: CrmRequestSlaRow): RequestSlaView {
  return {
    requestId: row.request_id,
    accountId: row.account_id,
    accountName: row.account_name,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    submittedAt: row.submitted_at,
    acknowledgedAt: row.acknowledged_at,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    acknowledgeHours: row.acknowledge_hours,
    resolveHours: row.resolve_hours,
    acknowledgeDueAt: row.acknowledge_due_at,
    resolveDueAt: row.resolve_due_at,
    acknowledgeState: slaState(row.acknowledge_state),
    resolveState: slaState(row.resolve_state),
    waitingMinutes: row.waiting_minutes,
    open: row.resolved_at === null,
  };
}

export type SlaSummary = {
  requests: number;
  open: number;
  /** Open requests past either promise right now: the queue that is late. */
  overdue: number;
  acknowledge: Record<SlaState, number>;
  resolve: Record<SlaState, number>;
};

function emptyStates(): Record<SlaState, number> {
  return { overdue: 0, breached: 0, waiting: 0, met: 0, unrecorded: 0 };
}

export function summarizeSla(rows: ReadonlyArray<RequestSlaView>): SlaSummary {
  const acknowledge = emptyStates();
  const resolve = emptyStates();
  let open = 0;
  let overdue = 0;
  for (const row of rows) {
    acknowledge[row.acknowledgeState] += 1;
    resolve[row.resolveState] += 1;
    if (row.open) open += 1;
    if (row.open && (row.acknowledgeState === "overdue" || row.resolveState === "overdue")) overdue += 1;
  }
  return { requests: rows.length, open, overdue, acknowledge, resolve };
}

export type CrmEffectiveSlaRow = {
  kind: string;
  acknowledge_hours: number;
  resolve_hours: number;
  overridden: boolean;
};

export type SlaPolicyView = {
  kind: string;
  acknowledgeHours: number;
  resolveHours: number;
  overridden: boolean;
};

export function toSlaPolicyView(row: CrmEffectiveSlaRow): SlaPolicyView {
  return {
    kind: row.kind,
    acknowledgeHours: row.acknowledge_hours,
    resolveHours: row.resolve_hours,
    overridden: row.overridden,
  };
}

/* --- surveys ---------------------------------------------------------------- */

export type CrmSurveyResponseRow = {
  survey_id: string;
  work_order_id: string;
  account_id: string;
  account_name: string;
  service_type: string;
  technician_id: string | null;
  technician_name: string | null;
  completed_at: string | null;
  score: number;
  comment: string | null;
  submitted_at: string;
};

export type SurveyResponseView = {
  surveyId: string;
  workOrderId: string;
  accountId: string;
  accountName: string;
  serviceType: string;
  technicianId: string | null;
  technicianName: string | null;
  completedAt: string | null;
  score: number;
  comment: string | null;
  submittedAt: string;
};

export function toSurveyResponseView(row: CrmSurveyResponseRow): SurveyResponseView {
  return {
    surveyId: row.survey_id,
    workOrderId: row.work_order_id,
    accountId: row.account_id,
    accountName: row.account_name,
    serviceType: row.service_type,
    technicianId: row.technician_id,
    technicianName: row.technician_name,
    completedAt: row.completed_at,
    score: row.score,
    comment: row.comment,
    submittedAt: row.submitted_at,
  };
}

export type SurveySummary = {
  responses: number;
  completedVisits: number;
  /** Null until somebody answers: an average of nothing is not a score. */
  averageScore: number | null;
  /** Null until a visit was completed: a rate with no denominator. */
  responseRateBps: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  byTechnician: Array<{ technicianId: string | null; technicianName: string; responses: number; averageScore: number }>;
  /** Scores of 1 or 2, lowest first: the visits to call back about. */
  detractors: SurveyResponseView[];
};

export function summarizeSurveys(
  responses: ReadonlyArray<SurveyResponseView>,
  completedVisits: number,
): SurveySummary {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const technicians = new Map<string, { technicianId: string | null; technicianName: string; total: number; responses: number }>();
  let total = 0;
  for (const response of responses) {
    const score = Math.min(5, Math.max(1, Math.round(response.score))) as 1 | 2 | 3 | 4 | 5;
    distribution[score] += 1;
    total += response.score;
    const key = response.technicianId ?? "none";
    const entry = technicians.get(key) ?? {
      technicianId: response.technicianId,
      technicianName: response.technicianName ?? "No technician",
      total: 0,
      responses: 0,
    };
    entry.total += response.score;
    entry.responses += 1;
    technicians.set(key, entry);
  }
  return {
    responses: responses.length,
    completedVisits,
    averageScore: responses.length === 0 ? null : Math.round((total / responses.length) * 100) / 100,
    responseRateBps:
      completedVisits === 0 ? null : Math.min(10_000, Math.round((responses.length * 10_000) / completedVisits)),
    distribution,
    byTechnician: [...technicians.values()]
      .map((entry) => ({
        technicianId: entry.technicianId,
        technicianName: entry.technicianName,
        responses: entry.responses,
        averageScore: Math.round((entry.total / entry.responses) * 100) / 100,
      }))
      .sort((a, b) => a.averageScore - b.averageScore || b.responses - a.responses),
    detractors: responses
      .filter((response) => response.score <= 2)
      .sort((a, b) => a.score - b.score || b.submittedAt.localeCompare(a.submittedAt)),
  };
}

export type CrmPortalSurveyMineRow = {
  work_order_id: string;
  score: number;
  comment: string | null;
  submitted_at: string;
};

export type PortalSurveyMineView = {
  workOrderId: string;
  score: number;
  comment: string | null;
  submittedAt: string;
};

export function toPortalSurveyMineView(row: CrmPortalSurveyMineRow): PortalSurveyMineView {
  return { workOrderId: row.work_order_id, score: row.score, comment: row.comment, submittedAt: row.submitted_at };
}

/* --- messages --------------------------------------------------------------- */

export const CRM_PORTAL_MESSAGE_COLUMNS =
  "id, account_id, request_id, author_kind, portal_user_id, author_user_id, body, sent_at, read_at";

export type CrmPortalMessageRow = {
  id: string;
  account_id: string;
  request_id: string | null;
  author_kind: "customer" | "staff";
  portal_user_id: string | null;
  author_user_id: string | null;
  body: string;
  sent_at: string;
  read_at: string | null;
};

export type PortalMessageView = {
  id: string;
  accountId: string;
  requestId: string | null;
  authorKind: "customer" | "staff";
  portalUserId: string | null;
  authorUserId: string | null;
  body: string;
  sentAt: string;
  readAt: string | null;
};

export function toPortalMessageView(row: CrmPortalMessageRow): PortalMessageView {
  return {
    id: row.id,
    accountId: row.account_id,
    requestId: row.request_id,
    authorKind: row.author_kind,
    portalUserId: row.portal_user_id,
    authorUserId: row.author_user_id,
    body: row.body,
    sentAt: row.sent_at,
    readAt: row.read_at,
  };
}

export type MessageThreadSummary = {
  messages: number;
  /** Customer messages nobody on staff has opened: the queue. */
  unreadFromCustomers: number;
  /** Accounts with at least one unread customer message, most recent first. */
  accountsAwaiting: Array<{ accountId: string; unread: number; latestAt: string }>;
};

export function summarizeThreads(messages: ReadonlyArray<PortalMessageView>): MessageThreadSummary {
  const awaiting = new Map<string, { unread: number; latestAt: string }>();
  let unread = 0;
  for (const message of messages) {
    if (message.authorKind !== "customer" || message.readAt !== null) continue;
    unread += 1;
    const entry = awaiting.get(message.accountId) ?? { unread: 0, latestAt: message.sentAt };
    entry.unread += 1;
    if (message.sentAt > entry.latestAt) entry.latestAt = message.sentAt;
    awaiting.set(message.accountId, entry);
  }
  return {
    messages: messages.length,
    unreadFromCustomers: unread,
    accountsAwaiting: [...awaiting.entries()]
      .map(([accountId, entry]) => ({ accountId, ...entry }))
      .sort((a, b) => b.latestAt.localeCompare(a.latestAt)),
  };
}

export type CrmPortalMessageMineRow = {
  id: string;
  request_id: string | null;
  author_kind: "customer" | "staff";
  body: string;
  sent_at: string;
  read_at: string | null;
};

export type PortalMessageMineView = {
  id: string;
  requestId: string | null;
  authorKind: "customer" | "staff";
  body: string;
  sentAt: string;
  readAt: string | null;
};

export function toPortalMessageMineView(row: CrmPortalMessageMineRow): PortalMessageMineView {
  return {
    id: row.id,
    requestId: row.request_id,
    authorKind: row.author_kind,
    body: row.body,
    sentAt: row.sent_at,
    readAt: row.read_at,
  };
}
