import { describe, expect, it } from "vitest";

import {
  planCadence,
  planNextOccurrence,
  planOccurrences,
  planStepDate,
  type PlanStep,
} from "@/lib/services/plan-sequence";
import { advanceServiceDate } from "@/lib/services/crm";

const dayStep = (position: number, dayOfMonth: number, monthOffset = 0): PlanStep => ({
  position,
  monthOffset,
  anchor: "day_of_month",
  dayOfMonth,
  weekOfMonth: null,
  weekday: null,
  serviceType: null,
});

const weekdayStep = (
  position: number,
  weekOfMonth: number,
  weekday: number,
  monthOffset = 0,
  serviceType: string | null = null,
): PlanStep => ({
  position,
  monthOffset,
  anchor: "nth_weekday",
  dayOfMonth: null,
  weekOfMonth,
  weekday,
  serviceType,
});

describe("twice-monthly is not every fortnight", () => {
  it("keeps the 1st and the 15th on the 1st and the 15th, all year", () => {
    const dates = planOccurrences([dayStep(1, 1), dayStep(2, 15)], 1, "2026-01-01", 24);

    expect(dates).toHaveLength(24);
    expect(dates.every((visit) => /-(01|15)$/.test(visit.occursOn))).toBe(true);
    expect(dates[0]?.occursOn).toBe("2026-01-01");
    expect(dates.at(-1)?.occursOn).toBe("2026-12-15");
  });

  it("is the difference this increment exists for: a fortnight is neither 24 nor on the date", () => {
    // What a biweekly plan actually does over the same year.
    let cursor = "2026-01-01";
    const fortnights: string[] = [];
    while (cursor < "2027-01-01") {
      fortnights.push(cursor);
      cursor = advanceServiceDate(cursor, "biweekly");
    }

    // 27 dates land in 2026, not 24 — a fortnight is 26 visits per 364
    // days, so a year that starts on a visit ends on one too.
    expect(fortnights).toHaveLength(27);
    // And by July it is nowhere near the day the customer was promised.
    expect(fortnights.find((date) => date.startsWith("2026-07"))).toBe("2026-07-02");
  });
});

describe("weekday anchors", () => {
  it("finds the 2nd and 4th Tuesday", () => {
    const visits = planOccurrences([weekdayStep(1, 2, 2), weekdayStep(2, 4, 2)], 1, "2026-03-01", 2);

    expect(visits.map((visit) => visit.occursOn)).toEqual(["2026-03-10", "2026-03-24"]);
  });

  it("reads week 5 as the LAST one, so 'last Friday' lands in a month with four", () => {
    // May 2026 has five Fridays; June 2026 has four.
    expect(planStepDate(2026, 5, weekdayStep(1, 5, 5))).toBe("2026-05-29");
    expect(planStepDate(2026, 6, weekdayStep(1, 5, 5))).toBe("2026-06-26");
  });
});

describe("clamping, rather than refusing", () => {
  it("treats 'the 31st' as month end in a short month", () => {
    expect(planStepDate(2026, 1, dayStep(1, 31))).toBe("2026-01-31");
    expect(planStepDate(2026, 2, dayStep(1, 31))).toBe("2026-02-28");
    expect(planStepDate(2028, 2, dayStep(1, 31))).toBe("2028-02-29");
    expect(planStepDate(2026, 4, dayStep(1, 31))).toBe("2026-04-30");
  });
});

describe("a seasonal program is a sequence of different services", () => {
  const seasonal = [
    weekdayStep(1, 2, 1, 2, "perimeter"),
    weekdayStep(2, 2, 1, 5, "mosquito"),
    weekdayStep(3, 2, 1, 8, "rodent"),
    weekdayStep(4, 2, 1, 10, "winterization"),
  ];

  it("runs in March, June, September and November, and says what each visit is", () => {
    const visits = planOccurrences(seasonal, 12, "2026-01-01", 4, "quarterly service");

    expect(visits.map((visit) => visit.occursOn.slice(0, 7)))
      .toEqual(["2026-03", "2026-06", "2026-09", "2026-11"]);
    expect(visits.map((visit) => visit.serviceType))
      .toEqual(["perimeter", "mosquito", "rodent", "winterization"]);
  });

  it("stays in those months across a year boundary", () => {
    const visits = planOccurrences(seasonal, 12, "2026-10-01", 3);

    expect(visits.map((visit) => visit.occursOn.slice(0, 7)))
      .toEqual(["2026-11", "2027-03", "2027-06"]);
  });

  it("falls back to the plan's own service where a step names none", () => {
    const visits = planOccurrences([dayStep(1, 5, 0)], 12, "2026-01-01", 1, "general pest");

    expect(visits[0]?.serviceType).toBe("general pest");
  });
});

describe("the next visit", () => {
  it("is strictly after the one just generated, never the same day again", () => {
    const steps = [dayStep(1, 1), dayStep(2, 15)];

    expect(planNextOccurrence(steps, 1, "2026-01-01")).toBe("2026-01-15");
    expect(planNextOccurrence(steps, 1, "2026-01-15")).toBe("2026-02-01");
  });

  it("is null for a plan nobody sequenced, which is the caller's signal to use the recurrence", () => {
    expect(planNextOccurrence([], null, "2026-01-01")).toBeNull();
    expect(planNextOccurrence([dayStep(1, 1)], null, "2026-01-01")).toBeNull();
    expect(planOccurrences([], 1, "2026-01-01", 5)).toEqual([]);
  });
});

describe("visits and bills are allowed to disagree", () => {
  it("reports level billing as the arrangement it is, not an error", () => {
    const quarterlyVisits = [
      dayStep(1, 10, 0), dayStep(2, 10, 1), dayStep(3, 10, 2), dayStep(4, 10, 3),
    ];

    expect(planCadence(quarterlyVisits, 12, "monthly")).toEqual({
      sequenced: true,
      visitsPerYear: 4,
      billsPerYear: 12,
    });
  });

  it("counts twice-monthly as 24 visits against 12 bills", () => {
    expect(planCadence([dayStep(1, 1), dayStep(2, 15)], 1, "monthly")).toEqual({
      sequenced: true,
      visitsPerYear: 24,
      billsPerYear: 12,
    });
  });

  it("says nothing about visits for an unsequenced plan rather than guessing", () => {
    expect(planCadence([], null, "quarterly")).toEqual({
      sequenced: false,
      visitsPerYear: null,
      billsPerYear: 4,
    });
  });
});
