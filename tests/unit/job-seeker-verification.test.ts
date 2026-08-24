import { describe, expect, it } from "vitest";

import { buildAtsResume, type ProfileForDocuments } from "@/lib/job-seeker/documents";
import {
  auditGrounding,
  postingTerms,
  verifyDocument,
  verifyKeywords,
  verifyParseability,
} from "@/lib/job-seeker/verification";
import { LIVE_POSTING_DESCRIPTION } from "@/tests/fixtures/job-seeker/live-posting";

/**
 * Verification's contract: report what is true, act on nothing.
 *
 * The whole risk in a keyword table is noise — a mechanical extractor that
 * reports "Time", "Strong" and "Ability" as unmet requirements buries the two
 * findings that matter. So the extractor is measured against a real posting
 * rather than a tidy fixture.
 */

const PROFILE: ProfileForDocuments = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+1 512 555 0134",
  linkedinUrl: "https://www.linkedin.com/in/ada",
  location: "Austin, TX",
  summary: "Platform engineer who owns public APIs end to end.",
  skills: ["API design", "Integrations", "OAuth"],
  technologies: ["TypeScript", "Postgres", "AWS"],
  certifications: [],
  employmentHistory: [
    {
      organization: "Surge Services",
      title: "Staff Platform Engineer",
      started: "2021",
      ended: "2026",
      summary: "Owned the public API and its integrations.",
      highlights: ["Cut webhook failures by rewriting the retry path"],
    },
  ],
  education: [
    { organization: "University of Texas", title: "BS Computer Science", started: "2013", ended: "2017" },
  ],
};

const JOB = {
  title: "Platform Engineer",
  company: "Hyperbound",
  description: LIVE_POSTING_DESCRIPTION,
};

describe("postingTerms, against a real posting", () => {
  const terms = postingTerms(LIVE_POSTING_DESCRIPTION);

  it("finds the technical terms the posting actually states", () => {
    expect(terms).toContain("API");
    expect(terms).toContain("AWS");
    expect(terms).toContain("CRM");
    expect(terms).toContain("SOC");
    expect(terms).toContain("CI/CD");
  });

  it("reads a compound token once, not three times", () => {
    // "CI/CD" also matches the acronym pattern as CI and as CD. Listing all
    // three would invent two requirements out of one.
    expect(terms).not.toContain("CI");
    expect(terms).not.toContain("CD");
  });

  it("does not mistake prose capitalisation for a skill", () => {
    // These open real bullets in this posting: "Time spent in the weeds…",
    // "A track record of owning something end to end…".
    for (const noise of ["Time", "Bonus", "Experience", "Strong", "Ability", "The", "You"]) {
      expect(terms).not.toContain(noise);
    }
  });

  it("drops roman numerals and benefits acronyms", () => {
    // This posting states "SOC 2 Type II", "Peak XV Partners", "PTO: Unlimited".
    expect(terms).not.toContain("II");
    expect(terms).not.toContain("XV");
    expect(terms).not.toContain("PTO");
    expect(terms).not.toContain("YC");
  });

  it("stops before compensation, interview logistics and the EEO statement", () => {
    // Everything after those headings is real and none of it is a skill.
    expect(terms).not.toContain("PPO");
    expect(terms.length).toBeLessThan(20);
  });

  it("matches a vocabulary term as a whole word, not as a substring", () => {
    // Without word boundaries the vocabulary is worse than no vocabulary:
    // "REST" matches "restaurant", "Java" matches "JavaScript", and every
    // one of those rows is a requirement the posting never stated.
    const found = postingTerms(
      "We run a restaurant analytics team. JavaScript throughout. Nodemon in dev.",
    );
    expect(found).toContain("JavaScript");
    expect(found).not.toContain("REST");
    expect(found).not.toContain("Java");
    expect(found).not.toContain("Node");
  });

  it("finds an ordinary capitalised technology name", () => {
    // The terms people actually want to see are neither acronyms nor tokens
    // carrying a digit, which is what the curated vocabulary is for.
    const found = postingTerms("Kubernetes, Terraform and Postgres in production.");
    expect(found).toContain("Kubernetes");
    expect(found).toContain("Terraform");
    expect(found).toContain("Postgres");
  });

  it("returns nothing for a posting with no description rather than guessing", () => {
    expect(postingTerms(null)).toEqual([]);
    expect(postingTerms("")).toEqual([]);
  });
});

