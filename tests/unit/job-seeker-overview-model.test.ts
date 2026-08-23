import { describe, expect, it } from "vitest";

import {
  buildOverview,
  buildTimeline,
  stageLabel,
  type JobSeekerJobView,
} from "@/lib/job-seeker/overview";

/**
 * The Overview's arithmetic.
 *
 * These are the figures a person reads first and trusts most, so the cases
 * that matter are the ones where a wrong answer would look plausible: an
 * unscored job counted as a low score, an application counted as submitted
 * before it was, a percentage over a total that includes rows it should not.
 */

function job(overrides: Partial<JobSeekerJobView> = {}): JobSeekerJobView {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    title: "VP of Marketing",
    company: "Acme",
    ...overrides,
  };
}

describe("buildOverview", () => {
  it("reports an empty search as empty rather than as zeroes with a shape", () => {
    const model = buildOverview([]);
    expect(model.jobsFound).toBe(0);
    expect(model.averageMatchScore).toBeNull();
    expect(model.byStage).toEqual([]);
    expect(model.recent).toEqual([]);
  });

  it("does not count an unscored job as a low-scoring one", () => {
    const model = buildOverview([
      job({ match: { score: 95, qualified: true } }),
      job({ match: null }),
      job({}),
    ]);
    expect(model.jobsFound).toBe(3);
    expect(model.scored).toBe(1);
    // The average is over scored jobs only; dividing by 3 would report 32.
    expect(model.averageMatchScore).toBe(95);
    expect(model.scoreBands.reduce((sum, band) => sum + band.count, 0)).toBe(1);
  });

  it("counts as submitted only the stages that follow a real submission", () => {
    const model = buildOverview([
      job({ application: { id: "a1", stage: "FOUND" } }),
      job({ application: { id: "a2", stage: "RESUME_CREATED" } }),
      job({ application: { id: "a3", stage: "READY_FOR_REVIEW" } }),
      job({ application: { id: "a4", stage: "APPLIED" } }),
      job({ application: { id: "a5", stage: "INTERVIEW" } }),
      job({ application: { id: "a6", stage: "OFFER" } }),
    ]);
    // Six applications exist; three of them have actually been sent.
    expect(model.applicationsTotal).toBe(6);
    expect(model.applied).toBe(3);
    expect(model.interviews).toBe(1);
    expect(model.offers).toBe(1);
  });

  it("counts a final interview as an interview", () => {
    const model = buildOverview([
      job({ application: { id: "a1", stage: "INTERVIEW" } }),
      job({ application: { id: "a2", stage: "FINAL_INTERVIEW" } }),
    ]);
    expect(model.interviews).toBe(2);
  });

  it("takes stage percentages over applications, not over every recorded job", () => {
    const model = buildOverview([
      job({ application: { id: "a1", stage: "APPLIED" } }),
      job({ application: { id: "a2", stage: "APPLIED" } }),
      job({}),
      job({}),
    ]);
    const applied = model.byStage.find((entry) => entry.stage === "APPLIED");
    // Two of two applications, not two of four jobs.
    expect(applied).toMatchObject({ count: 2, percent: 100 });
  });

  it("omits stages nothing is in, so the chart is not mostly zeroes", () => {
    const model = buildOverview([job({ application: { id: "a1", stage: "OFFER" } })]);
    expect(model.byStage.map((entry) => entry.stage)).toEqual(["OFFER"]);
  });

  it("ranks roles by their best score and reports how many were applied to", () => {
    const model = buildOverview([
      job({ title: "Head of Growth", match: { score: 70, qualified: true } }),
      job({ title: "VP of Marketing", match: { score: 91, qualified: true },
            application: { id: "a1", stage: "APPLIED" } }),
      job({ title: "VP of Marketing", match: { score: 84, qualified: true } }),
    ]);
    expect(model.topTitles[0]).toMatchObject({
      title: "VP of Marketing", jobs: 2, applied: 1, bestScore: 91,
    });
    expect(model.topTitles[1]).toMatchObject({ title: "Head of Growth", applied: 0 });
  });

  it("names every stage the database can hold", () => {
    expect(stageLabel("FINAL_INTERVIEW")).toBe("Final interview");
    expect(stageLabel("RECRUITER_RESPONSE")).toBe("Recruiter response");
    // An unrecognized stage reports itself rather than being hidden or renamed.
    expect(stageLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});
describe("the status ring", () => {
  it("builds arcs from the counts, so the ring closes", () => {
    // One application in each of three stages: each rounds to 33%, and three
    // 33s make 99. A ring drawn from the rounded shares ends 1% short — a
    // visible wedge of nothing — so the arcs come from the raw fractions.
    const model = buildOverview([
      job({ application: { id: "a1", stage: "APPLIED" } }),
      job({ application: { id: "a2", stage: "INTERVIEW" } }),
      job({ application: { id: "a3", stage: "OFFER" } }),
    ]);

    expect(model.statusRing.map((slice) => slice.percent)).toEqual([33, 33, 33]);
    const total = model.statusRing.reduce((sum, slice) => sum + slice.fraction, 0);
    expect(total).toBeCloseTo(1, 10);
    // And the last arc ends exactly where the circle does.
    const last = model.statusRing[model.statusRing.length - 1]!;
    expect(last.offset + last.fraction).toBeCloseTo(1, 10);
  });

  it("lays each arc where the one before it ended", () => {
    const model = buildOverview([
      job({ application: { id: "a1", stage: "APPLIED" } }),
      job({ application: { id: "a2", stage: "OFFER" } }),
    ]);
    expect(model.statusRing[0]?.offset).toBe(0);
    expect(model.statusRing[1]?.offset).toBeCloseTo(model.statusRing[0]!.fraction, 10);
  });

  it("carries the same counts the stage list reports", () => {
    const model = buildOverview([
      job({ application: { id: "a1", stage: "APPLIED" } }),
      job({ application: { id: "a2", stage: "APPLIED" } }),
    ]);
    expect(model.statusRing.map((slice) => [slice.stage, slice.count]))
      .toEqual(model.byStage.map((entry) => [entry.stage, entry.count]));
  });
});

describe("applications over time", () => {
  const today = new Date("2026-05-19T12:00:00.000Z");

  function applied(id: string, appliedAt: string | null): JobSeekerJobView {
    return job({ id, application: { id: `app-${id}`, stage: "APPLIED", appliedAt } });
  }

  it("gives every day in the window a point, including the empty ones", () => {
    const points = buildTimeline([applied("1", "2026-05-19T09:00:00.000Z")], 7, today);
    expect(points).toHaveLength(7);
    expect(points[0]?.date).toBe("2026-05-13");
    expect(points[6]?.date).toBe("2026-05-19");
    // A quiet stretch must read as flat, not be compressed away.
    expect(points.slice(0, 6).every((point) => point.count === 0)).toBe(true);
  });

  it("accumulates, because the question is how far the search has got", () => {
    const points = buildTimeline([
      applied("1", "2026-05-17T09:00:00.000Z"),
      applied("2", "2026-05-18T09:00:00.000Z"),
      applied("3", "2026-05-18T17:00:00.000Z"),
    ], 7, today);
    expect(points.map((point) => point.cumulative)).toEqual([0, 0, 0, 0, 1, 3, 3]);
  });

  it("carries submissions older than the window into the running total", () => {
    // Dropping them would restart the line at zero and understate the search.
    const points = buildTimeline([
      applied("old", "2026-01-01T09:00:00.000Z"),
      applied("new", "2026-05-19T09:00:00.000Z"),
    ], 7, today);
    expect(points[0]?.cumulative).toBe(1);
    expect(points[6]?.cumulative).toBe(2);
  });

  it("ignores an application that was never submitted", () => {
    const points = buildTimeline([
      job({ application: { id: "a1", stage: "READY_FOR_REVIEW", appliedAt: null } }),
      job({ application: { id: "a2", stage: "FOUND" } }),
    ], 7, today);
    expect(points.every((point) => point.cumulative === 0)).toBe(true);
  });

  it("reports the peak the axis has to reach", () => {
    const model = buildOverview([
      applied("1", "2026-05-18T09:00:00.000Z"),
      applied("2", "2026-05-19T09:00:00.000Z"),
    ], { windowDays: 7, today });
    expect(model.timelinePeak).toBe(2);
    expect(model.timeline).toHaveLength(7);
  });

  it("honours the requested window", () => {
    expect(buildOverview([], { windowDays: 90, today }).timeline).toHaveLength(90);
  });
});
