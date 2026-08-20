import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUALIFICATION_THRESHOLD,
  JOB_SEEKER_WEIGHTS,
  scoreJob,
} from "@/lib/job-seeker/scoring";

describe("the job match score", () => {
  it("publishes the exact weights from the design and sums to 100", () => {
    expect(JOB_SEEKER_WEIGHTS).toEqual({
      experience: 30,
      skills: 20,
      leadership: 15,
      industry: 10,
      compensation: 10,
      location: 10,
      career_growth: 5,
    });
    expect(Object.values(JOB_SEEKER_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(DEFAULT_QUALIFICATION_THRESHOLD).toBe(80);
  });

  it("is the sum of its parts, qualified at the threshold boundary", () => {
    const result = scoreJob({
      breakdown: { experience: 28, skills: 18, leadership: 12, industry: 8, compensation: 9, location: 10, career_growth: 4 },
      reasons: ["Strong platform history"],
      gaps: ["No people-management evidence"],
    });
    expect(result.score).toBe(89);
    expect(result.qualified).toBe(true);

    const atBoundary = scoreJob({
      breakdown: { experience: 30, skills: 20, leadership: 15, industry: 10, compensation: 5, location: 0, career_growth: 0 },
    });
    expect(atBoundary.score).toBe(80);
    expect(atBoundary.qualified).toBe(true);

    const justUnder = scoreJob({
      breakdown: { experience: 30, skills: 20, leadership: 15, industry: 9, compensation: 5, location: 0, career_growth: 0 },
    });
    expect(justUnder.score).toBe(79);
    expect(justUnder.qualified).toBe(false);
  });

  it("clamps components into their published weights instead of trusting inputs", () => {
    const result = scoreJob({
      breakdown: { experience: 90, skills: -4, leadership: 15.4, industry: Number.NaN, compensation: 10, location: 10, career_growth: 5 },
    });
    expect(result.breakdown.experience).toBe(30);
    expect(result.breakdown.skills).toBe(0);
    expect(result.breakdown.leadership).toBe(15);
    expect(result.breakdown.industry).toBe(0);
    expect(result.score).toBe(70);
  });

  it("respects a person's configured threshold", () => {
    const strict = scoreJob({
      breakdown: { experience: 30, skills: 20, leadership: 15, industry: 10, compensation: 10, location: 0, career_growth: 0 },
      threshold: 90,
    });
    expect(strict.score).toBe(85);
    expect(strict.qualified).toBe(false);

    const lenient = scoreJob({ breakdown: { experience: 20 }, threshold: 15 });
    expect(lenient.qualified).toBe(true);
  });

  it("keeps a missing component at zero, never invented", () => {
    const result = scoreJob({ breakdown: {} });
    expect(result.score).toBe(0);
    expect(result.qualified).toBe(false);
    expect(Object.keys(result.breakdown).sort()).toEqual(Object.keys(JOB_SEEKER_WEIGHTS).sort());
  });
});
