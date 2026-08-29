import { fetchBoardJson, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * Working Nomads — the open JSON feed at workingnomads.com/api/exposed_jobs.
 *
 * The feed is the board's published integration surface: its latest curated
 * remote listings as a flat array, with no query parameter. The corpus is
 * fetched, cached briefly, and filtered locally, and every hit links to the
 * board's own job page.
 */

const BASE_URL = "https://www.workingnomads.com/api/exposed_jobs/";
const BOARD = "workingnomads";
const CACHE_TTL_MS = 30 * 60 * 1000;

type NomadJob = {
  url?: unknown;
  title?: unknown;
  description?: unknown;
  company_name?: unknown;
  category_name?: unknown;
  tags?: unknown;
  location?: unknown;
  pub_date?: unknown;
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

function jobMatches(job: NomadJob, term: string): boolean {
  if (term.length === 0) return true;
  const haystack = [text(job.title), text(job.company_name), text(job.category_name), text(job.tags)]
    .filter((part): part is string => part !== null)
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}

export function toWorkingNomadsHits(
  rows: readonly unknown[],
  term: string,
  limit: number,
): BoardSearchHit[] {
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const job = entry as NomadJob;
    const title = text(job.title);
    const company = text(job.company_name);
    const url = text(job.url);
    // The feed has no id field; the board's own job URL is the identity.
    if (title === null || company === null || url === null) continue;
    if (!jobMatches(job, term)) continue;
    hits.push({
      job: {
        externalId: url.slice(0, 200),
        url: /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        salaryText: null,
        location: text(job.location),
        // Every listing on Working Nomads is remote by the board's charter.
        workModel: "remote",
        description: htmlToText(typeof job.description === "string" ? job.description : null),
      },
      publishedOn: isoDate(job.pub_date),
      closesOn: null,
    });
  }
  return hits;
}

type CacheEntry = { at: number; rows: readonly unknown[] };
let cached: CacheEntry | null = null;

export function clearWorkingNomadsCache(): void {
  cached = null;
}

export const workingnomadsAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Working Nomads",
  summary: "The board's open JSON feed of curated remote listings, filtered locally.",
  coverage: "Curated remote roles worldwide across tech and beyond.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const now = overrides?.now?.() ?? Date.now();
    if (cached === null || now - cached.at >= CACHE_TTL_MS) {
      const rows = await fetchBoardJson<unknown[]>(BASE_URL, { board: BOARD, ...overrides });
      cached = { at: now, rows: Array.isArray(rows) ? rows : [] };
    }
    const term = query.text.trim().toLowerCase();
    const hits = toWorkingNomadsHits(cached.rows, term, query.limit);
    const matched = toWorkingNomadsHits(cached.rows, term, Number.MAX_SAFE_INTEGER).length;
    return { board: BOARD, hits, totalAvailable: matched };
  },
};
