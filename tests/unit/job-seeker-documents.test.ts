import { describe, expect, it } from "vitest";

import {
  buildAtsResume,
  buildCoverLetter,
  buildOutreachDraft,
  matchedKeywords,
  type JobForDocuments,
  type ProfileForDocuments,
} from "@/lib/job-seeker/documents";

/**
 * The anti-fabrication contract, tested from the outside: nothing appears in
 * a generated document that is not recorded in the profile, no matter what
 * the posting asks for.
 */

const profile: ProfileForDocuments = {
  fullName: "Daniel H",
  email: "daniel@example.com",
  phone: "+1 555 0100",
  linkedinUrl: "https://www.linkedin.com/in/example",
  location: "Austin, TX",
  summary: "Platform engineer who ships end to end.",
  skills: ["TypeScript", "PostgreSQL"],
  technologies: ["Next.js"],
  certifications: ["AWS Solutions Architect"],
  employmentHistory: [
    {
      organization: "Surge Services",
      title: "Founder",
      started: "2020",
      summary: "Built a software factory control plane.",
      highlights: ["Shipped a production graph execution engine"],
    },
  ],
  education: [{ organization: "State University", title: "BSc Computer Science", ended: "2016" }],
};

const job: JobForDocuments = {
  title: "Staff Engineer",
  company: "Acme",
  description: "We need TypeScript, Kubernetes, and Next.js experience. Kafka a plus.",
};

describe("matchedKeywords", () => {
  it("returns only the intersection of the posting and the recorded profile", () => {
    expect(matchedKeywords(profile, job)).toEqual(["TypeScript", "Next.js"]);
  });
});

describe("buildAtsResume", () => {
  it("never emits a term the profile does not record, even when the posting demands it", () => {
    const resume = buildAtsResume(profile, job);

    // Demanded by the posting, absent from the profile: must not appear.
    expect(resume).not.toContain("Kubernetes");
    expect(resume).not.toContain("Kafka");
    // Recorded facts appear verbatim.
    expect(resume).toContain("TypeScript");
    expect(resume).toContain("Founder — Surge Services");
    expect(resume).toContain("Shipped a production graph execution engine");
    expect(resume).toContain("AWS Solutions Architect");
    expect(resume).toContain("BSc Computer Science");
  });

  it("omits sections whose facts are absent instead of inventing them", () => {
    const sparse: ProfileForDocuments = {
      ...profile,
      summary: null,
      certifications: [],
      education: [],
      employmentHistory: [],
    };
    const resume = buildAtsResume(sparse, job);

    expect(resume).not.toContain("SUMMARY");
    expect(resume).not.toContain("CERTIFICATIONS");
    expect(resume).not.toContain("EDUCATION");
    expect(resume).not.toContain("EXPERIENCE");
  });
});

describe("buildCoverLetter", () => {
  it("claims only recorded experience and cites the latest recorded highlight", () => {
    const letter = buildCoverLetter(profile, job);

    expect(letter).toContain("Staff Engineer role");
    expect(letter).toContain("Founder at Surge Services");
    expect(letter).toContain("TypeScript, Next.js");
    expect(letter).not.toContain("Kubernetes");
    expect(letter).toContain("Shipped a production graph execution engine");
  });

  it("survives an empty history without inventing a current role", () => {
    const letter = buildCoverLetter({ ...profile, employmentHistory: [] }, job);

    expect(letter).not.toContain("currently");
    expect(letter).toContain("Dear Acme hiring team");
  });
});

describe("buildOutreachDraft", () => {
  it("writes a factual draft naming only recorded experience", () => {
    const draft = buildOutreachDraft(profile, job, { name: "Riley Recruiter", role: "Technical Recruiter" });

    expect(draft.subject).toBe("Staff Engineer application — Daniel H");
    expect(draft.body).toContain("Hi Riley Recruiter,");
    expect(draft.body).toContain("Founder at Surge Services");
    expect(draft.body).toContain("TypeScript");
    expect(draft.body).not.toContain("Kubernetes");
    // It never claims a send, a reply, or anything that has not happened.
    expect(draft.body.toLowerCase()).not.toContain("sent");
  });
});
