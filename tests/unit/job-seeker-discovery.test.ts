import { describe, expect, it } from "vitest";

import {
  activeThreshold,
  applyFilters,
  creditMeter,
  discoveryHeadlines,
  EMPTY_FILTERS,
  filtersActive,
  pageWindow,
  paginate,
  sortJobs,
  topMatchingSkills,
  type DiscoveryJob,
} from "@/lib/job-seeker/discovery";

/**
 * The discovery figures, tested where a wrong answer looks right.
 *
 * Every case here would render as a perfectly believable dashboard: a headline
 * that disagrees with the list under it, an unscored job ranked as the worst
 * match, a credit bar past full, a "80%+" label on a workspace that moved its
 * bar. None of them would be noticed by eye.
 */

const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const recent = "2026-08-26T12:00:00.000Z";   // 2 days ago — inside the window
const old = "2026-07-01T12:00:00.000Z";      // outside it

function job(over: Partial<DiscoveryJob> = {}): DiscoveryJob {
  return {
    id: over.id ?? "job-1",
    title: "VP of Marketing",
    company: "Adobe",
    location: "Remote (US)",
    salaryText: "$220K – $280K",
    workModel: "remote",
    source: "greenhouse",
    url: null,
    description: null,
    discoveredAt: recent,
    savedAt: null,
    match: {
      score: 94, breakdown: { leadership: 30, ai: 20 }, reasons: [], gaps: [],
      threshold: 80, qualified: true,
    },
    application: null,
    ...over,
  };
}

describe("discoveryHeadlines", () => {
  it("counts high matches against each job's own threshold, not a constant 80", () => {
    // The workspace moved its bar to 90. A page hard-coding 80 calls the
    // 85-point job a high match; the seeker's own preference says it is not.
    const jobs = [
      job({ id: "a", match: { score: 94, breakdown: {}, reasons: [], gaps: [], threshold: 90, qualified: true } }),
      job({ id: "b", match: { score: 85, breakdown: {}, reasons: [], gaps: [], threshold: 90, qualified: false } }),
    ];
    const high = discoveryHeadlines(jobs, { appliedThisWeek: 0, activeAlerts: 0 }, NOW)
      .find((entry) => entry.label === "High Match");
    expect(high?.value).toBe(1);
  });

  it("counts only jobs discovered inside the window as new", () => {
    const jobs = [job({ id: "a", discoveredAt: recent }), job({ id: "b", discoveredAt: old })];
    const opportunities = discoveryHeadlines(jobs, { appliedThisWeek: 0, activeAlerts: 0 }, NOW)
      .find((entry) => entry.label === "New Opportunities");
    expect(opportunities?.value).toBe(2);
    expect(opportunities?.delta).toBe(1);
  });

  it("never counts a future timestamp as new", () => {
    const jobs = [job({ discoveredAt: "2027-01-01T00:00:00.000Z" })];
    const opportunities = discoveryHeadlines(jobs, { appliedThisWeek: 0, activeAlerts: 0 }, NOW)
      .find((entry) => entry.label === "New Opportunities");
    expect(opportunities?.delta).toBe(0);
  });

  it("counts saved jobs by their timestamp, and an unscored job is never high", () => {
    const jobs = [
      job({ id: "a", savedAt: recent, match: null }),
      job({ id: "b", savedAt: null }),
    ];
    const headlines = discoveryHeadlines(jobs, { appliedThisWeek: 0, activeAlerts: 0 }, NOW);
    expect(headlines.find((e) => e.label === "Saved Jobs")?.value).toBe(1);
    expect(headlines.find((e) => e.label === "High Match")?.value).toBe(1);
  });
});

describe("activeThreshold", () => {
  it("names the bar when every job agrees on it", () => {
    expect(activeThreshold([job(), job({ id: "b" })])).toBe(80);
  });

  it("refuses to name one when the jobs disagree", () => {
    // A threshold changed between recordings. Picking either would put a
    // number on the card that half the list was not measured against.
    const other = job({
      id: "b",
      match: { score: 70, breakdown: {}, reasons: [], gaps: [], threshold: 60, qualified: true },
    });
    expect(activeThreshold([job(), other])).toBeNull();
  });

  it("is null when nothing is scored", () => {
    expect(activeThreshold([job({ match: null })])).toBeNull();
  });
});

describe("creditMeter", () => {
  it("reports usage against the stored allowance", () => {
    expect(creditMeter(1250, 2000)).toEqual({ used: 1250, allowance: 2000, percent: 63, remaining: 750 });
  });

  it("clamps a bar that would render past full, and keeps remaining at zero", () => {
    // The allowance was lowered below what was already spent. A 150% bar is a
    // broken component; zero remaining is the fact.
    expect(creditMeter(3000, 2000)).toMatchObject({ percent: 100, remaining: 0 });
  });

  it("is null with no allowance, so the page omits the meter rather than drawing an empty bar", () => {
    expect(creditMeter(10, 0)).toBeNull();
    expect(creditMeter(10, null)).toBeNull();
    expect(creditMeter(10, undefined)).toBeNull();
  });
});

