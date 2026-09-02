import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesPortalPanel } from "@/components/services/portal-panel";

/**
 * The staff side of the customer's side: the clock tab reads each request's
 * two promises and lets a policy be saved per kind; the ratings tab states
 * the average, rate and distribution and names the detractors; the
 * messages tab opens a thread and sends as staff.
 */

const accountId = "20000000-0000-4000-8000-0000000c0001";

const portalUsers = {
  portalUsers: [{
    id: "pu1", accountId, accountName: "Harborview Foods", contactId: null, linked: true, email: "dana@harborview.example",
    role: "viewer", invitedAt: "2026-03-01T00:00:00Z", activatedAt: "2026-03-02T00:00:00Z", lastSeenAt: null, active: true, state: "active",
    createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z",
  }],
  counts: { total: 1, active: 1, invited: 0, suspended: 0 },
};

const requests = { requests: [], counts: { total: 0, open: 0, awaitingReply: 0, byStatus: {} } };

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function serve() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "PUT") return Promise.resolve(json({ policies: clock.policies }));
    if (init?.method === "POST") return Promise.resolve(json({ message: {} }, 201));
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

describe("the staff side of the customer's side", () => {
  it("reads the clock on each request and saves a policy per kind", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<ServicesPortalPanel />);
    await user.click(await screen.findByRole("tab", { name: /Request clock/ }));
    const table = await screen.findByTestId("services-portal-clock-table");
    expect(within(table).getByText("Ants along the back wall again")).toBeInTheDocument();
    expect(within(table).getByText("Overdue")).toBeInTheDocument();
    expect(within(table).getByText("Within time")).toBeInTheDocument();
    expect(within(table).getByText("6.5 h")).toBeInTheDocument();
    expect(screen.getByTestId("services-portal-clock-summary")).toHaveTextContent("1 open, 1 past a promise right now");

    const acknowledge = screen.getByLabelText("Hours to acknowledge a complaint request");
    await user.clear(acknowledge);
    await user.type(acknowledge, "2");
    await user.click(screen.getByRole("button", { name: "Save the complaint policy" }));
    await waitFor(() => {
      const put = calls.find((call) => call.init?.method === "PUT");
      expect(put).toBeDefined();
      expect(JSON.parse(String(put!.init!.body))).toEqual({ kind: "complaint", acknowledgeHours: 2, resolveHours: 48 });
    });
  });

  it("states the average, the rate against completed visits, the distribution, and who to call back", async () => {
    serve();
    const user = userEvent.setup();
    render(<ServicesPortalPanel />);
    await user.click(await screen.findByRole("tab", { name: /Ratings/ }));
    const figures = await screen.findByTestId("services-portal-ratings-figures");
    expect(within(figures).getByText("4.25 / 5")).toBeInTheDocument();
    expect(within(figures).getByText("40.0%")).toBeInTheDocument();
    expect(screen.getByTestId("services-portal-ratings-distribution")).toHaveTextContent("5★ 4 · 4★ 2 · 3★ 1 · 2★ 1 · 1★ 0");
    const detractors = screen.getByTestId("services-portal-ratings-detractors");
    expect(within(detractors).getByText("Old Mill")).toBeInTheDocument();
    expect(within(detractors).getByText("“Late again.”")).toBeInTheDocument();
  });

  it("opens the thread of an account waiting on a reply and sends as staff", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<ServicesPortalPanel />);
    await user.click(await screen.findByRole("tab", { name: /Messages/ }));
    const awaiting = await screen.findByTestId("services-portal-messages-awaiting");
    await user.click(within(awaiting).getByRole("button", { name: "Harborview Foods" }));
    const thread = await screen.findByTestId("services-portal-thread");
    expect(within(thread).getByText("The gate code changed.")).toBeInTheDocument();
    expect(calls.some((call) => call.url === `/api/services/portal/messages?accountId=${accountId}`)).toBe(true);
    await user.type(screen.getByLabelText("Write to the customer"), "Noted, thank you.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      const post = calls.find((call) => call.init?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post!.init!.body))).toEqual({ accountId, body: "Noted, thank you." });
    });
  });
});
