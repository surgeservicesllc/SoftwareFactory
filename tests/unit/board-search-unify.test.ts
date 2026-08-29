// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS,
  applyUnifiedFilters,
  dedupeAcrossBoards,
  deriveSeniority,
  normalizeIdentity,
  salaryCeiling,
  type UnifiedHit,
} from "@/lib/job-seeker/board-search/unify";
import type { BoardSearchHit } from "@/lib/job-seeker/board-search/types";

function hit(overrides: Partial<BoardSearchHit["job"]> & { publishedOn?: string | null }): BoardSearchHit {
  const { publishedOn = null, ...job } = overrides;
  return {
    job: {
      externalId: "x-1",
      url: "https://example.com/job",
      title: "Growth Marketer",
      company: "Acme",
      salaryText: null,
      location: null,
      workModel: null,
      description: null,
      ...job,
    },
    publishedOn,
    closesOn: null,
  };
}

function tagged(board: string, h: BoardSearchHit, saveToken = `token-${board}`) {
  return { board, boardName: board.toUpperCase(), hit: h, saveToken };
}

function unified(overrides: Partial<BoardSearchHit["job"]> & { publishedOn?: string | null }): UnifiedHit {
  const h = hit(overrides);
  return { job: h.job, publishedOn: h.publishedOn, closesOn: h.closesOn, sources: [], primarySourceIndex: 0 };
}

describe("normalizeIdentity", () => {
  it("folds case, punctuation, and spacing so boards' phrasings collide", () => {
    expect(normalizeIdentity("Acme, Inc.", "Senior  Engineer ")).toBe(
      normalizeIdentity("ACME Inc", "senior engineer"),
    );
  });

  it("folds diacritics, because boards disagree on them for the same employer", () => {
    expect(normalizeIdentity("Café Média", "Rédacteur")).toBe("cafe media::redacteur");
  });

  it("keeps genuinely different jobs apart", () => {
    expect(normalizeIdentity("Acme", "Engineer")).not.toBe(normalizeIdentity("Acme", "Engineer II"));
    expect(normalizeIdentity("Acme", "Engineer")).not.toBe(normalizeIdentity("Acmex", "Engineer"));
  });
});

describe("dedupeAcrossBoards", () => {
  it("collapses the same company+title into one card that keeps every source", () => {
    const result = dedupeAcrossBoards([
      tagged("remotive", hit({ externalId: "r-1", url: "https://remotive.com/1" })),
      tagged("remoteok", hit({ externalId: "ok-1", url: "https://remoteok.com/1" })),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].sources.map((s) => s.board)).toEqual(["remotive", "remoteok"]);
    // Each source keeps its own save token — saving from either board must
    // still attribute the row to the board it actually came from.
    expect(result[0].sources.map((s) => s.saveToken)).toEqual(["token-remotive", "token-remoteok"]);
  });

  it("lets the copy that carries a salary win the card", () => {
    const result = dedupeAcrossBoards([
      tagged("remotive", hit({ salaryText: null, description: "long text" })),
      tagged("jobicy", hit({ salaryText: "USD 90000–120000" })),
    ]);
    expect(result[0].job.salaryText).toBe("USD 90000–120000");
    expect(result[0].sources).toHaveLength(2);
    // …and the card names which source's copy it is, because that source's
    // token is the only one sealed over these exact fields.
    expect(result[0].primarySourceIndex).toBe(1);
    expect(result[0].sources[result[0].primarySourceIndex].board).toBe("jobicy");
  });

  it("breaks a salary tie by preferring the copy with a description", () => {
    const result = dedupeAcrossBoards([
      tagged("wwr", hit({ description: null })),
      tagged("himalayas", hit({ description: "Full description." })),
    ]);
    expect(result[0].job.description).toBe("Full description.");
  });

  it("does not merge across locations' phrasing but does keep distinct jobs distinct", () => {
    const result = dedupeAcrossBoards([
      tagged("remotive", hit({ location: "Anywhere in the World" })),
      tagged("wwr", hit({ location: "EU Only" })),
      tagged("wwr", hit({ title: "Head of Growth" }), "token-other"),
    ]);
    // Same company+title merges despite different location phrasing…
    // …while a different title stays its own card.
    expect(result).toHaveLength(2);
    expect(result[0].sources).toHaveLength(2);
  });
});

describe("salaryCeiling", () => {
  it("reads shorthand, separators, and ranges the way a person would", () => {
    expect(salaryCeiling("120k")).toBe(120_000);
    expect(salaryCeiling("$90,000 - $120,000")).toBe(120_000);
    expect(salaryCeiling("USD 60–70 hourly")).toBe(70);
    expect(salaryCeiling("USD 175000–230000")).toBe(230_000);
  });

  it("says nothing when the text says nothing numeric", () => {
    expect(salaryCeiling(null)).toBeNull();
    expect(salaryCeiling("Competitive")).toBeNull();
  });
});

