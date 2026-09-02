import { describe, expect, it } from "vitest";

import {
  buildKitBlocks,
  checkRequirements,
  extractRequirements,
  recordedExperienceYears,
  toScreeningAnswers,
  type KitProfile,
} from "@/lib/job-seeker/application-kit";

/**
 * The application kit (ADR-244): the blocks copy the profile without
 * rewording, and every requirement verdict names the fact it used — or
 * says that nothing recorded can answer it. The "unknown" cases are the
 * ones a plausible implementation gets wrong by assuming.
 */

const NOW = new Date("2026-09-02T12:00:00Z");

const profile: KitProfile = {
  fullName: "Dana Reyes",
  email: "dana@example.com",
  phone: "+1 555 0100",
  linkedinUrl: "https://www.linkedin.com/in/dana",
  location: "Austin, TX",
  summary: "Platform engineer who ships.",
  skills: ["TypeScript", "Kubernetes"],
  technologies: ["PostgreSQL"],
  certifications: ["AWS Solutions Architect"],
  employmentHistory: [
    { organization: "Acme", title: "Staff Engineer", started: "2021", highlights: ["Led the platform team"] },
    { organization: "Beta", title: "Engineer", started: "2016", ended: "2021" },
  ],
  education: [{ organization: "State University", title: "BSc Computer Science", ended: "2016" }],
};

const empty: KitProfile = {
  fullName: null, email: null, phone: null, linkedinUrl: null, location: null, summary: null,
  skills: [], technologies: [], certifications: [], employmentHistory: [], education: [],
};

describe("buildKitBlocks", () => {
  it("copies the profile into the blocks a form asks for, in order, and adds the answered questions", () => {
    const blocks = buildKitBlocks(profile, { work_authorization: "Yes — US citizen", needs_sponsorship: "No" });
    expect(blocks.map((block) => block.key)).toEqual(["contact", "summary", "experience", "education", "skills", "certifications", "screening"]);
    expect(blocks[0]!.text).toBe("Dana Reyes\ndana@example.com\n+1 555 0100\nAustin, TX\nhttps://www.linkedin.com/in/dana");
    expect(blocks[2]!.text).toContain("Staff Engineer — Acme (2021 – present)\n• Led the platform team");
    expect(blocks[4]!.text).toBe("TypeScript, Kubernetes, PostgreSQL");
    expect(blocks[6]!.text).toBe(
      "Are you legally authorized to work in the country of this job?\nYes — US citizen\n\nWill you now or in the future require visa sponsorship?\nNo",
    );
  });

  it("produces nothing from nothing", () => {
    expect(buildKitBlocks(empty, {})).toEqual([]);
  });
});

describe("extractRequirements", () => {
  it("keeps the sentences that state a requirement, once each, bounded", () => {
    const lines = extractRequirements(
      "About us. We build things.\n• 5+ years of experience with TypeScript required.\n• Bachelor's degree in CS or equivalent.\n"
      + "• Must be authorized to work in the US without sponsorship.\n• 5+ years of experience with TypeScript required.\nNice to have: Go.",
    );
    expect(lines).toEqual([
      "5+ years of experience with TypeScript required.",
      "Bachelor's degree in CS or equivalent.",
      "Must be authorized to work in the US without sponsorship.",
    ]);
    expect(extractRequirements(null)).toEqual([]);
  });
});

describe("recordedExperienceYears", () => {
  it("spans the earliest start to the latest end or today", () => {
    expect(recordedExperienceYears(profile.employmentHistory, NOW)).toBe(10);
    expect(recordedExperienceYears([{ organization: "X", title: "Y" }], NOW)).toBeNull();
  });
});

describe("checkRequirements", () => {
  it("answers years from the screening answer first, then the recorded dates, and says unknown otherwise", () => {
    const line = "5+ years of experience with TypeScript required.";
    expect(checkRequirements([line], profile, { years_experience: "3" }, NOW)[0]).toMatchObject({
      verdict: "unmet", reason: "Asks for 5+ years; your screening answer (3 years) falls short.",
    });
    expect(checkRequirements([line], profile, {}, NOW)[0]).toMatchObject({
      verdict: "met", reason: "Asks for 5+ years; your recorded history (10 years from its dates) covers it.",
    });
    expect(checkRequirements([line], empty, {}, NOW)[0]).toMatchObject({ verdict: "unknown" });
  });

  it("answers authorization and sponsorship from the screening answers, never by assumption", () => {
    const line = "Must be authorized to work in the US without sponsorship.";
    expect(checkRequirements([line], profile, {}, NOW)[0]).toMatchObject({ verdict: "unknown" });
    expect(checkRequirements([line], profile, { needs_sponsorship: "No", work_authorization: "Yes" }, NOW)[0]).toMatchObject({
      verdict: "met", reason: "Your screening answer: sponsorship not required, authorized to work.",
    });
    expect(checkRequirements([line], profile, { needs_sponsorship: "Yes, H-1B" }, NOW)[0]).toMatchObject({ verdict: "unmet" });
    expect(checkRequirements(["Visa sponsorship is available."], profile, {}, NOW)[0]).toMatchObject({ verdict: "met" });
  });

  it("answers degrees, certifications, clearance and languages from what is recorded", () => {
    expect(checkRequirements(["Bachelor's degree in Computer Science required."], profile, {}, NOW)[0]).toMatchObject({ verdict: "met" });
    expect(checkRequirements(["Master's degree required."], profile, {}, NOW)[0]).toMatchObject({ verdict: "unmet" });
    expect(checkRequirements(["Master's degree required."], empty, {}, NOW)[0]).toMatchObject({ verdict: "unknown" });
    expect(checkRequirements(["AWS Solutions Architect certification required."], profile, {}, NOW)[0]).toMatchObject({
      verdict: "met", reason: "Your profile records AWS Solutions Architect.",
    });
    expect(checkRequirements(["Active security clearance required."], profile, { security_clearance: "None" }, NOW)[0]).toMatchObject({ verdict: "unmet" });
    expect(checkRequirements(["Must be fluent in Danish."], profile, { languages: "English (native), Danish (fluent)" }, NOW)[0]).toMatchObject({ verdict: "met" });
    expect(checkRequirements(["Must be fluent in German."], profile, { languages: "English" }, NOW)[0]).toMatchObject({ verdict: "unmet" });
  });

  it("checks a skills line against the profile and refuses to assume a skill not recorded", () => {
    expect(checkRequirements(["Experience with Kubernetes and Terraform required."], profile, {}, NOW)[0]).toMatchObject({
      verdict: "met", reason: "Your profile records Kubernetes.",
    });
    expect(checkRequirements(["Experience with Terraform required."], profile, {}, NOW)[0]).toMatchObject({ verdict: "unmet" });
    expect(checkRequirements(["Experience with Terraform required."], empty, {}, NOW)[0]).toMatchObject({ verdict: "unknown" });
  });
});

describe("toScreeningAnswers", () => {
  it("keeps known keys and drops the rest", () => {
    expect(toScreeningAnswers([{ question_key: "notice_period", answer: "30 days" }, { question_key: "shoe_size", answer: "42" }]))
      .toEqual({ notice_period: "30 days" });
  });
});
