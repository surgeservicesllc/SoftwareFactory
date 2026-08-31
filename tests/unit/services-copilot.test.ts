import { describe, expect, it } from "vitest";

import {
  COPILOT_SKILLS,
  composeAutopayAnswer,
  composeOverdueAnswer,
  composeRevenueAnswer,
  composeRoutesAnswer,
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