describe("applyUnifiedFilters", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  const hits: UnifiedHit[] = [
    unified({
      title: "Growth Marketing Manager",
      company: "Contra",
      salaryText: "$110,000 - $140,000",
      workModel: "remote",
      publishedOn: "2026-08-27",
      description: "Own paid acquisition.",
    }),
    unified({
      title: "Content Strategist",
      company: "Wordsmith Co",
      salaryText: null,
      workModel: null,
      publishedOn: null,
    }),
    unified({
      title: "Senior Accountant",
      company: "Zahlen AG",
      salaryText: "EUR 55,000",
      workModel: "onsite",
      publishedOn: "2026-07-01",
      location: "Munich",
    }),
  ];

  it("passes everything through empty filters", () => {
    expect(applyUnifiedFilters(hits, EMPTY_FILTERS, now)).toHaveLength(3);
  });

  it("requires every keyword in AND mode and any keyword in OR mode", () => {
    const and = applyUnifiedFilters(
      hits,
      { ...EMPTY_FILTERS, keywords: ["marketing", "acquisition"], keywordMode: "and" },
      now,
    );
    expect(and.map((h) => h.job.company)).toEqual(["Contra"]);

    const or = applyUnifiedFilters(
      hits,
      { ...EMPTY_FILTERS, keywords: ["marketing", "content"], keywordMode: "or" },
      now,
    );
    expect(or.map((h) => h.job.company)).toEqual(["Contra", "Wordsmith Co"]);
  });

  it("drops hits carrying an excluded keyword or an excluded company", () => {
    const noAccounting = applyUnifiedFilters(
      hits,
      { ...EMPTY_FILTERS, excludeKeywords: ["accountant"] },
      now,
    );
    expect(noAccounting.some((h) => h.job.company === "Zahlen AG")).toBe(false);

    const noContra = applyUnifiedFilters(hits, { ...EMPTY_FILTERS, excludeCompanies: ["contra"] }, now);
    expect(noContra.some((h) => h.job.company === "Contra")).toBe(false);
  });

  it("keeps unknown-salary hits under a salary minimum unless salary is required", () => {
    const min = applyUnifiedFilters(hits, { ...EMPTY_FILTERS, salaryMinimum: 100_000 }, now);
    // Contra passes (140000 ≥ 100000); Wordsmith is unknown, so it stays and
    // the UI labels it unknown; Zahlen stated 55000, which fails honestly.
    expect(min.map((h) => h.job.company)).toEqual(["Contra", "Wordsmith Co"]);

    const strict = applyUnifiedFilters(
      hits,
      { ...EMPTY_FILTERS, salaryMinimum: 100_000, requireSalary: true },
      now,
    );
    expect(strict.map((h) => h.job.company)).toEqual(["Contra"]);
  });

  it("filters by work model without inventing one for unlabeled hits", () => {
    const remote = applyUnifiedFilters(hits, { ...EMPTY_FILTERS, workModel: "remote" }, now);
    expect(remote.map((h) => h.job.company)).toEqual(["Contra"]);
  });

  it("drops stale hits by posted date but keeps undated ones", () => {
    const recent = applyUnifiedFilters(hits, { ...EMPTY_FILTERS, postedWithinDays: 7 }, now);
    // 2026-07-01 is out; the undated Wordsmith posting stays — absence of a
    // date is not evidence of staleness.
    expect(recent.map((h) => h.job.company)).toEqual(["Contra", "Wordsmith Co"]);
  });

  it("keeps only titles that state the requested seniority — no level is invented", () => {
    const managers = applyUnifiedFilters(hits, { ...EMPTY_FILTERS, seniority: "manager" }, now);
    expect(managers.map((h) => h.job.title)).toEqual(["Growth Marketing Manager"]);

    // "Content Strategist" states no level; while the filter is set it is
    // dropped, because "the title says senior" is what the filter means.
    const seniors = applyUnifiedFilters(hits, { ...EMPTY_FILTERS, seniority: "senior" }, now);
    expect(seniors.map((h) => h.job.title)).toEqual(["Senior Accountant"]);
  });
});

describe("deriveSeniority", () => {
  it("reads the level the title states", () => {
    expect(deriveSeniority("Senior Marketing Manager")).toBe("manager");
    expect(deriveSeniority("Sr. Backend Engineer")).toBe("senior");
    expect(deriveSeniority("Junior Designer")).toBe("entry");
    expect(deriveSeniority("Entry-Level Analyst")).toBe("entry");
    expect(deriveSeniority("Marketing Intern")).toBe("intern");
    expect(deriveSeniority("Staff Software Engineer")).toBe("lead");
    expect(deriveSeniority("Tech Lead, Platform")).toBe("lead");
    expect(deriveSeniority("Head of Growth")).toBe("director");
    expect(deriveSeniority("Director of Communications")).toBe("director");
    expect(deriveSeniority("VP Marketing")).toBe("executive");
    expect(deriveSeniority("Chief Marketing Officer")).toBe("executive");
  });

  it("says nothing when the title states nothing", () => {
    expect(deriveSeniority("Content Strategist")).toBeNull();
    expect(deriveSeniority("Software Engineer")).toBeNull();
    // "internal" is not "intern", and international is neither.
    expect(deriveSeniority("Internal Communications Specialist")).toBeNull();
    expect(deriveSeniority("International Sales Representative")).toBeNull();
  });

  it("treats lead generation as the marketing discipline, not the level", () => {
    expect(deriveSeniority("Lead Generation Specialist")).toBeNull();
    expect(deriveSeniority("Lead Gen Marketer")).toBeNull();
    // …while an actual lead with the word elsewhere still counts.
    expect(deriveSeniority("Demand Generation Lead")).toBe("lead");
  });

  it("lets the most senior stated level win a composed title", () => {
    expect(deriveSeniority("Senior Engineering Manager")).toBe("manager");
    expect(deriveSeniority("Lead Senior Engineer")).toBe("lead");
    expect(deriveSeniority("Senior Vice President, Product")).toBe("executive");
  });
});