describe("applyFilters", () => {
  it("matches text across title, company and location", () => {
    const jobs = [job({ id: "a" }), job({ id: "b", company: "HubSpot", title: "Head of Growth" })];
    expect(applyFilters(jobs, { ...EMPTY_FILTERS, text: "hubspot" }).map((j) => j.id)).toEqual(["b"]);
    expect(applyFilters(jobs, { ...EMPTY_FILTERS, text: "remote" })).toHaveLength(2);
  });

  it("excludes an unscored job from a minimum-score filter rather than scoring it zero", () => {
    // Treating null as 0 would rank an unmeasured job as a bad match. Asserted
    // at a bar of 0 as well as 50, because at 50 both the honest check and the
    // `?? 0` shortcut exclude it and the case proves nothing — only a bar of 0
    // separates "has no score" from "scored zero".
    const jobs = [job({ id: "a" }), job({ id: "b", match: null })];
    expect(applyFilters(jobs, { ...EMPTY_FILTERS, minimumScore: 50 }).map((j) => j.id)).toEqual(["a"]);
    expect(applyFilters(jobs, { ...EMPTY_FILTERS, minimumScore: 0 }).map((j) => j.id)).toEqual(["a"]);
  });

  it("filters to saved only by the timestamp", () => {
    const jobs = [job({ id: "a", savedAt: recent }), job({ id: "b" })];
    expect(applyFilters(jobs, { ...EMPTY_FILTERS, savedOnly: true }).map((j) => j.id)).toEqual(["a"]);
  });

  it("reports whether any filter is active, ignoring whitespace-only text", () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(filtersActive({ ...EMPTY_FILTERS, text: "   " })).toBe(false);
    expect(filtersActive({ ...EMPTY_FILTERS, savedOnly: true })).toBe(true);
  });
});

describe("sortJobs", () => {
  it("puts an unscored job last under a score sort, not above the weakest", () => {
    const jobs = [
      job({ id: "unscored", match: null }),
      job({ id: "weak", match: { score: 30, breakdown: {}, reasons: [], gaps: [], threshold: 80, qualified: false } }),
      job({ id: "strong" }),
    ];
    expect(sortJobs(jobs, "score").map((j) => j.id)).toEqual(["strong", "weak", "unscored"]);
  });

  it("sorts by recency and by company on request", () => {
    const jobs = [job({ id: "a", discoveredAt: old, company: "Zoom" }), job({ id: "b", discoveredAt: recent, company: "Adobe" })];
    expect(sortJobs(jobs, "recent").map((j) => j.id)).toEqual(["b", "a"]);
    expect(sortJobs(jobs, "company").map((j) => j.id)).toEqual(["b", "a"]);
  });
});

describe("paginate", () => {
  it("reads as the sentence a person sees", () => {
    const items = Array.from({ length: 247 }, (_, index) => index);
    expect(paginate(items, 1)).toMatchObject({ from: 1, to: 10, total: 247, pageCount: 25 });
    expect(paginate(items, 25)).toMatchObject({ from: 241, to: 247 });
  });

  it("reports 0 to 0 for an empty list rather than 1 to 0", () => {
    expect(paginate([], 1)).toMatchObject({ from: 0, to: 0, total: 0, pageCount: 1 });
  });

  it("clamps a page beyond the end instead of rendering nothing", () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    expect(paginate(items, 99).page).toBe(2);
    expect(paginate(items, 0).page).toBe(1);
  });
});

describe("pageWindow", () => {
  it("shows the design's 1 2 3 4 5 … 25", () => {
    expect(pageWindow(1, 25)).toEqual([1, 2, 3, 4, 5, "gap", 25]);
  });

  it("keeps the last page reachable and never duplicates it", () => {
    const window = pageWindow(24, 25);
    expect(window.filter((entry) => entry === 25)).toHaveLength(1);
    expect(window.at(-1)).toBe(25);
  });

  it("drops the gap when every page fits", () => {
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
  });
});

describe("topMatchingSkills", () => {
  it("ranks by the scorer's own contribution", () => {
    expect(topMatchingSkills({ leadership: 30, ai: 20, saas: 25 }, 2)).toEqual(["leadership", "saas"]);
  });

  it("drops criteria that contributed nothing", () => {
    // A zero contribution is not a matching skill.
    expect(topMatchingSkills({ leadership: 30, adobe: 0, creative: -5 })).toEqual(["leadership"]);
  });

  it("is empty rather than throwing when there is no breakdown", () => {
    expect(topMatchingSkills(undefined)).toEqual([]);
  });
});
