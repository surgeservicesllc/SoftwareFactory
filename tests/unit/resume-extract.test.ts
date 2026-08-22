// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  RESUME_SYSTEM_PROMPT,
  dropInvalidFields,
  extractByPattern,
  mergeProposals,
  parseModelProposal,
  proposalSchema,
  proposedFieldCount,
} from "@/lib/job-seeker/resume-extract";
import { extractResumeText } from "@/lib/job-seeker/resume-text";

const fixtures = resolve(import.meta.dirname, "../fixtures/job-seeker");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function textOf(name: string, type: string): Promise<string> {
  const result = await extractResumeText(readFileSync(resolve(fixtures, name)), type);
  if (!result.ok) throw new Error(`fixture ${name} did not extract: ${result.message}`);
  return result.text;
}

describe("the pattern pass, on text from a real DOCX", () => {
  it("finds the contact details a person would have typed by hand", async () => {
    const { proposal, sources } = extractByPattern(await textOf("resume.docx", DOCX));

    expect(proposal.fullName).toBe("Dana Okafor");
    expect(proposal.email).toBe("dana.okafor@example.com");
    expect(proposal.phone).toContain("415");
    expect(proposal.linkedinUrl).toBe("https://www.linkedin.com/in/danaokafor");
    expect(proposal.location).toBe("Oakland, CA");
    expect(sources.email).toBe("pattern");
  });

  it("reads the summary and the skills list", async () => {
    const { proposal } = extractByPattern(await textOf("resume.docx", DOCX));
    expect(proposal.summary).toContain("11 years");
    expect(proposal.skills).toEqual(
      expect.arrayContaining(["Go", "TypeScript", "PostgreSQL", "Terraform"]),
    );
  });

  it("separates employment from education, with dates", async () => {
    const { proposal } = extractByPattern(await textOf("resume.docx", DOCX));

    expect(proposal.employmentHistory?.[0]).toMatchObject({
      organization: "Northwind Systems",
      title: "Staff Platform Engineer",
      started: "2021",
      ended: "Present",
    });
    expect(proposal.employmentHistory?.[0].highlights?.[0]).toContain("63%");
    expect(proposal.education?.[0]).toMatchObject({
      organization: "University of Michigan",
      title: "B.S. Computer Science",
    });
  });

  it("works the same on the PDF, which is a different reader entirely", async () => {
    const { proposal } = extractByPattern(await textOf("resume.pdf", "application/pdf"));
    expect(proposal.email).toBe("dana.okafor@example.com");
    expect(proposal.fullName).toBe("Dana Okafor");
    expect(proposedFieldCount(proposal)).toBeGreaterThanOrEqual(5);
  });
});

describe("the pattern pass, on the shapes that mislead a looser one", () => {
  it("does not read a year range as a phone number", () => {
    const { proposal } = extractByPattern("Priya Raman\nEXPERIENCE\nEngineer — Acme Inc (2017 - 2021)");
    expect(proposal.phone).toBeUndefined();
  });

  it("leaves a line it cannot confidently split alone rather than guessing", () => {
    /*
     * "Senior Engineer at three startups" names no employer. A parser that
     * emitted an entry here would put a plausible-looking fiction into
     * someone's career history, which is the one error a person skimming a
     * review screen is least likely to catch.
     */
    const { proposal } = extractByPattern("EXPERIENCE\nSenior Engineer at three startups\n2015 - 2020");
    expect(proposal.employmentHistory).toBeUndefined();
  });

  it("proposes nothing at all for a document with no recognisable content", () => {
    const { proposal } = extractByPattern("lorem ipsum dolor sit amet consectetur");
    expect(proposedFieldCount(proposal)).toBe(0);
  });

  it("keeps a field whose neighbour is malformed", () => {
    // All-or-nothing parsing would lose a valid email over one bad entry.
    const kept = dropInvalidFields({
      email: "sam@example.com",
      employmentHistory: [{ organization: "", title: "Engineer" }],
      linkedinUrl: "http://linkedin.com/in/sam",
    });
    expect(kept.email).toBe("sam@example.com");
    expect(kept.employmentHistory).toBeUndefined();
    // http:// is refused by the profile's own CHECK, so it is refused here.
    expect(kept.linkedinUrl).toBeUndefined();
  });
});

