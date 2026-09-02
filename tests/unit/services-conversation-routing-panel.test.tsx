import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesPortalPanel } from "@/components/services/portal-panel";

/**
 * Routing as a person works it: an open request nobody has shows its
 * suggested person with the reason, Accept assigns through the route,
 * the select reassigns, and "Mine only" narrows to the caller's own.
 */

const accountId = "20000000-0000-4000-8000-000000600001";
const requestId = "a0000000-0000-4000-8000-000000600001";

const portalUsers = {
  portalUsers: [{
    id: "pu1", accountId, accountName: "Harborview Foods", contactId: null, linked: true, email: "dana@harborview.example",
    role: "viewer", invitedAt: "2026-03-01T00:00:00Z", activatedAt: "2026-03-02T00:00:00Z", lastSeenAt: null, active: true, state: "active",
    createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z",
  }],
  counts: { total: 1, active: 1, invited: 0, suspended: 0 },
};

const clock = {
  window: { days: 30 },
  requests: [{
    requestId: "r1", accountId, accountName: "Harborview Foods", kind: "complaint", status: "submitted", summary: "Ants along the back wall again",
    submittedAt: "2026-04-01T08:00:00Z", acknowledgedAt: null, firstResponseAt: null, resolvedAt: null,
    acknowledgeHours: 4, resolveHours: 48, acknowledgeDueAt: "2026-04-01T12:00:00Z", resolveDueAt: "2026-04-03T08:00:00Z",
    acknowledgeState: "overdue", resolveState: "waiting", waitingMinutes: 390, open: true,
  }],
  summary: { requests: 1, open: 1, overdue: 1, acknowledge: { overdue: 1, breached: 0, waiting: 0, met: 0, unrecorded: 0 }, resolve: { overdue: 0, breached: 0, waiting: 1, met: 0, unrecorded: 0 } },
  policies: [
    { kind: "service", acknowledgeHours: 24, resolveHours: 120, overridden: false },
    { kind: "complaint", acknowledgeHours: 4, resolveHours: 48, overridden: false },
  ],
  ceiling: { requests: 500, reached: false },
};

const surveys = {
  window: { days: 90 },
  responses: [],
  summary: {
    responses: 8, completedVisits: 20, averageScore: 4.25, responseRateBps: 4000,
    distribution: { 1: 0, 2: 1, 3: 1, 4: 2, 5: 4 },
    byTechnician: [{ technicianId: "t1", technicianName: "Rosa Vega", responses: 8, averageScore: 4.25 }],
    detractors: [{ surveyId: "s1", workOrderId: "w1", accountId, accountName: "Old Mill", serviceType: "General pest", technicianId: "t1", technicianName: "Rosa Vega", completedAt: null, score: 2, comment: "Late again.", submittedAt: "2026-04-01T00:00:00Z" }],
  },
  ceiling: { responses: 1000, reached: false },
};

const threads = {
  accountId: null,
  messages: [{ id: "m1", accountId, requestId: null, authorKind: "customer", portalUserId: "pu1", authorUserId: null, body: "The gate code changed.", sentAt: "2026-04-02T09:00:00Z", readAt: null }],
  summary: { messages: 1, unreadFromCustomers: 1, accountsAwaiting: [{ accountId, unread: 1, latestAt: "2026-04-02T09:00:00Z" }] },
  ceiling: { messages: 500, reached: false },
};

const requests = {
  requests: [{
    id: requestId, accountId, propertyId: null, portalUserId: null, kind: "question", status: "submitted", summary: "Ants in the dry store", detail: null,
    preferredDate: null, response: null, workOrderId: null, submittedAt: "2026-04-01T08:00:00Z", acknowledgedAt: null, firstResponseAt: null, resolvedAt: null,
    assigneeEmployeeId: null, assignedAt: null, updatedAt: "2026-04-01T08:00:00Z", open: true, answered: false,
  }],
  counts: { total: 1, open: 1, awaitingReply: 1, byStatus: { submitted: 1 } },
};
const queue = {
  queue: [{
    requestId, accountId, accountName: "Harborview Foods", kind: "question", status: "submitted", summary: "Ants in the dry store", submittedAt: "2026-04-01T08:00:00Z",
    waitingMinutes: 390, assigneeEmployeeId: null, assigneeName: null, assignedAt: null,
    suggestedEmployeeId: "e1", suggestedName: "Ana Cruz", suggestedReason: "branch manager of North; the address's postal code 93940 is in territory N1",
  }],
  employees: [{ id: "e1", name: "Ana Cruz", role: "branch_manager" }, { id: "e2", name: "Dev Ahmed", role: "dispatcher" }],
  myEmployeeId: "e1",
  counts: { open: 1, unassigned: 1, mine: 0 },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function serve() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "PUT") return Promise.resolve(json({ requestId, employeeId: JSON.parse(String(init.body)).employeeId }));
    if (url.startsWith("/api/services/portal/queue")) return Promise.resolve(json(queue));
    if (url.startsWith("/api/services/portal/sla")) return Promise.resolve(json(clock));
    if (url.startsWith("/api/services/portal/surveys")) return Promise.resolve(json(surveys));
    if (url.startsWith("/api/services/portal/messages?accountId=")) return Promise.resolve(json({ ...threads, accountId }));
    if (url.startsWith("/api/services/portal/messages")) return Promise.resolve(json(threads));
    if (url.startsWith("/api/services/portal/requests")) return Promise.resolve(json(requests));
    return Promise.resolve(json(portalUsers));
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("routing on the requests tab", () => {
  it("shows the suggestion with its reason, accepts it through the route, reassigns by select, and offers Mine only", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<ServicesPortalPanel />);

    const cell = await screen.findByTestId(`services-request-assignment-${requestId}`);
    await waitFor(() => expect(within(cell).getByTestId(`services-request-suggestion-${requestId}`)).toHaveTextContent("Suggested: Ana Cruz — branch manager of North; the address's postal code 93940 is in territory N1"));
    await user.click(within(cell).getByTestId(`services-request-accept-${requestId}`));
    await waitFor(() => expect(calls.some((call) => call.url === `/api/services/portal/requests/${requestId}/assignment` && call.init?.method === "PUT")).toBe(true));
    const accept = calls.find((call) => call.url === `/api/services/portal/requests/${requestId}/assignment` && call.init?.method === "PUT");
    expect(JSON.parse(String(accept?.init?.body))).toEqual({ employeeId: "e1" });

    await user.selectOptions(within(cell).getByLabelText("Assignee for Ants in the dry store"), "e2");
    await waitFor(() => expect(calls.filter((call) => call.init?.method === "PUT")).toHaveLength(2));
    expect(JSON.parse(String(calls.filter((call) => call.init?.method === "PUT")[1]?.init?.body))).toEqual({ employeeId: "e2" });

    expect(screen.getByLabelText("Only requests assigned to me")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Only requests assigned to me"));
    expect(screen.queryByTestId(`services-request-assignment-${requestId}`)).toBeNull();
  });
});
