import { describe, expect, it } from "vitest";

import {
  evaluateJob,
  hasLeadershipEvidence,
  readSalaryFigure,
  type JobFacts,
  type PreferenceFacts,
  type ProfileFacts,
} from "@/lib/job-seeker/evaluate";

/**
 * The evaluator's contract: every judgment derives from a recorded fact,
 * every reason and gap names its fact, and a missing fact contributes
 * nothing — never an invented qualification.
 */

const profile: ProfileFacts = {
  skills: ["TypeScript", "PostgreSQL"],
  technologies: ["Next.js"],
  industries: ["Software"],
  employmentTitles: ["Staff Engineer"],
  hasLeadershipEvidence: true,
  salaryTarget: 200000,
  location: "Austin, TX",
  workArrangement: "remote",
  openToRelocation: false,
};

const preferences: PreferenceFacts = {
  targetTitles: ["Staff Engineer"],
  compensationMinimum: 220000,
  locations: ["Austin"],
  workArrangements: ["remote"],
  industries: ["Software"],
  exclusions: ["gambling"],
  qualificationThreshold: 80,
};

const job: JobFacts = {
  title: "Staff Engineer",
  company: "Acme Software",
  description:
    "Remote software role using TypeScript, PostgreSQL and Next.js to build platform tooling.",
  salaryText: "$230k – $260k",
  workModel: "remote",
  location: "Remote — US",
};

describe("evaluateJob", () => {
  it("scores a strong recorded match as qualified, with named reasons", () => {
    const result = evaluateJob(profile, preferences, job);

    expect(result.excluded).toBeNull();
    expect(result.breakdown.experience).toBe(30);
    expect(result.breakdown.skills).toBeGreaterThan(0);
    expect(result.breakdown.leadership).toBe(15);
    expect(result.breakdown.industry).toBe(10);
    expect(result.breakdown.compensation).toBe(10);
    expect(result.breakdown.location).toBe(10);
    expect(result.qualified).toBe(true);
    // Every reason names a recorded fact or a posting fact.
    expect(result.reasons.join(" ")).toContain("Staff Engineer");
    expect(result.reasons.join(" ")).toContain("TypeScript");
  });

  it("contributes nothing for facts that are not recorded, and says so", () => {
    const emptyProfile: ProfileFacts = {
      skills: [], technologies: [], industries: [], employmentTitles: [],
      hasLeadershipEvidence: false, salaryTarget: null, location: null,
      workArrangement: "any", openToRelocation: false,
    };
    const openPreferences: PreferenceFacts = {
      targetTitles: [], compensationMinimum: null, locations: [],
      workArrangements: [], industries: [], exclusions: [], qualificationThreshold: 80,
    };
    const result = evaluateJob(emptyProfile, openPreferences, job);

    expect(result.breakdown.experience).toBe(0);
    expect(result.breakdown.skills).toBe(0);
    expect(result.breakdown.leadership).toBe(0);
    expect(result.qualified).toBe(false);
    expect(result.gaps.join(" ")).toMatch(/no skills yet/i);
    expect(result.gaps.join(" ")).toMatch(/No leadership evidence/i);
  });

  it("vetoes a job matching an exclusion before scoring anything", () => {
    const result = evaluateJob(profile, preferences, {
      ...job,
      description: "A gambling platform role.",
    });

    expect(result.excluded).toBe("gambling");
    expect(result.score).toBe(0);
    expect(result.gaps[0]).toContain('exclusion "gambling"');
  });

  it("fails compensation against the recorded floor and names both numbers", () => {
    const result = evaluateJob(profile, preferences, { ...job, salaryText: "$150,000" });

    expect(result.breakdown.compensation).toBe(0);
    expect(result.gaps.join(" ")).toContain("150,000");
    expect(result.gaps.join(" ")).toContain("220,000");
  });

  it("stays neutral on compensation when neither side states a figure", () => {
    const result = evaluateJob(profile, { ...preferences, compensationMinimum: null },
      { ...job, salaryText: null });
    // profile.salaryTarget still provides a floor; remove it too.
    const fullyUnstated = evaluateJob({ ...profile, salaryTarget: null },
      { ...preferences, compensationMinimum: null }, { ...job, salaryText: null });

    expect(result.breakdown.compensation).toBe(5);
    expect(fullyUnstated.breakdown.compensation).toBe(5);
    expect(fullyUnstated.gaps.join(" ")).toMatch(/no readable compensation/i);
  });

  it("respects the person's threshold for qualification", () => {
    const strict = evaluateJob(profile, { ...preferences, qualificationThreshold: 99 }, job);
    expect(strict.qualified).toBe(false);
    expect(strict.threshold).toBe(99);
  });
});

describe("fact readers", () => {
  it("reads salary figures across common notations", () => {
    expect(readSalaryFigure("$230k – $260k")).toBe(260000);
    expect(readSalaryFigure("USD 185,000 per year")).toBe(185000);
    expect(readSalaryFigure("competitive")).toBeNull();
    expect(readSalaryFigure(null)).toBeNull();
  });

  it("finds leadership evidence only in recorded text", () => {
    expect(hasLeadershipEvidence([{ title: "Engineering Manager" }])).toBe(true);
    expect(hasLeadershipEvidence([{ title: "Engineer", highlights: ["Mentored four juniors"] }])).toBe(true);
    expect(hasLeadershipEvidence([{ title: "Engineer" }])).toBe(false);
  });
});
