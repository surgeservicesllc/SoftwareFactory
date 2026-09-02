import { describe, expect, it } from "vitest";

import type { KitProfile } from "@/lib/job-seeker/application-kit";
import {
  buildPrepSheet,
  gapsToPrepare,
  matchedStrengths,
  PREP_BASIS,
  questionsToAsk,
  relevantHistory,
  type PrepJob,
} from "@/lib/job-seeker/interview-prep";

/**
 * The prep sheet (ADR-246) is composed from recorded facts and the posting's
 * own text: every strength names where it is recorded, every gap names the
 * posting's term, every history entry is copied, and every question to ask
 * names the fact the posting left out.
 */

const PROFILE: KitProfile = {
  fullName: "Dana Reyes", email: null, phone: null, linkedinUrl: null, location: null, summary: null,
  skills: ["TypeScript", "Kubernetes"],
  technologies: ["PostgreSQL"],
  certifications: ["CKA"],
  employmentHistory: [
    { organization: "Acme", title: "Platform Engineer", started: "2021", highlights: ["Ran Kubernetes for 40 services.", "Moved billing to PostgreSQL."] },
    { organization: "Globex", title: "Support Lead", started: "2018", ended: "2021", summary: "Ran the support desk." },
  ],
  education: [],
};

const JOB: PrepJob = {
  title: "Senior Platform Engineer",
  company: "Nordisk Teknik A/S",
  description: "You will run Kubernetes and Terraform on AWS, with PostgreSQL. Must be authorized to work in Denmark. Contact us on Telegram to start. ".repeat(2),
  salaryText: null,
  location: "København",
  workModel: null,
  publishedOn: null,
};

describe("matchedStrengths", () => {
  it("names each recorded term the posting names, with where it is recorded and where it was used", () => {
    expect(matchedStrengths(JOB, PROFILE)).toEqual([
      { term: "Kubernetes", evidence: "listed under your skills; used at Acme as Platform Engineer" },
      { term: "PostgreSQL", evidence: "listed under your technologies; used at Acme as Platform Engineer" },
    ]);
  });

  it("answers nothing for an empty profile", () => {
    expect(matchedStrengths(JOB, { ...PROFILE, skills: [], technologies: [], certifications: [] })).toEqual([]);
  });
});

describe("gapsToPrepare", () => {
  it("lists the posting's vocabulary terms the profile does not record, each as a sentence", () => {
    expect(gapsToPrepare(JOB, PROFILE).map((gap) => gap.term)).toEqual(["AWS", "Terraform"]);
    expect(gapsToPrepare(JOB, PROFILE)[0]!.sentence).toBe("The posting names AWS; your profile does not. Decide what you will say about it.");
  });
});

describe("relevantHistory", () => {
  it("keeps the entries that share a term with the posting, most shared first, highlights verbatim", () => {
    const history = relevantHistory(JOB, PROFILE);
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({
      organization: "Acme",
      title: "Platform Engineer",
      span: "2021 – present",
      sharedTerms: ["PostgreSQL", "Kubernetes"],
      highlights: ["Ran Kubernetes for 40 services.", "Moved billing to PostgreSQL."],
    });
  });
});

describe("questionsToAsk", () => {
  it("asks about each fact the posting left out, and about each red flag, naming the phrase", () => {
    const questions = questionsToAsk(JOB, true);
    expect(questions[0]).toBe("What is the salary range for this role? The posting does not state pay.");
    expect(questions[1]).toBe("Is the role remote, hybrid or on site? The posting does not say.");
    expect(questions.some((question) => question.startsWith("The posting says “Telegram” — ask what that means in practice."))).toBe(true);
    expect(questions.some((question) => question.includes("level"))).toBe(false);
  });

  it("asks about the level when the title states none, and nothing when everything is stated", () => {
    expect(questionsToAsk(JOB, false).some((question) => question.includes("The title states no level"))).toBe(true);
    const complete: PrepJob = {
      ...JOB,
      description: "A plain role description with nothing alarming in it at all. ".repeat(5),
      salaryText: "DKK 60,000 per month",
      workModel: "hybrid",
    };
    expect(questionsToAsk(complete, true)).toEqual([]);
  });
});

describe("buildPrepSheet", () => {
  it("composes every section from the inputs and carries the basis", () => {
    const sheet = buildPrepSheet({
      job: JOB,
      titleStatesLevel: true,
      profile: PROFILE,
      answers: { work_authorization: "Yes, I am authorized to work in Denmark." },
      application: { stage: "INTERVIEW", notes: "Second round with the CTO.", appliedAt: "2026-08-10", followUpAt: null },
      contacts: [{ name: "Mette Holm", role: "Engineering Manager", source: "LinkedIn" }],
      memory: { company: "Nordisk Teknik A/S", recorded: 2, applied: 1, sentence: "You applied to Nordisk Teknik A/S on 2026-08-10 and heard back (interview)." },
    });
    expect(sheet.strengths.map((strength) => strength.term)).toEqual(["Kubernetes", "PostgreSQL"]);
    expect(sheet.gaps.map((gap) => gap.term)).toEqual(["AWS", "Terraform"]);
    // The authorization line is met by the answer and therefore not on the sheet; nothing else is a requirement sentence.
    expect(sheet.toAnswer.map((check) => check.verdict)).not.toContain("met");
    expect(sheet.history[0]!.organization).toBe("Acme");
    expect(sheet.contacts).toEqual([{ name: "Mette Holm", role: "Engineering Manager", source: "LinkedIn" }]);
    expect(sheet.notes).toBe("Second round with the CTO.");
    expect(sheet.memory?.sentence).toContain("heard back");
    expect(sheet.basis).toBe(PREP_BASIS);
  });

  it("is still a sheet with no application, no contacts and no profile", () => {
    const sheet = buildPrepSheet({
      job: JOB,
      titleStatesLevel: true,
      profile: { ...PROFILE, skills: [], technologies: [], certifications: [], employmentHistory: [] },
      answers: {},
      application: null,
      contacts: [],
      memory: null,
    });
    expect(sheet.strengths).toEqual([]);
    expect(sheet.history).toEqual([]);
    expect(sheet.notes).toBeNull();
    expect(sheet.memory).toBeNull();
    expect(sheet.toAnswer.length).toBeGreaterThan(0);
    expect(sheet.toAnswer.every((check) => check.verdict !== "met")).toBe(true);
  });
});
