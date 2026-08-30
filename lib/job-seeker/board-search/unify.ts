import type { BoardSearchHit } from "@/lib/job-seeker/board-search/types";

/**
 * Cross-board deduplication and result-level filters for the unified search.
 *
 * The same posting frequently exists on several boards. Identity here is the
 * conjunction a person would use: same company and same title, normalized
 * hard (case, punctuation, whitespace) — location deliberately excluded from
 * the key because boards state the same job's place differently ("Remote",
 * "Anywhere in the World", "EU only") far more often than two different jobs
 * share a company and an exact title. A collapsed group keeps every source
 * reference: nothing a board said is discarded, one card is shown.
 *
 * Filters run after normalization, on the unified set, because a board that
 * cannot express "salary at least X" upstream can still answer it here from
 * what its postings said. A filter never invents: a posting with no salary
 * text fails a salary-minimum filter only when `requireSalary` asked for
 * that; otherwise unknown is kept and labeled unknown by the UI.
 */

export type UnifiedSource = Readonly<{
  board: string;
  boardName: string;
  url: string | null;
  externalId: string | null;
  saveToken: string;
}>;

export type UnifiedHit = Readonly<{
  job: BoardSearchHit["job"];
  publishedOn: string | null;
  closesOn: string | null;
  sources: readonly UnifiedSource[];
  /**
   * Which entry of `sources` the card's `job` is the verbatim copy of. Save
   * tokens are sealed over one board's exact fields, so saving this card must
   * go through this source — a sibling source's token seals its own copy.
   */
  primarySourceIndex: number;
}>;

export function normalizeIdentity(company: string, title: string): string {
  const fold = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  return `${fold(company)}::${fold(title)}`;
}

type TaggedHit = Readonly<{
  board: string;
  boardName: string;
  hit: BoardSearchHit;
  saveToken: string;
}>;

export function dedupeAcrossBoards(tagged: readonly TaggedHit[]): UnifiedHit[] {
  const groups = new Map<
    string,
    { primary: TaggedHit; primaryIndex: number; sources: UnifiedSource[] }
  >();
  for (const entry of tagged) {
    const key = normalizeIdentity(entry.hit.job.company, entry.hit.job.title);
    const source: UnifiedSource = {
      board: entry.board,
      boardName: entry.boardName,
      url: entry.hit.job.url,
      externalId: entry.hit.job.externalId ?? null,
      saveToken: entry.saveToken,
    };
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { primary: entry, primaryIndex: 0, sources: [source] });
      continue;
    }
    existing.sources.push(source);
    // The richer record wins the card: prefer the copy that carries a salary,
    // then the one that carries a description. Sources accumulate either way.
    const current = existing.primary.hit.job;
    const candidate = entry.hit.job;
    const richer =
      (candidate.salaryText !== null && current.salaryText === null) ||
      (candidate.salaryText === current.salaryText &&
        candidate.description !== null &&
        current.description === null);
    if (richer) {
      existing.primary = entry;
      existing.primaryIndex = existing.sources.length - 1;
    }
  }
  return [...groups.values()].map(({ primary, primaryIndex, sources }) => ({
    job: primary.hit.job,
    publishedOn: primary.hit.publishedOn,
    closesOn: primary.hit.closesOn,
    sources,
    primarySourceIndex: primaryIndex,
  }));
}

/**
 * Seniority derived from the job title, and only from the job title.
 *
 * The connected boards do not expose seniority as structured data, so the
 * only honest source is what the employer wrote in the title: "Senior
 * Marketing Manager" states manager, "Junior Designer" states entry. A title
 * that states nothing derives null — the derivation never guesses a level
 * from salary, description length, or anything else, and the UI labels the
 * filter as title-derived so nobody mistakes it for employer-declared data.
 *
 * When several levels appear in one title the most senior one wins, because
 * that is how titles compose: a "Senior Engineering Manager" is a manager,
 * a "Lead Senior Engineer" is a lead. "Lead generation" is the marketing
 * discipline, not a level, and is excluded by name.
 */
export const SENIORITY_LEVELS = [
  "intern",
  "entry",
  "senior",
  "lead",
  "manager",
  "director",
  "executive",
] as const;

export type DerivedSeniority = (typeof SENIORITY_LEVELS)[number];

const SENIORITY_PATTERNS: readonly (readonly [DerivedSeniority, RegExp])[] = [
  ["executive", /\b(?:vp|svp|evp|avp|vice president|chief|ceo|cto|cmo|coo|cfo|cpo|cro|cdo|president)\b/],
  ["director", /\b(?:director|head of)\b/],
  ["manager", /\b(?:manager|mgr)\b/],
  ["lead", /\b(?:lead(?!\s*gen)|staff|principal)\b/],
  ["senior", /\b(?:senior|sr)\b/],
  ["entry", /\b(?:junior|jr|entry[\s-]?level|graduate|trainee|apprentice)\b/],
  ["intern", /\b(?:intern|internship)\b/],
];

export function deriveSeniority(title: string): DerivedSeniority | null {
  const folded = title.toLowerCase().replace(/[._/|]+/g, " ");
  for (const [level, pattern] of SENIORITY_PATTERNS) {
    if (pattern.test(folded)) return level;
  }
  return null;
}

