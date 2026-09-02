import { describe, expect, it } from "vitest";

import {
  COPILOT_SKILLS,
  composeAutopayAnswer,
  composeFollowupsAnswer,
  composeHelpDeskAnswer,
  composeHygieneAnswer,
  composeLostMoneyAnswer,
  composeRatingsAnswer,
  composeScheduleAuditAnswer,
  composeOverdueAnswer,
  composeRevenueAnswer,
  composeRoutesAnswer,
  composeSignalsAnswer,
  composeUnknownAnswer,
  composeVisitsAnswer,
  matchQuestion,
} from "@/lib/services/copilot";

/**
 * The copilot's honesty is its matcher: a wrong answer delivered
 * confidently is worse than a refusal, so unknowns must actually refuse,
 * and every composed sentence must carry the real figures it was given.
 */

describe("the copilot matcher", () => {
  it("recognizes each skill from its own example question", () => {
    for (const skill of COPILOT_SKILLS) {
      expect(matchQuestion(skill.example), skill.id).toBe(skill.id);
    }
  });

  it("refuses what it cannot compute instead of guessing", () => {
    expect(matchQuestion("write a friendly reminder letter to Harborview")).toBeNull();
    expect(matchQuestion("what is the meaning of life")).toBeNull();
    const refusal = composeUnknownAnswer();
    expect(refusal).toContain("Not Connected");
    for (const skill of COPILOT_SKILLS) {
      expect(refusal).toContain(skill.example);
    }
  });

  it("prefers the more specific match when keywords overlap", () => {
    expect(matchQuestion("how much have we invoiced this month, billing total?")).toBe("monthly_revenue");
  });
});

describe("the composed answers carry real figures", () => {
  it("overdue: counts, sums and names the oldest date", () => {
    expect(
      composeOverdueAnswer({ count: 3, totalOutstandingCents: 123_450, oldestDueOn: "2026-08-01" }),
    ).toBe("3 invoices are past due, $1,234.50 outstanding in total. The oldest has been due since 2026-08-01.");
    expect(composeOverdueAnswer({ count: 0, totalOutstandingCents: 0, oldestDueOn: null })).toContain(
      "Nothing is overdue",
    );
  });

  it("routes: one line per technician with stop counts", () => {
    const answer = composeRoutesAnswer({
      day: "2026-08-31",
      routes: [
        { technician: "Ada Osei", stops: 7, status: "released" },
        { technician: "Ben Cho", stops: 1, status: "planned" },
      ],
    });
    expect(answer).toContain("Ada Osei has 7 stops (released)");
    expect(answer).toContain("Ben Cho has 1 stop (planned)");
    expect(composeRoutesAnswer({ day: "2026-08-31", routes: [] })).toContain("board is empty");
  });

  it("visits, autopay, and revenue speak in the figures given", () => {
    expect(composeVisitsAnswer({ count: 12, firstStart: "2026-09-01T09:00:00Z" })).toContain("12 visits");
    expect(composeAutopayAnswer({ enrolled: 40, accounts: 100 })).toBe(
      "40 of 100 accounts (40%) have an active autopay enrollment.",
    );
    expect(composeAutopayAnswer({ enrolled: 0, accounts: 0 })).toContain("not meaningful");
    expect(
      composeRevenueAnswer({ month: "August 2026", invoiced: 5, totalCents: 500_000, collectedCents: 200_000 }),
    ).toBe("5 invoices raised in August 2026 for $5,000.00; $2,000.00 of that is already collected.");
  });
});