describe("what the pattern pass proposes", () => {
  it("always satisfies the constraints the database will apply", async () => {
    // The point of the schema: a suggestion shown to a person is one the
    // profile row will accept. Anything else is an apply that fails on a CHECK
    // after they have already clicked accept.
    const { proposal } = extractByPattern(await textOf("resume.docx", DOCX));
    expect(() => proposalSchema.parse(proposal)).not.toThrow();
  });

  it("never proposes an empty value over an existing one", () => {
    const { proposal } = extractByPattern("EXPERIENCE\n");
    for (const value of Object.values(proposal)) {
      if (typeof value === "string") expect(value.trim().length).toBeGreaterThan(0);
      if (Array.isArray(value)) expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe("reading the model's answer", () => {
  it("accepts a bare JSON object", () => {
    const parsed = parseModelProposal('{"fullName":"Ada Lovelace","skills":["Analysis"]}');
    expect(parsed).toEqual({ fullName: "Ada Lovelace", skills: ["Analysis"] });
  });

  it("accepts JSON wrapped in a code fence or prose, because models do that", () => {
    const parsed = parseModelProposal('Here you go:\n```json\n{"email":"ada@example.com"}\n```\nHope that helps!');
    expect(parsed).toEqual({ email: "ada@example.com" });
  });

  it("drops an unknown key instead of failing the whole object", () => {
    const parsed = parseModelProposal('{"email":"ada@example.com","yearsOfExperience":12}');
    expect(parsed).toEqual({ email: "ada@example.com" });
  });

  it("drops a field that would violate the profile's constraints", () => {
    const parsed = parseModelProposal(
      JSON.stringify({ email: "ada@example.com", fullName: "x".repeat(500), linkedinUrl: "notaurl" }),
    );
    expect(parsed).toEqual({ email: "ada@example.com" });
  });

  it("returns null when there is no JSON to find", () => {
    expect(parseModelProposal("I could not read that resume.")).toBeNull();
    expect(parseModelProposal("")).toBeNull();
  });

  it("is instructed to omit rather than guess", () => {
    // The prompt is the only place this rule is stated to the model, so it is
    // worth a test that notices if someone softens it.
    expect(RESUME_SYSTEM_PROMPT).toContain("never invent");
    expect(RESUME_SYSTEM_PROMPT).toContain("omit that field");
  });
});

describe("merging the two passes", () => {
  it("lets the model win a field it filled, and records that it did", () => {
    const pattern = extractByPattern("Dana Okafor\ndana@example.com");
    const merged = mergeProposals(pattern, { fullName: "Dana Okafor-Smith" });

    expect(merged.proposal.fullName).toBe("Dana Okafor-Smith");
    expect(merged.sources.fullName).toBe("model");
    // And the field the model said nothing about is untouched.
    expect(merged.proposal.email).toBe("dana@example.com");
    expect(merged.sources.email).toBe("pattern");
  });

  it("never lets the model erase a field by returning it empty", () => {
    const pattern = extractByPattern("Dana Okafor\ndana@example.com");
    const merged = mergeProposals(pattern, { skills: [], fullName: "   " } as never);

    expect(merged.proposal.fullName).toBe("Dana Okafor");
    expect(merged.proposal.skills).toBeUndefined();
  });

  it("can only ever add to what the pattern pass found", () => {
    const pattern = extractByPattern("Dana Okafor\ndana@example.com");
    const merged = mergeProposals(pattern, { technologies: ["Kubernetes"] });
    expect(proposedFieldCount(merged.proposal)).toBeGreaterThan(proposedFieldCount(pattern.proposal));
  });
});