describe("verifyKeywords", () => {
  it("marks a profile term the posting names and the resume carries as covered", () => {
    const resume = buildAtsResume(PROFILE, JOB);
    const findings = verifyKeywords(resume, PROFILE, JOB);
    const aws = findings.find((finding) => finding.term === "AWS");
    expect(aws).toMatchObject({ status: "covered", origin: "profile" });
  });

  it("surfaces a recorded skill the posting asks for and the resume omits", () => {
    // The finding a person can act on today, and the only one that is exact.
    const resume = "Ada Lovelace\nada@example.com\n\nSUMMARY\nEngineer.";
    const findings = verifyKeywords(resume, PROFILE, JOB);
    const missing = findings.filter((finding) => finding.status === "missing_have_it");
    expect(missing.map((finding) => finding.term)).toContain("AWS");
    // Actionable findings lead; a person reads the top of the list.
    expect(findings[0].status).toBe("missing_have_it");
  });

  it("leaves a term the profile does not record as a gap", () => {
    const resume = buildAtsResume(PROFILE, JOB);
    const findings = verifyKeywords(resume, PROFILE, JOB);
    const crm = findings.find((finding) => finding.term === "CRM");
    // The profile records no CRM experience, and the resume must not gain
    // any because a table asked. A gap stays a gap.
    expect(crm?.status).toBe("missing_gap");
    expect(resume).not.toContain("CRM");
  });

  it("never claims synonymy, which no mechanical pass can establish", () => {
    const findings = verifyKeywords(buildAtsResume(PROFILE, JOB), PROFILE, JOB);
    expect(findings.some((finding) => finding.status === "synonym_only")).toBe(false);
  });

  it("reports each term once even when both sources name it", () => {
    const findings = verifyKeywords(buildAtsResume(PROFILE, JOB), PROFILE, JOB);
    const terms = findings.map((finding) => finding.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });
});

describe("verifyParseability", () => {
  const resume = buildAtsResume(PROFILE, JOB);

  it("passes a generated resume, which is ATS-safe by construction", () => {
    const checks = verifyParseability(resume, PROFILE);
    const failed = checks.filter((check) => !check.passed);
    expect(failed.map((check) => `${check.id}: ${check.detail}`)).toEqual([]);
  });

  it("requires the email to be literal text a parser can read", () => {
    const checks = verifyParseability(resume.replace("ada@example.com", "[contact]"), PROFILE);
    expect(checks.find((check) => check.id === "email_literal")?.passed).toBe(false);
  });

  it("sends a person to their profile when no email is recorded there", () => {
    const checks = verifyParseability(resume, { ...PROFILE, email: null });
    const email = checks.find((check) => check.id === "email_literal");
    expect(email?.passed).toBe(false);
    expect(email?.detail).toMatch(/No email is recorded on your profile/);
  });

  it("catches encoding damage carried in from an extracted PDF", () => {
    for (const damaged of [`${resume}\n(cid:42)`, `${resume}\nreplacement � here`]) {
      const checks = verifyParseability(damaged, PROFILE);
      expect(checks.find((check) => check.id === "encoding_intact")?.passed).toBe(false);
    }
  });

  it("fails a role whose line carries no year", () => {
    const undated = { ...PROFILE, employmentHistory: [
      { organization: "Surge Services", title: "Staff Platform Engineer" },
    ] };
    const checks = verifyParseability(buildAtsResume(undated, JOB), undated);
    const dates = checks.find((check) => check.id === "dates_present");
    expect(dates?.passed).toBe(false);
    expect(dates?.detail).toContain("Staff Platform Engineer");
  });

  it("reports an empty document as empty rather than as passing", () => {
    const checks = verifyParseability("", PROFILE);
    expect(checks.find((check) => check.id === "text_present")?.passed).toBe(false);
  });
});

describe("auditGrounding", () => {
  it("passes a generated document, which only copies recorded facts", () => {
    expect(auditGrounding(buildAtsResume(PROFILE, JOB), PROFILE, JOB)).toEqual([]);
  });

  it("catches a metric nobody recorded", () => {
    // The exact failure this audit exists for: a revision that escalates a
    // real achievement into a number the profile never stated.
    const inflated = `${buildAtsResume(PROFILE, JOB)}\n• Cut webhook failures by 94%`;
    const findings = auditGrounding(inflated, PROFILE, JOB);
    expect(findings.map((finding) => finding.claim)).toContain("94%");
  });

  it("accepts a figure the posting states, but only for a cover letter", () => {
    // A letter quoting the employer's own "$200,000 to $220,000" band is
    // quoting a fact the employer published.
    const letter = "I am applying for the Platform Engineer role. The posted band is 200,000.";
    expect(auditGrounding(letter, PROFILE, JOB, { postingIsSource: true })).toEqual([]);
    // The same figure in a resume is a claim about the candidate, and the
    // posting cannot support one.
    expect(auditGrounding(letter, PROFILE, JOB)).toHaveLength(1);
  });

  it("does not let the employer's own numbers ground a candidate's claim", () => {
    // The live posting says "posted 300% net revenue retention". A resume
    // bullet claiming the candidate grew revenue 300% is a different claim
    // about a different party, and the posting is no evidence for it.
    const inflated = "• Grew revenue 300%";
    expect(auditGrounding(inflated, PROFILE, JOB)).toHaveLength(1);
    expect(LIVE_POSTING_DESCRIPTION).toContain("300%");
  });

  it("reads a figure that ends a sentence as the figure, not the punctuation", () => {
    const withPeriod = "The posted band is 200,000.";
    const [finding] = auditGrounding(withPeriod, PROFILE, JOB);
    expect(finding.claim).toBe("200,000");
  });

  it("does not flag a year, which is a date rather than a metric", () => {
    const withDates = "Staff Platform Engineer — Surge Services (2021 – 2026)";
    expect(auditGrounding(withDates, PROFILE, JOB)).toEqual([]);
  });
});

describe("verifyDocument", () => {
  it("grades a resume on structure and keywords, and a letter on neither", () => {
    const resume = verifyDocument({
      content: buildAtsResume(PROFILE, JOB), kind: "resume", profile: PROFILE, job: JOB,
    });
    expect(resume.parseability.length).toBeGreaterThan(0);
    expect(resume.keywords.length).toBeGreaterThan(0);
    expect(resume.clean).toBe(true);

    const letter = verifyDocument({
      content: "Dear Hyperbound hiring team,\n\nI am applying for the Platform Engineer role.",
      kind: "cover_letter", profile: PROFILE, job: JOB,
    });
    // A cover letter is read by a person. Grading it on section headings
    // would report a defect that is not one.
    expect(letter.parseability).toEqual([]);
    expect(letter.keywords).toEqual([]);
    expect(letter.clean).toBe(true);
  });

  it("is not clean when a claim is ungrounded, however well the resume parses", () => {
    const result = verifyDocument({
      content: `${buildAtsResume(PROFILE, JOB)}\n• Grew revenue 94%`,
      kind: "resume", profile: PROFILE, job: JOB,
    });
    expect(result.parseability.every((check) => check.passed)).toBe(true);
    expect(result.clean).toBe(false);
  });

  it("treats a missing keyword as advice, not as a failed verification", () => {
    // A gap is information for the cover letter. Failing the document for it
    // would push toward keyword stuffing, which is the thing to prevent.
    const result = verifyDocument({
      content: buildAtsResume(PROFILE, JOB), kind: "resume", profile: PROFILE, job: JOB,
    });
    expect(result.keywords.some((finding) => finding.status === "missing_gap")).toBe(true);
    expect(result.clean).toBe(true);
  });
});