describe("the follow-ups answer", () => {
  it("names what is owed and the top three suggestions with their reasons", () => {
    const answer = composeFollowupsAnswer({
      overdue: 2,
      dueToday: 1,
      suggestions: [
        { title: "Collect invoice INV-7", reason: "12 days overdue; no collection action recorded in the last 7 days." },
        { title: "Reach out to Harborview Foods", reason: "Lead with no recorded activity in 21 days." },
        { title: "Renew licence for Ada", reason: "Licence PCO-1 expires on 2026-09-20." },
        { title: "Chase estimate EST-3", reason: "Sent 11 days ago with no decision recorded." },
      ],
      suggestionCount: 4,
    });
    expect(answer).toContain("2 overdue and 1 due today");
    expect(answer).toContain("Collect invoice INV-7 (12 days overdue");
    expect(answer).toContain("Renew licence for Ada");
    expect(answer).not.toContain("Chase estimate EST-3");
    expect(answer).toContain("1 more on the Follow-ups page");
  });

  it("says plainly when nothing is owed and nothing is suggested", () => {
    expect(composeFollowupsAnswer({ overdue: 0, dueToday: 0, suggestions: [], suggestionCount: 0 }))
      .toBe("No open follow-ups are due today or overdue. Your records suggest nothing further right now.");
  });
});

describe("the signals answer", () => {
  it("names the top accounts with their scores and the facts behind them", () => {
    const answer = composeSignalsAnswer({
      model: "churn",
      scored: 12,
      top: [
        { name: "Harborview Foods", score: 75, facts: ["An active plan is 30 days past due", "$486.00 past due", "No activity in 90 days", "extra"] },
        { name: "Maple Street Homes", score: 10, facts: ["No activity in 90 days"] },
      ],
    });
    expect(answer).toContain("The customers most at risk");
    expect(answer).toContain("Harborview Foods at 75 (An active plan is 30 days past due; $486.00 past due; No activity in 90 days)");
    expect(answer).not.toContain("extra");
    expect(answer).toContain("Signals page");
  });

  it("says when nobody scores rather than inventing a leader", () => {
    expect(composeSignalsAnswer({ model: "lead", scored: 0, top: [] })).toBe("There is no lead or prospect to score yet.");
    expect(composeSignalsAnswer({ model: "upsell", scored: 4, top: [] })).toContain("none — no rule applies to any of the 4");
  });
});

describe("the lost-money answer", () => {
  it("states coverage before naming the worst visits, so an unknown never reads as a loss", () => {
    const answer = composeLostMoneyAnswer({
      days: 90, completed: 12, known: 9,
      losers: [
        { account: "Harborview Foods", service: "Monthly IPM", marginCents: -4300, revenueCents: 1000 },
        { account: "Ridgeway Bakery", service: "One-off", marginCents: -200, revenueCents: 5000 },
      ],
    });
    expect(answer).toContain("9 of 12 completed visits have every cost input on file; 3 cannot be costed yet");
    expect(answer).toContain("2 lost money in the last 90 days");
    expect(answer).toContain("Harborview Foods (Monthly IPM: -$43.00 on $10.00 revenue)");
  });

  it("says when nothing was completed, and when nothing lost money", () => {
    expect(composeLostMoneyAnswer({ days: 30, completed: 0, known: 0, losers: [] })).toContain("nothing to cost");
    expect(composeLostMoneyAnswer({ days: 30, completed: 4, known: 4, losers: [] }))
      .toBe("All 4 completed visits have every cost input on file. None of the costed visits lost money in the last 30 days.");
  });
});