/**
 * Marketing specialty derived from the job title, and only from the title.
 *
 * Specialties announce themselves in titles — "SEO Manager", "Paid Media
 * Specialist", "Content Marketing Lead" — which is why the title is the one
 * honest source: a description that merely lists "familiarity with SEO"
 * describes a skill wish, not the role's discipline. A title that names no
 * specialty derives null and the filter's "Any" keeps it. First listed
 * match wins; the patterns are ordered so multi-word disciplines are read
 * before their generic containing words.
 */
export const MARKETING_SPECIALTIES = [
  "seo",
  "content",
  "paid_media",
  "social",
  "email",
  "brand",
  "product_marketing",
  "growth",
  "pr_comms",
  "events",
  "analytics_ops",
  "influencer_affiliate",
] as const;

export type DerivedSpecialty = (typeof MARKETING_SPECIALTIES)[number];

const SPECIALTY_PATTERNS: readonly (readonly [DerivedSpecialty, RegExp])[] = [
  ["seo", /\b(?:seo|search engine optimi[sz]ation)\b/],
  ["paid_media", /\b(?:ppc|sem|paid (?:media|search|social|acquisition)|performance marketing|media buy(?:er|ing)|google ads)\b/],
  ["product_marketing", /\bproduct marketing\b/],
  ["growth", /\b(?:growth (?:marketing|marketer|hacker|lead|manager)|demand gen(?:eration)?|lead gen(?:eration)?)\b/],
  ["email", /\b(?:email marketing|crm marketing|lifecycle marketing|marketing automation)\b/],
  ["social", /\bsocial media\b/],
  ["content", /\b(?:content (?:marketing|strategist|strategy|marketer)|copywrit(?:er|ing)|editorial)\b/],
  ["brand", /\bbrand(?:ing)?\b/],
  ["pr_comms", /\b(?:public relations|communications?|press relations)\b/],
  ["events", /\b(?:event marketing|events? (?:manager|coordinator|specialist)|field marketing)\b/],
  ["analytics_ops", /\b(?:marketing (?:analytics|operations|ops)|martech)\b/],
  ["influencer_affiliate", /\b(?:influencer|affiliate)\b/],
];

export function deriveSpecialty(title: string): DerivedSpecialty | null {
  const folded = title.toLowerCase().replace(/[._/|]+/g, " ");
  for (const [specialty, pattern] of SPECIALTY_PATTERNS) {
    if (pattern.test(folded)) return specialty;
  }
  return null;
}

/**
 * Employer industry derived from the posting's own text (title + company +
 * description). Boards expose no industry field, and a company-name lookup
 * would need a directory this repository does not have — so the derivation
 * reads only what the posting says, counts distinct keyword families per
 * industry, and picks the industry with the most evidence (declaration
 * order breaks the rare tie deterministically). A posting matching no
 * family derives null and the filter's "Any" keeps it, unstated.
 */
export const INDUSTRIES = [
  "technology",
  "healthcare",
  "finance",
  "retail_ecommerce",
  "media_entertainment",
  "education",
  "travel_hospitality",
  "manufacturing_industrial",
  "energy",
  "government_nonprofit",
  "agency_consulting",
] as const;

export type DerivedIndustry = (typeof INDUSTRIES)[number];

