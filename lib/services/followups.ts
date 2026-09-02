/**
 * Follow-ups: what somebody agreed to do, and what the book suggests next.
 *
 * The suggestions are computed by `crm_suggest_followups` from the
 * workspace's own rows at the moment of asking — the same honesty rule as
 * the copilot. Nothing here scores, ranks by a model, or guesses; a rule
 * fires because a fact holds, and the reason printed beside a suggestion IS
 * the fact.
 */

export const CRM_TASK_STATUSES = ["open", "done", "cancelled"] as const;
export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number];

export const CRM_TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type CrmTaskPriority = (typeof CRM_TASK_PRIORITIES)[number];

export const CRM_TASK_ORIGINS = ["manual", "suggested"] as const;
export type CrmTaskOrigin = (typeof CRM_TASK_ORIGINS)[number];

/** rule:uuid — the shape the schema also enforces. */
export const CRM_SUGGESTION_KEY_PATTERN =
  /^[a-z_]{3,40}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CRM_TASK_COLUMNS =
  "id, organization_id, account_id, opportunity_id, assignee_employee_id, title, detail, due_on, "
  + "priority, status, origin, suggestion_key, reason, done_at, cancelled_at, created_by, "
  + "created_at, updated_at";

export type CrmTaskRow = {
  id: string;
  organization_id: string;
  account_id: string | null;
  opportunity_id: string | null;
  assignee_employee_id: string | null;
  title: string;
  detail: string | null;
  due_on: string;
  priority: CrmTaskPriority;
  status: CrmTaskStatus;
  origin: CrmTaskOrigin;
  suggestion_key: string | null;
  reason: string | null;
  done_at: string | null;
  cancelled_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CrmSuggestionRow = {
  suggestion_key: string;
  rule: string;
  account_id: string | null;
  opportunity_id: string | null;
  title: string;
  reason: string;
  due_on: string;
  priority: CrmTaskPriority;
};

export function toTaskView(row: CrmTaskRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    opportunityId: row.opportunity_id,
    assigneeEmployeeId: row.assignee_employee_id,
    title: row.title,
    detail: row.detail,
    dueOn: row.due_on,
    priority: row.priority,
    status: row.status,
    origin: row.origin,
    suggestionKey: row.suggestion_key,
    reason: row.reason,
    doneAt: row.done_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export type TaskView = ReturnType<typeof toTaskView>;

export function toSuggestionView(row: CrmSuggestionRow) {
  return {
    suggestionKey: row.suggestion_key,
    rule: row.rule,
    accountId: row.account_id,
    opportunityId: row.opportunity_id,
    title: row.title,
    reason: row.reason,
    dueOn: row.due_on,
    priority: row.priority,
  };
}
export type SuggestionView = ReturnType<typeof toSuggestionView>;

/** What each rule is, in the words the page shows. */
export const SUGGESTION_RULES: Readonly<Record<string, string>> = {
  stale_lead: "A lead or prospect with no recorded activity in 14 days",
  overdue_opportunity: "An open deal past the date it was expected to close",
  estimate_undecided: "An estimate sent ten days ago with no decision",
  request_unanswered: "A customer's portal request nobody acknowledged in 2 days",
  invoice_quiet: "An overdue invoice with no collection action in 7 days",
  licence_expiring: "A technician's licence expiring within 30 days",
  sighting_uncorrected: "A high-severity sighting three days without correction",
};

/**
 * Which bucket a task belongs in today. Cancelled and done tasks never
 * bucket — the page shows them apart, as history.
 */
export function taskBucket(task: { status: CrmTaskStatus; dueOn: string }, today: string):
  | "overdue"
  | "today"
  | "later"
  | null {
  if (task.status !== "open") return null;
  if (task.dueOn < today) return "overdue";
  if (task.dueOn === today) return "today";
  return "later";
}
