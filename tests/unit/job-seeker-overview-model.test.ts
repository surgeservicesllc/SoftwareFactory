import { describe, expect, it } from "vitest";

import { buildOverview, stageLabel, type JobSeekerJobView } from "@/lib/job-seeker/overview";

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