const INDUSTRY_PATTERNS: readonly (readonly [DerivedIndustry, readonly RegExp[]])[] = [
  ["technology", [/\b(?:saas|software (?:company|platform|product)|cloud (?:platform|infrastructure)|cybersecurity|developer tools?)\b/, /\b(?:tech company|technology company|startup)\b/]],
  ["healthcare", [/\b(?:healthcare|health care|hospital|clinical|medical|patients?)\b/, /\b(?:pharma(?:ceutical)?|biotech|life sciences)\b/]],
  ["finance", [/\b(?:bank|banking|fintech|financial services|insurance|insurtech)\b/, /\b(?:investment|trading|wealth management|payments)\b/]],
  ["retail_ecommerce", [/\b(?:e-?commerce|retail|retailer|marketplace)\b/, /\b(?:consumer goods|cpg|d2c|dtc brand)\b/]],
  ["media_entertainment", [/\b(?:media company|publishing|publisher|newsroom|entertainment)\b/, /\b(?:gaming|game studio|streaming)\b/]],
  ["education", [/\b(?:education|edtech|university|school district|schools)\b/, /\b(?:e-?learning|learning platform)\b/]],
  ["travel_hospitality", [/\b(?:travel|tourism|airline|hospitality)\b/, /\b(?:hotel|hotels|resort)\b/]],
  ["manufacturing_industrial", [/\b(?:manufacturing|manufacturer|industrial|automotive|aerospace)\b/, /\b(?:logistics|supply chain|warehouse)\b/]],
  ["energy", [/\b(?:energy|renewables?|solar|wind power|utilities)\b/, /\b(?:oil and gas|oil & gas)\b/]],
  ["government_nonprofit", [/\b(?:government|public sector|federal|municipal)\b/, /\b(?:non-?profit|ngo|charity|foundation)\b/]],
  ["agency_consulting", [/\b(?:agency|consultancy|consulting firm)\b/, /\b(?:clients?' campaigns|client accounts)\b/]],
];

export function deriveIndustry(text: string): DerivedIndustry | null {
  const folded = text.toLowerCase();
  let best: DerivedIndustry | null = null;
  let bestScore = 0;
  for (const [industry, families] of INDUSTRY_PATTERNS) {
    const score = families.reduce((sum, family) => sum + (family.test(folded) ? 1 : 0), 0);
    if (score > bestScore) {
      best = industry;
      bestScore = score;
    }
  }
  return best;
}

export type UnifiedFilters = Readonly<{
  /** Every word must appear (AND) or any word may appear (OR). */
  keywordMode: "and" | "or";
  /** Applied to title+company+description; [] means no keyword filter. */
  keywords: readonly string[];
  /** A hit containing any of these anywhere is dropped. */
  excludeKeywords: readonly string[];
  /** Company names to drop, matched case-insensitively as substrings. */
  excludeCompanies: readonly string[];
  workModel: "remote" | "hybrid" | "onsite" | null;
  /**
   * Keep only hits whose title states this seniority (see deriveSeniority).
   * Titles that state no level are dropped when this is set: the filter means
   * "the title says senior", and a silent maybe kept in the list would make
   * the filter mean nothing.
   */
  seniority: DerivedSeniority | null;
  /** Keep only hits whose title names this marketing specialty (deriveSpecialty). */
  specialty: DerivedSpecialty | null;
  /** Keep only hits whose posting text evidences this industry (deriveIndustry). */
  industry: DerivedIndustry | null;
  /** Keep only hits whose salary text contains a number ≥ this (thousands tolerated). */
  salaryMinimum: number | null;
  /** Drop hits with no salary text at all. */
  requireSalary: boolean;
  /** Keep only hits published within this many days; null keeps undated hits. */
  postedWithinDays: number | null;
}>;

export const EMPTY_FILTERS: UnifiedFilters = Object.freeze({
  keywordMode: "and",
  keywords: [],
  excludeKeywords: [],
  excludeCompanies: [],
  workModel: null,
  seniority: null,
  specialty: null,
  industry: null,
  salaryMinimum: null,
  requireSalary: false,
  postedWithinDays: null,
});

/**
 * The largest money-like number in a salary text, normalized for "120k".
 * "USD 90,000–120,000" → 120000; "60–70 hourly" → 70 (a person filtering by
 * annual salary will still see hourly rows as unknown unless requireSalary
 * is set, because 70 < any annual minimum — the honest failure direction).
 */
export function salaryCeiling(salaryText: string | null): number | null {
  if (salaryText === null) return null;
  const matches = [...salaryText.matchAll(/(\d[\d,.]*)\s*(k)?/gi)];
  let best: number | null = null;
  for (const match of matches) {
    const raw = Number(match[1].replace(/[,.](?=\d{3}\b)/g, "").replace(/,/g, "."));
    if (!Number.isFinite(raw)) continue;
    const value = match[2] ? raw * 1000 : raw;
    if (best === null || value > best) best = value;
  }
  return best;
}

export function applyUnifiedFilters<T extends UnifiedHit>(
  hits: readonly T[],
  filters: UnifiedFilters,
  now: Date = new Date(),
): T[] {
  const contains = (haystack: string, needle: string) =>
    haystack.includes(needle.toLowerCase());
  return hits.filter((hit) => {
    const haystack = [hit.job.title, hit.job.company, hit.job.description ?? "", hit.job.location ?? ""]
      .join(" ")
      .toLowerCase();

    if (filters.keywords.length > 0) {
      const check = (word: string) => contains(haystack, word);
      const passes = filters.keywordMode === "and"
        ? filters.keywords.every(check)
        : filters.keywords.some(check);
      if (!passes) return false;
    }
    if (filters.excludeKeywords.some((word) => contains(haystack, word))) return false;
    if (filters.excludeCompanies.some((name) => contains(hit.job.company.toLowerCase(), name))) {
      return false;
    }
    if (filters.workModel !== null && hit.job.workModel !== filters.workModel) return false;
    if (filters.seniority !== null && deriveSeniority(hit.job.title) !== filters.seniority) {
      return false;
    }
    if (filters.specialty !== null && deriveSpecialty(hit.job.title) !== filters.specialty) {
      return false;
    }
    if (
      filters.industry !== null &&
      deriveIndustry(
        `${hit.job.title} ${hit.job.company} ${hit.job.description ?? ""}`,
      ) !== filters.industry
    ) {
      return false;
    }

    const ceiling = salaryCeiling(hit.job.salaryText);
    if (filters.requireSalary && ceiling === null) return false;
    if (filters.salaryMinimum !== null && ceiling !== null && ceiling < filters.salaryMinimum) {
      return false;
    }

    if (filters.postedWithinDays !== null && hit.publishedOn !== null) {
      const age = (now.getTime() - new Date(hit.publishedOn).getTime()) / 86_400_000;
      if (age > filters.postedWithinDays) return false;
    }
    return true;
  });
}
