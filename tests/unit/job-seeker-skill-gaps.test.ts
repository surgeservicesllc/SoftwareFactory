import { describe, expect, it } from "vitest";

import { analyseSkillGaps, type PostingForGapAnalysis } from "@/lib/job-seeker/skill-gaps";
import { LIVE_POSTING_DESCRIPTION } from "@/tests/fixtures/job-seeker/live-posting";

/**
 * The skill-gap model's contract: every row carries its sample.
 *
 * This is a count over the person's own board, not market data, and the
 * failure to guard against is the surface reading as research. So the sample
 * size travels with the answer, a one-posting coincidence never becomes a
 * row, and an unscored posting contributes no invented score.
 */

function posting(overrides: Partial<PostingForGapAnalysis> = {}): PostingForGapAnalysis {
  return {
    title: "Platform Engineer",
    company: "Acme",
    description: "We use AWS and Postgres. Experience with CRM integrations.",
    score: 80,
    ...overrides,
  };
}

describe("analyseSkillGaps", () => {
  it("separates what the profile records from what it does not", () => {
    const model = analyseSkillGaps(
      [posting(), posting({ company: "Globex" })],
      ["Postgres"],
    );
    expect(model.strengths.map((row) => row.term.toLowerCase())).toContain("postgres");
    expect(model.gaps.map((row) => row.term.toLowerCase())).toContain("aws");
    expect(model.gaps.map((row) => row.term.toLowerCase())).not.toContain("postgres");
  });

  it("refuses to make a trend out of a single posting", () => {
    // One posting naming a term is a coincidence. A table row implies a
    // pattern, and there is none to imply.
    const model = analyseSkillGaps([posting()], []);
    expect(model.gaps).toEqual([]);
    expect(model.strengths).toEqual([]);
    expect(model.analysed).toBe(1);
  });

  it("counts a term once per posting, however often the posting repeats it", () => {
    const model = analyseSkillGaps([
      posting({ description: "AWS AWS AWS AWS and more AWS." }),
      posting({ company: "Globex", description: "We run on AWS." }),
    ], []);
    expect(model.gaps.find((row) => row.term.toUpperCase() === "AWS")?.postings).toBe(2);
  });

  it("counts postings with no description as skipped, never as read", () => {
    // A hand-recorded posting with no body cannot be read. Silently dropping
    // it would make the coverage figure describe a sample nobody stated.
    const model = analyseSkillGaps([
      posting(), posting({ company: "Globex" }),
      posting({ company: "Initech", description: null }),
      posting({ company: "Umbrella", description: "   " }),
    ], []);
    expect(model.analysed).toBe(2);
    expect(model.skipped).toBe(2);
  });

  it("leaves the average match null when no posting naming a term is scored", () => {
    // A 0 would rank a real gap last. Null says there is nothing to rank by.
    const model = analyseSkillGaps([
      posting({ score: null }), posting({ company: "Globex", score: null }),
    ], []);
    expect(model.gaps[0].averageScore).toBeNull();
  });

  it("ranks a gap in your strongest matches above a commoner one in weak ones", () => {
    // Raw frequency ranks the terms in whatever you saved most of, which is
    // usually what you were least selective about.
    const model = analyseSkillGaps([
      posting({ company: "A", description: "Kubernetes required.", score: 95 }),
      posting({ company: "B", description: "Kubernetes required.", score: 95 }),
      posting({ company: "C", description: "COBOL required.", score: 10 }),
      posting({ company: "D", description: "COBOL required.", score: 10 }),
      posting({ company: "E", description: "COBOL required.", score: 10 }),
    ], []);
    const terms = model.gaps.map((row) => row.term.toLowerCase());
    expect(terms.indexOf("kubernetes")).toBeLessThan(terms.indexOf("cobol"));
  });

  it("names the roles a row came from, so it can be traced", () => {
    const model = analyseSkillGaps([
      posting({ company: "Acme" }), posting({ company: "Globex" }),
    ], []);
    const aws = model.gaps.find((row) => row.term.toUpperCase() === "AWS");
    expect(aws?.examples).toEqual([
      "Platform Engineer — Acme",
      "Platform Engineer — Globex",
    ]);
  });

  it("reports coverage as null with nothing to measure, not as zero", () => {
    // "No sample" and "you cover none of it" are different facts.
    expect(analyseSkillGaps([], []).coverage).toBeNull();
    expect(analyseSkillGaps([posting()], []).coverage).toBeNull();
  });

  it("computes coverage over what was actually demanded", () => {
    const model = analyseSkillGaps([
      posting({ description: "AWS and Postgres." }),
      posting({ company: "Globex", description: "AWS and Postgres." }),
    ], ["Postgres"]);
    expect(model.coverage).toBe(50);
  });

  it("finds a recorded skill the extractor has never heard of", () => {
    // The strengths column is exact for a reason: a niche framework on
    // someone's profile must not vanish from their own strengths because a
    // curated vocabulary does not list it.
    const model = analyseSkillGaps([
      posting({ description: "We build on Zorblatt and ship weekly." }),
      posting({ company: "Globex", description: "Zorblatt experience required." }),
    ], ["Zorblatt"]);
    expect(model.strengths.map((row) => row.term)).toContain("Zorblatt");
    expect(model.gaps.map((row) => row.term)).not.toContain("Zorblatt");
  });

  it("finds an ordinary capitalised technology name, not only acronyms", () => {
    // "Kubernetes" and "Postgres" are the terms people actually want to see;
    // neither is an acronym and neither carries a digit.
    const model = analyseSkillGaps([
      posting({ description: "Kubernetes and Postgres in production." }),
      posting({ company: "Globex", description: "Kubernetes and Postgres, daily." }),
    ], ["Postgres"]);
    expect(model.gaps.map((row) => row.term)).toContain("Kubernetes");
    expect(model.strengths.map((row) => row.term)).toContain("Postgres");
  });

  it("holds up against a real posting rather than a tidy fixture", () => {
    const model = analyseSkillGaps([
      posting({ description: LIVE_POSTING_DESCRIPTION, score: 72 }),
      posting({ company: "Globex", description: LIVE_POSTING_DESCRIPTION, score: 68 }),
    ], ["API"]);
    const gapTerms = model.gaps.map((row) => row.term.toUpperCase());
    expect(gapTerms).toContain("AWS");
    expect(gapTerms).toContain("CRM");
    expect(model.strengths.map((row) => row.term.toUpperCase())).toContain("API");
    // The extractor's noise floor is the real risk here: a table of forty
    // rows from two postings is not advice.
    expect(model.gaps.length).toBeLessThan(15);
    expect(model.gaps[0].averageScore).toBe(70);
  });
});
