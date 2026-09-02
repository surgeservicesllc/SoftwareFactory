/**
 * Conversation routing (ADR-240): the pure side. The database chooses the
 * suggested person and prints why; this file maps its rows and composes
 * the copilot's sentence about what nobody has picked up.
 */

export type CrmRequestSuggestionRow = {
  employee_id: string | null;
  employee_name: string | null;
  role: string | null;
  reason: string;
  territory_code: string | null;
  postal_code: string | null;
  open_requests: number | null;
};

export type RequestSuggestionView = {
  employeeId: string | null;
  employeeName: string | null;
  role: string | null;
  reason: string;
  territoryCode: string | null;
  postalCode: string | null;
  openRequests: number | null;
};

export function toRequestSuggestionView(row: CrmRequestSuggestionRow): RequestSuggestionView {
  return {
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    role: row.role,
    reason: row.reason,
    territoryCode: row.territory_code,
    postalCode: row.postal_code,
    openRequests: row.open_requests === null ? null : Number(row.open_requests),
  };
}

export type CrmRequestQueueRow = {
  request_id: string;
  account_id: string;
  account_name: string;
  kind: string;
  status: string;
  summary: string;
  submitted_at: string;
  waiting_minutes: number;
  assignee_employee_id: string | null;
  assignee_name: string | null;
  assigned_at: string | null;
  suggested_employee_id: string | null;
  suggested_name: string | null;
  suggested_reason: string | null;
};

export type RequestQueueView = {
  requestId: string;
  accountId: string;
  accountName: string;
  kind: string;
  status: string;
  summary: string;
  submittedAt: string;
  waitingMinutes: number;
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  assignedAt: string | null;
  suggestedEmployeeId: string | null;
  suggestedName: string | null;
  suggestedReason: string | null;
};

export function toRequestQueueView(row: CrmRequestQueueRow): RequestQueueView {
  return {
    requestId: row.request_id,
    accountId: row.account_id,
    accountName: row.account_name,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    submittedAt: row.submitted_at,
    waitingMinutes: Number(row.waiting_minutes),
    assigneeEmployeeId: row.assignee_employee_id,
    assigneeName: row.assignee_name,
    assignedAt: row.assigned_at,
    suggestedEmployeeId: row.suggested_employee_id,
    suggestedName: row.suggested_name,
    suggestedReason: row.suggested_reason,
  };
}

export type QueueEmployee = { id: string; name: string; role: string };

/** Hours or days, in a person's words: "6.5 h", "3 d". */
export function waitingLabel(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min`;
  if (minutes < 48 * 60) return `${Math.round((minutes / 60) * 10) / 10} h`;
  return `${Math.round(minutes / (60 * 24))} d`;
}

/**
 * "3 of 9 open requests have nobody. Oldest: Harborview Foods — 'Ants in
 * the dry store' (6.5 h), suggested Ana Cruz (branch manager of North; …).
 * Accept the suggestions on the Customer Portal page."
 */
export function composeUnassignedAnswer(facts: {
  open: number;
  unassigned: Array<{ account: string; summary: string; waitingMinutes: number; suggestedName: string | null; reason: string | null }>;
}): string {
  if (facts.open === 0) return "Nothing is open on the help desk.";
  if (facts.unassigned.length === 0) {
    return `${facts.open} ${facts.open === 1 ? "request is" : "requests are"} open and every one has a person.`;
  }
  const first = facts.unassigned[0]!;
  const suggestion = first.suggestedName === null
    ? `nobody to suggest${first.reason ? ` (${first.reason.replace(/^nobody: /, "")})` : ""}`
    : `suggested ${first.suggestedName}${first.reason ? ` (${first.reason})` : ""}`;
  return `${facts.unassigned.length} of ${facts.open} open ${facts.open === 1 ? "request has" : "requests have"} nobody. Oldest: ${first.account} — “${first.summary}” (${waitingLabel(first.waitingMinutes)}), ${suggestion}. Accept the suggestions on the Customer Portal page under Requests.`;
}