describe("the schedule-audit answer", () => {
  it("says so when nothing contradicts, and otherwise counts by kind, flags the urgent ones, and names the first three", () => {
    expect(composeScheduleAuditAnswer({ days: 7, total: 0, bySeverity: { high: 0, medium: 0, low: 0 }, byFinding: [], worst: [] }))
      .toBe("Nothing contradicts in the next 7 days: no double bookings, no unrouted visits, no due plan without a visit, no arrival outside its window, and nothing left open past its window.");
    expect(composeScheduleAuditAnswer({
      days: 7,
      total: 3,
      bySeverity: { high: 2, medium: 1, low: 0 },
      byFinding: [{ label: "Double-booked technician", count: 2 }, { label: "Plan due with no visit", count: 1 }],
      worst: [
        { label: "Double-booked technician", account: "Harborview Foods", detail: "Overlaps Ridgeway Bakery, 10:30–11:30." },
        { label: "Double-booked technician", account: "Ridgeway Bakery", detail: "Overlaps Harborview Foods, 10:00–11:00." },
        { label: "Plan due with no visit", account: "Old Mill", detail: "Quarterly IPM due 2026-04-17 (quarterly); no visit within a week of it." },
      ],
    })).toBe(
      "3 contradictions in the next 7 days (2 double-booked technician, 1 plan due with no visit). 2 need attention today. "
      + "First: Harborview Foods — double-booked technician: Overlaps Ridgeway Bakery, 10:30–11:30.; "
      + "Ridgeway Bakery — double-booked technician: Overlaps Harborview Foods, 10:00–11:00.; "
      + "Old Mill — plan due with no visit: Quarterly IPM due 2026-04-17 (quarterly); no visit within a week of it.. "
      + "Every one is listed on the Schedule page with the rows involved.",
    );
  });
});

describe("the ratings answer", () => {
  it("says nobody was asked, or nobody answered, before it averages anything", () => {
    expect(composeRatingsAnswer({ days: 90, responses: 0, completedVisits: 0, averageScore: null, responseRateBps: null, detractors: [] }))
      .toBe("No visits were completed in the last 90 days, so nobody was asked.");
    expect(composeRatingsAnswer({ days: 90, responses: 0, completedVisits: 12, averageScore: null, responseRateBps: 0, detractors: [] }))
      .toMatch(/^12 visits were completed in the last 90 days and none has been rated yet/);
    expect(composeRatingsAnswer({
      days: 90, responses: 8, completedVisits: 20, averageScore: 4.25, responseRateBps: 4000,
      detractors: [{ account: "Old Mill", score: 2, comment: "Late again." }],
    })).toBe('8 ratings in the last 90 days (40% of 20 completed visits), averaging 4.25 out of 5. 1 rated a visit 1 or 2 — call back Old Mill (2/5: "Late again."). Every response is on the Customer Portal page under Ratings.');
  });
});

describe("the help-desk answer", () => {
  it("separates nothing open, everything inside its promise, and the late ones named first", () => {
    expect(composeHelpDeskAnswer({ open: 0, overdue: 0, late: [] })).toBe("Nothing is open on the help desk.");
    expect(composeHelpDeskAnswer({ open: 3, overdue: 0, late: [] })).toBe("3 requests are open and every one is inside its promise.");
    expect(composeHelpDeskAnswer({
      open: 3, overdue: 1,
      late: [{ account: "Harborview Foods", kind: "complaint", summary: "Ants again", waitingMinutes: 390, promise: "acknowledge" }],
    })).toBe('1 of 3 open requests is past a promise. First: Harborview Foods — complaint: "Ants again" (acknowledge overdue after 6.5 h). The full clock is on the Customer Portal page.');
  });
});

describe("the hygiene answer", () => {
  it("says the book is clean, or counts the reasons and names where to start without deleting anything", () => {
    expect(composeHygieneAnswer({ contacts: 0, byFlag: [], worst: [] }))
      .toBe("Every contact on the book can be reached, is unique, sits on a live account, and has been touched this year.");
    expect(composeHygieneAnswer({
      contacts: 2,
      byFlag: [{ label: "Same email on another contact", count: 2 }, { label: "Account is inactive", count: 1 }],
      worst: [{ contact: "Sam Ortiz", account: "Old Mill", labels: ["Same email on another contact", "Account is inactive"] }],
    })).toBe("2 contacts should not be trusted as they stand: 2 same email on another contact, 1 account is inactive. Start with Sam Ortiz at Old Mill (same email on another contact; account is inactive). Nothing is deleted for you — the list is on the Data page under Hygiene, and each row opens its account.");
  });
});
