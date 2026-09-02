import { describe, expect, it } from "vitest";

import {
  companyMemory,
  GAP_MINIMUM_POSTINGS,
  namedSkills,
  SKILL_VOCABULARY,
  skillsGap,
  type RecordedPosting,
} from "@/lib/job-seeker/what-costs";

/**
 * What keeps costing you (ADR-245): the skills gap is counted over the
 * person's recorded postings against their own profile, and company memory
 * says what their own rows say about an employer — nothing else.
 */

function posting(overrides: Partial<RecordedPosting> & { id: string }): RecordedPosting {
  return {
    company: "Nordisk Teknik A/S",
    title: "Engineer",
    description: null,
    qualified: null,
    discoveredAt: "2026-08-01T00:00:00Z",
    application: null,
    ...overrides,
  };
}

describe("namedSkills", () => {
  it("names each vocabulary term once, on word boundaries, regardless of case", () => {
    const named = namedSkills("We use typescript and TypeScript daily, with PostgreSQL and Kubernetes.");
    expect(named).toEqual(["TypeScript", "PostgreSQL", "Kubernetes"]);
  });

  it("does not read a term inside another word or symbol", () => {
    // "Go" inside "Google", "R" inside "React", "C" inside "C#" — none of those is the term.
    expect(namedSkills("Google Ads and React, plus C#")).toEqual(["C#", "React", "Google Ads"]);
    expect(namedSkills("Written in Go and R.")).toEqual(["Go", "R"]);
    expect(namedSkills("Node.js on .NET, C++ too")).toEqual(["C++", "Node.js", ".NET"]);
  });

  it("has a vocabulary with no duplicate terms", () => {
    expect(new Set(SKILL_VOCABULARY.map((term) => term.toLowerCase())).size).toBe(SKILL_VOCABULARY.length);
  });
});

describe("skillsGap", () => {
  const postings = [
    posting({ id: "1", description: "Kubernetes, Terraform and Python.", qualified: true }),
    posting({ id: "2", title: "Kubernetes Engineer", description: "Terraform, Go.", qualified: false }),
    posting({ id: "3", description: "Terraform and TypeScript.", qualified: true }),
    posting({ id: "4", description: "Only Rust and TypeScript here.", qualified: null }),
  ];

  it("ranks the terms your postings keep naming that your profile does not list, with the counts printed", () => {
    const gap = skillsGap(postings, ["typescript"]);
    expect(gap.map((row) => [row.term, row.postings, row.qualifiedPostings])).toEqual([
      ["Terraform", 3, 2],
      ["Kubernetes", 2, 1],
    ]);
    expect(gap[0]!.sentence).toBe("Terraform — named in 3 of your 4 recorded postings (2 of them qualified); not in your profile.");
  });

  it("leaves out a term named by fewer postings than the printed minimum", () => {
    expect(GAP_MINIMUM_POSTINGS).toBe(2);
    const terms = skillsGap(postings, []).map((row) => row.term);
    expect(terms).not.toContain("Python");
    expect(terms).not.toContain("Rust");
    expect(terms).toContain("TypeScript");
  });

  it("skips terms the profile lists, case-insensitively, and honours the limit", () => {
    expect(skillsGap(postings, ["TERRAFORM", " kubernetes "]).map((row) => row.term)).toEqual(["TypeScript"]);
    expect(skillsGap(postings, [], 1).map((row) => row.term)).toEqual(["Terraform"]);
  });

  it("answers nothing from nothing", () => {
    expect(skillsGap([], ["TypeScript"])).toEqual([]);
  });
});

describe("companyMemory", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  it("is null when you have no record with the company", () => {
    expect(companyMemory([posting({ id: "1" })], "Other Corp", now)).toBeNull();
  });

  it("counts the postings you recorded and applied to none", () => {
    const memory = companyMemory([posting({ id: "1" }), posting({ id: "2" })], "Nordisk Teknik A/S", now);
    expect(memory).toEqual({
      company: "Nordisk Teknik A/S",
      recorded: 2,
      applied: 0,
      sentence: "You recorded 2 postings from Nordisk Teknik A/S and applied to none.",
    });
  });

  it("matches the company by identity, not by exact spelling", () => {
    const memory = companyMemory([posting({ id: "1", company: "nordisk teknik a/s" })], "Nordisk Teknik A/S", now);
    expect(memory?.recorded).toBe(1);
  });

  it("says how the most recent application went, in your own words", () => {
    const rows = [
      posting({ id: "1", application: { stage: "CLOSED", appliedAt: "2026-07-01T00:00:00Z", closedReason: "no_response" } }),
      posting({ id: "2", application: { stage: "CLOSED", appliedAt: "2026-08-10T00:00:00Z", closedReason: "rejected_after_interview" } }),
    ];
    expect(companyMemory(rows, "Nordisk Teknik A/S", now)?.sentence).toBe(
      "You applied to Nordisk Teknik A/S on 2026-08-10; rejected after an interview.",
    );
    expect(companyMemory(rows, "Nordisk Teknik A/S", now)?.applied).toBe(2);
  });

  it("counts the days with no reply against today, and names a reply when one came", () => {
    const silent = [posting({ id: "1", application: { stage: "APPLIED", appliedAt: "2026-08-23T12:00:00Z", closedReason: null } })];
    expect(companyMemory(silent, "Nordisk Teknik A/S", now)?.sentence).toBe(
      "You applied to Nordisk Teknik A/S on 2026-08-23; no reply in 10 days.",
    );
    const heard = [posting({ id: "1", application: { stage: "INTERVIEW", appliedAt: "2026-08-23T12:00:00Z", closedReason: null } })];
    expect(companyMemory(heard, "Nordisk Teknik A/S", now)?.sentence).toBe(
      "You applied to Nordisk Teknik A/S on 2026-08-23 and heard back (interview).",
    );
  });

  it("treats a pipeline entry that was never applied to as not applied", () => {
    const rows = [posting({ id: "1", application: { stage: "FOUND", appliedAt: null, closedReason: null } })];
    expect(companyMemory(rows, "Nordisk Teknik A/S", now)?.sentence).toBe(
      "You recorded one posting from Nordisk Teknik A/S and applied to none.",
    );
  });
});
