// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  composeAlertEmail,
  planAlertCandidates,
  toDeliveryRows,
  toUnifiedFilters,
} from "@/lib/job-seeker/alerts";
import type { EvaluationInputs } from "@/lib/job-seeker/record";

/**
 * The alert engine's decisions, held without any I/O: which jobs interrupt a
 * person, and what the interruption says. The never-repeat rule and the
 * no-profile-no-scores rule are the two that must not rot — one protects
 * attention, the other honesty.
 */

const boardNames = new Map([["remotive", "Remotive"]]);

function tagged(url: string | null, overrides: Partial<{
  title: string; company: string; salaryText: string | null; description: string | null;
  publishedOn: string | null;
}> = {}) {
  return {
    board: "remotive",
    boardName: "Remotive",
    hit: {
      job: {
        externalId: url ?? "no-url",
        url,
        title: overrides.title ?? "Growth Marketing Manager",
        company: overrides.company ?? "Contra",
        salaryText: overrides.salaryText ?? null,
        location: "USA",
        workModel: "remote" as const,
        description: overrides.description ?? "Own paid acquisition end to end.",
      },
      publishedOn: overrides.publishedOn ?? "2026-08-29",
      closesOn: null,
    },
    saveToken: "",
  };
}

const evaluation: EvaluationInputs = {
  profileRecorded: true,
  profile: {
    skills: ["paid acquisition"],
    technologies: [],
    industries: [],
    employmentTitles: ["Growth Marketing Manager"],
    hasLeadershipEvidence: true,
    salaryTarget: null,
    location: "USA",
    workArrangement: "remote",
    openToRelocation: false,
  },
  preferences: {
    targetTitles: [],
    compensationMinimum: null,
    locations: ["USA"],
    workArrangements: ["remote"],
    industries: [],
    exclusions: [],
    qualificationThreshold: 80,
  },
};

describe("planAlertCandidates", () => {
  it("never re-offers a job already delivered for this search", () => {
    const url = "https://remotive.com/remote-jobs/1";
    const candidates = planAlertCandidates({
      query: { text: "marketing" },
      tagged: [tagged(url)],
      boardNames,
      deliveredUrls: new Set([url]),
      evaluation,
    });
    expect(candidates).toEqual([]);
  });

  it("skips a job it cannot link to, because the email promises a direct link", () => {
    const candidates = planAlertCandidates({
      query: { text: "marketing" },
      tagged: [tagged(null)],
      boardNames,
      deliveredUrls: new Set(),
      evaluation,
    });
    expect(candidates).toEqual([]);
  });

  it("scores from the recorded profile and carries the evidence into the candidate", () => {
    const [candidate] = planAlertCandidates({
      query: { text: "marketing" },
      tagged: [tagged("https://remotive.com/remote-jobs/1")],
      boardNames,
      deliveredUrls: new Set(),
      evaluation,
    });
    expect(candidate.matchScore).toBeGreaterThan(0);
    expect(candidate.matchReasons.length).toBeGreaterThan(0);
    expect(candidate.boardName).toBe("Remotive");
  });

  it("honors the saved minimum score, and without a profile nothing can clear it", () => {
    const query = { text: "marketing", filters: { minimumScore: 10 } };
    const scored = planAlertCandidates({
      query,
      tagged: [tagged("https://remotive.com/remote-jobs/1")],
      boardNames,
      deliveredUrls: new Set(),
      evaluation,
    });
    expect(scored).toHaveLength(1);

    const unscored = planAlertCandidates({
      query,
      tagged: [tagged("https://remotive.com/remote-jobs/1")],
      boardNames,
      deliveredUrls: new Set(),
      evaluation: null,
    });
    expect(unscored).toEqual([]);
  });

  it("applies the saved search's own filters before anything is offered", () => {
    const candidates = planAlertCandidates({
      query: { text: "marketing", filters: { excludeCompanies: ["contra"] } },
      tagged: [tagged("https://remotive.com/remote-jobs/1")],
      boardNames,
      deliveredUrls: new Set(),
      evaluation,
    });
    expect(candidates).toEqual([]);
  });

  it("drops a job the person's own exclusions veto", () => {
    const vetoing: EvaluationInputs = {
      ...evaluation,
      preferences: { ...evaluation.preferences, exclusions: ["acquisition"] },
    };
    const candidates = planAlertCandidates({
      query: { text: "marketing" },
      tagged: [tagged("https://remotive.com/remote-jobs/1")],
      boardNames,
      deliveredUrls: new Set(),
      evaluation: vetoing,
    });
    expect(candidates).toEqual([]);
  });
});

describe("composeAlertEmail", () => {
  it("names every fact the goal promises, and the never-repeat rule", () => {
    const { subject, text } = composeAlertEmail({
      searchName: "Remote marketing",
      candidates: [{
        jobUrl: "https://remotive.com/remote-jobs/1",
        jobTitle: "Growth Marketing Manager",
        jobCompany: "Contra",
        board: "remotive",
        boardName: "Remotive",
        location: "USA",
        salaryText: "$110,000 - $140,000",
        publishedOn: "2026-08-29",
        matchScore: 85,
        matchReasons: ["The role's title aligns with your recorded \"Growth Marketing Manager\"."],
      }],
      siteUrl: "https://www.theagoras.com",
    });
    expect(subject).toContain("Remote marketing");
    expect(text).toContain("Contra — Growth Marketing Manager");
    expect(text).toContain("USA");
    expect(text).toContain("$110,000 - $140,000");
    expect(text).toContain("posted 2026-08-29");
    expect(text).toContain("match score 85/100");
    expect(text).toContain("via Remotive");
    expect(text).toContain("Apply: https://remotive.com/remote-jobs/1");
    expect(text).toContain("never sent again");
  });

  it("says nothing about facts a posting did not state", () => {
    const { text } = composeAlertEmail({
      searchName: "Anything",
      candidates: [{
        jobUrl: "https://example.org/1",
        jobTitle: "Role",
        jobCompany: "Acme",
        board: "remotive",
        boardName: "Remotive",
        location: null,
        salaryText: null,
        publishedOn: null,
        matchScore: null,
        matchReasons: [],
      }],
      siteUrl: "https://www.theagoras.com",
    });
    expect(text).not.toContain("match score");
    expect(text).not.toContain("posted ");
    expect(text).not.toContain("null");
  });
});

describe("toDeliveryRows and toUnifiedFilters", () => {
  it("stamps every row with what actually happened to the email", () => {
    const rows = toDeliveryRows([
      {
        jobUrl: "https://example.org/1",
        jobTitle: "Role",
        jobCompany: "Acme",
        board: "remotive",
        boardName: "Remotive",
        location: null,
        salaryText: null,
        publishedOn: null,
        matchScore: 42,
        matchReasons: [],
      },
    ], "failed");
    expect(rows[0]).toMatchObject({ jobUrl: "https://example.org/1", matchScore: 42, emailStatus: "failed" });
  });

  it("reads a stored query's filters with the same defaults the page uses", () => {
    const filters = toUnifiedFilters({ text: "x" });
    expect(filters.keywordMode).toBe("and");
    expect(filters.requireSalary).toBe(false);
    expect(filters.workModel).toBeNull();
    // Queries saved before the seniority filter existed parse to "any".
    expect(filters.seniority).toBeNull();
  });

  it("carries a stored seniority filter into the alert scan unchanged", () => {
    const filters = toUnifiedFilters({ text: "x", filters: { seniority: "manager" } });
    expect(filters.seniority).toBe("manager");
  });
});
