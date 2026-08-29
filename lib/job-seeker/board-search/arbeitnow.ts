import { fetchBoardJson, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * Arbeitnow — the public job-board API at arbeitnow.com/api/job-board-api.
 *
 * A paged feed without a query parameter, filtered locally; listings are
 * Europe-centric with visa-sponsorship and remote flags. `remote` is a real
 * boolean here, so workModel is read, not guessed — but false means "the
 * board did not mark it remote", which is not proof of an office, so false
 * maps to null rather than to "onsite".
 */

const BASE_URL = "https://www.arbeitnow.com/api/job-board-api";
const BOARD = "arbeitnow";
const CACHE_TTL_MS = 30 * 60 * 1000;

type ArbeitnowJob = {
  slug?: unknown;
  url?: unknown;
  title?: unknown;
  company_name?: unknown;
  location?: unknown;
  remote?: unknown;
  description?: unknown;
  tags?: unknown;
  created_at?: unknown;
};

type ArbeitnowEnvelope = {
  data?: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function epochToIso(value: unknown): string | null {
  if (typeof value !== "number" || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function jobMatches(job: ArbeitnowJob, term: string): boolean {
  if (term.length === 0) return true;
  const haystack = [
    text(job.title),
    text(job.company_name),
    ...(Array.isArray(job.tags) ? job.tags.filter((t): t is string => typeof t === "string") : []),
  ]
    .filter((part): part is string => part !== null)
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}

export function toArbeitnowHits(
  envelope: ArbeitnowEnvelope,
  term: string,
  limit: number,
): BoardSearchHit[] {
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const job = entry as ArbeitnowJob;
    const title = text(job.title);
    const company = text(job.company_name);
    const slug = text(job.slug);
    if (title === null || company === null || slug === null) continue;
    if (!jobMatches(job, term)) continue;
    const url = text(job.url);
    hits.push({
      job: {
        externalId: slug.slice(0, 200),
        url: url !== null && /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        salaryText: null,
        location: text(job.location),
        workModel: job.remote === true ? "remote" : null,
        description: htmlToText(typeof job.description === "string" ? job.description : null),
      },
      publishedOn: epochToIso(job.created_at),
      closesOn: null,
    });
  }
  return hits;
}

type CacheEntry = { at: number; envelope: ArbeitnowEnvelope };
let cached: CacheEntry | null = null;

export function clearArbeitnowCache(): void {
  cached = null;
}

export const arbeitnowAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Arbeitnow",
  summary: "European job feed with remote and visa flags; filtered locally.",
  coverage: "Europe-centric roles, remote and on-site, tech and beyond.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const now = overrides?.now?.() ?? Date.now();
    if (cached === null || now - cached.at >= CACHE_TTL_MS) {
      const envelope = await fetchBoardJson<ArbeitnowEnvelope>(BASE_URL, {
        board: BOARD,
        ...overrides,
      });
      cached = { at: now, envelope };
    }
    const term = query.text.trim().toLowerCase();
    const hits = toArbeitnowHits(cached.envelope, term, query.limit);
    const matched = toArbeitnowHits(cached.envelope, term, Number.MAX_SAFE_INTEGER).length;
    return { board: BOARD, hits, totalAvailable: matched };
  },
};
