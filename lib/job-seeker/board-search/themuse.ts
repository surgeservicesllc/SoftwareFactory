import { fetchBoardJson, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * The Muse — the public jobs API at themuse.com/api/public/jobs.
 *
 * The API pages (20 per response) and filters by category or level, but
 * exposes no free-text search and no reliable recency ordering — a live
 * probe with `descending=true` still returned months-old listings first. So
 * this adapter reads the first few pages and filters locally, which means a
 * search term samples the board rather than searching its whole 400k-deep
 * corpus, and `totalAvailable` stays null under a term because the board
 * was never asked that question.
 * The public API is rate-limited per IP; the short cache keeps a day of
 * searching to a handful of upstream calls. Every hit links back to the
 * board's own landing page.
 */

const BASE_URL = "https://www.themuse.com/api/public/jobs";
const BOARD = "themuse";
const PAGES = 3;
const CACHE_TTL_MS = 30 * 60 * 1000;

type MuseJob = {
  id?: unknown;
  name?: unknown;
  company?: unknown;
  locations?: unknown;
  levels?: unknown;
  categories?: unknown;
  contents?: unknown;
  publication_date?: unknown;
  refs?: unknown;
};

type MuseEnvelope = {
  results?: unknown;
  total?: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      entry !== null && typeof entry === "object" && "name" in entry
        ? text((entry as { name?: unknown }).name)
        : null,
    )
    .filter((name): name is string => name !== null);
}

function companyName(job: MuseJob): string | null {
  if (job.company === null || typeof job.company !== "object") return null;
  return text((job.company as { name?: unknown }).name);
}

function landingPage(job: MuseJob): string | null {
  if (job.refs === null || typeof job.refs !== "object") return null;
  return text((job.refs as { landing_page?: unknown }).landing_page);
}

function jobMatches(job: MuseJob, term: string): boolean {
  if (term.length === 0) return true;
  const haystack = [
    text(job.name),
    companyName(job),
    ...names(job.categories),
    ...names(job.levels),
    ...names(job.locations),
  ]
    .filter((part): part is string => part !== null)
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}

export function toMuseHits(rows: readonly unknown[], term: string, limit: number): BoardSearchHit[] {
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const job = entry as MuseJob;
    const title = text(job.name);
    const company = companyName(job);
    const id = typeof job.id === "number" ? String(job.id) : text(job.id);
    if (title === null || company === null || id === null) continue;
    if (!jobMatches(job, term)) continue;
    const url = landingPage(job);
    const places = names(job.locations);
    hits.push({
      job: {
        externalId: id,
        url: url !== null && /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        // The Muse's public listing carries no salary field; absence is
        // recorded as absence.
        salaryText: null,
        location: places.length > 0 ? places.join(", ") : null,
        // The Muse lists on-site, hybrid and remote roles without a flag the
        // public API exposes, so no work arrangement is claimed.
        workModel: null,
        description: htmlToText(typeof job.contents === "string" ? job.contents : null),
      },
      publishedOn: isoDate(job.publication_date),
      closesOn: null,
    });
  }
  return hits;
}

type CacheEntry = { at: number; rows: readonly unknown[]; total: number | null };
let cached: CacheEntry | null = null;

export function clearMuseCache(): void {
  cached = null;
}

export const themuseAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "The Muse",
  summary: "A sample of the public API's listings, filtered locally; no upstream text search exists.",
  coverage: "US-centric roles across industries, on-site and remote.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const now = overrides?.now?.() ?? Date.now();
    if (cached === null || now - cached.at >= CACHE_TTL_MS) {
      const rows: unknown[] = [];
      let total: number | null = null;
      for (let page = 1; page <= PAGES; page += 1) {
        const envelope = await fetchBoardJson<MuseEnvelope>(
          `${BASE_URL}?page=${page}`,
          { board: BOARD, ...overrides },
        );
        if (Array.isArray(envelope.results)) rows.push(...envelope.results);
        if (typeof envelope.total === "number") total = envelope.total;
      }
      cached = { at: now, rows, total };
    }
    const term = query.text.trim().toLowerCase();
    const hits = toMuseHits(cached.rows, term, query.limit);
    // The board's total covers its whole corpus; with a term applied this
    // adapter only sampled recent pages, so the honest total is unknown.
    return {
      board: BOARD,
      hits,
      totalAvailable: term.length === 0 ? cached.total : null,
    };
  },
};
