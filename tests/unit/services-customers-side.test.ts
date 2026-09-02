import { describe, expect, it } from "vitest";

import {
  summarizeSla,
  summarizeSurveys,
  summarizeThreads,
  toPortalMessageView,
  toRequestSlaView,
  toSurveyResponseView,
} from "@/lib/services/customers-side";

/**
 * The pure side of the customer's side: the clock's states are counted and
 * the late queue is only what is open AND past a promise; a survey summary
 * has no average until somebody answers and no rate until a visit was
 * completed; the message queue is unread customer messages by account.
 */

function slaRow(overrides: Partial<Parameters<typeof toRequestSlaView>[0]>) {
  return toRequestSlaView({
    request_id: "r", account_id: "a", account_name: "Acme", kind: "service", status: "submitted", summary: "x",
    submitted_at: "2026-04-01T00:00:00Z", acknowledged_at: null, first_response_at: null, resolved_at: null,
    acknowledge_hours: 24, resolve_hours: 120, acknowledge_due_at: "2026-04-02T00:00:00Z", resolve_due_at: "2026-04-06T00:00:00Z",
    acknowledge_state: "waiting", resolve_state: "waiting", waiting_minutes: 60,
    ...overrides,
  });
}

describe("summarizeSla", () => {
  it("counts each promise's states and calls late only what is open and past a promise", () => {
    const rows = [
      slaRow({ request_id: "1", acknowledge_state: "overdue" }),
      slaRow({ request_id: "2", acknowledge_state: "met", resolve_state: "overdue" }),
      slaRow({ request_id: "3", acknowledge_state: "breached", resolve_state: "met", resolved_at: "2026-04-03T00:00:00Z", waiting_minutes: null }),
      slaRow({ request_id: "4", acknowledge_state: "unrecorded" }),
      slaRow({ request_id: "5", acknowledge_state: "nonsense" }),
    ];
    const summary = summarizeSla(rows);
    expect(summary).toEqual({
      requests: 5,
      open: 4,
      overdue: 2,
      acknowledge: { overdue: 1, breached: 1, waiting: 0, met: 1, unrecorded: 2 },
      resolve: { overdue: 1, breached: 0, waiting: 3, met: 1, unrecorded: 0 },
    });
    expect(rows[2].open).toBe(false);
    expect(rows[4].acknowledgeState).toBe("unrecorded");
  });
});

describe("summarizeSurveys", () => {
  it("has no average until somebody answers and no rate until a visit was completed", () => {
    expect(summarizeSurveys([], 0)).toMatchObject({ averageScore: null, responseRateBps: null, responses: 0 });
    expect(summarizeSurveys([], 12)).toMatchObject({ averageScore: null, responseRateBps: 0 });
  });

  it("averages, distributes, groups by technician lowest first, and lists the 1s and 2s", () => {
    const responses = [
      { survey_id: "s1", work_order_id: "w1", account_id: "a1", account_name: "Old Mill", service_type: "General", technician_id: "t1", technician_name: "Rosa Vega", completed_at: null, score: 2, comment: "Late again.", submitted_at: "2026-04-03T00:00:00Z" },
      { survey_id: "s2", work_order_id: "w2", account_id: "a2", account_name: "Harborview", service_type: "General", technician_id: "t1", technician_name: "Rosa Vega", completed_at: null, score: 5, comment: null, submitted_at: "2026-04-02T00:00:00Z" },
      { survey_id: "s3", work_order_id: "w3", account_id: "a3", account_name: "Ridgeway", service_type: "Rodent", technician_id: null, technician_name: null, completed_at: null, score: 4, comment: null, submitted_at: "2026-04-01T00:00:00Z" },
      { survey_id: "s4", work_order_id: "w4", account_id: "a4", account_name: "Northgate", service_type: "Ants", technician_id: "t2", technician_name: "Tom Hale", completed_at: null, score: 1, comment: null, submitted_at: "2026-04-04T00:00:00Z" },
    ].map(toSurveyResponseView);
    const summary = summarizeSurveys(responses, 10);
    expect(summary.responses).toBe(4);
    expect(summary.averageScore).toBe(3);
    expect(summary.responseRateBps).toBe(4000);
    expect(summary.distribution).toEqual({ 1: 1, 2: 1, 3: 0, 4: 1, 5: 1 });
    expect(summary.byTechnician.map((entry) => [entry.technicianName, entry.responses, entry.averageScore])).toEqual([
      ["Tom Hale", 1, 1],
      ["Rosa Vega", 2, 3.5],
      ["No technician", 1, 4],
    ]);
    expect(summary.detractors.map((entry) => entry.accountName)).toEqual(["Northgate", "Old Mill"]);
    expect(summarizeSurveys(responses, 2).responseRateBps).toBe(10_000);
  });
});

describe("summarizeThreads", () => {
  it("queues unread customer messages by account, newest first, and ignores staff and read ones", () => {
    const messages = [
      { id: "m1", account_id: "a1", request_id: null, author_kind: "customer" as const, portal_user_id: "p", author_user_id: null, body: "one", sent_at: "2026-04-01T00:00:00Z", read_at: null },
      { id: "m2", account_id: "a1", request_id: null, author_kind: "customer" as const, portal_user_id: "p", author_user_id: null, body: "two", sent_at: "2026-04-03T00:00:00Z", read_at: null },
      { id: "m3", account_id: "a2", request_id: null, author_kind: "customer" as const, portal_user_id: "p", author_user_id: null, body: "three", sent_at: "2026-04-02T00:00:00Z", read_at: null },
      { id: "m4", account_id: "a3", request_id: null, author_kind: "customer" as const, portal_user_id: "p", author_user_id: null, body: "seen", sent_at: "2026-04-05T00:00:00Z", read_at: "2026-04-05T01:00:00Z" },
      { id: "m5", account_id: "a3", request_id: null, author_kind: "staff" as const, portal_user_id: null, author_user_id: "u", body: "ours", sent_at: "2026-04-06T00:00:00Z", read_at: null },
    ].map(toPortalMessageView);
    expect(summarizeThreads(messages)).toEqual({
      messages: 5,
      unreadFromCustomers: 3,
      accountsAwaiting: [
        { accountId: "a1", unread: 2, latestAt: "2026-04-03T00:00:00Z" },
        { accountId: "a2", unread: 1, latestAt: "2026-04-02T00:00:00Z" },
      ],
    });
  });
});
