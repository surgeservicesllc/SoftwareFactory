import { fetchBoardJson, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * Remote OK — the public JSON feed at remoteok.com/api.
 *
 * The feed's own first element is a legal notice requiring a link back to the
 * Remote OK job URL and attribution — both structural here: every hit's `url`
 * is the board's own listing page and the UI badges the board. The feed has
 * no query parameter, so the corpus (a few hundred current listings) is
 * fetched once and filtered locally; like Remotive, a short per-instance
 * cache keeps a day of searching to a handful of upstream calls.
 */

const BASE_URL = "https://remoteok.com/api";
const BOARD = "remoteok";
const CACHE_TTL_MS = 30 * 60 * 1000;

type RemoteOkRow = {
  id?: unknown;
  slug?: unknown;
  position?: unknown;
  company?: unknown;
  location?: unknown;
  url?: unknown;
  date?: unknown;
  description?: unknown;
  salary_min?: unknown;
  salary_max?: unknown;
  tags?: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // The feed ships titles and companies with HTML entities intact
  // ("Stanley Black &amp; Decker"); decode the common ones so a stored row
  // carries the name, not the markup of the name.
  const trimmed = value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function salaryText(row: RemoteOkRow): string | null {
  const min = typeof row.salary_min === "number" && row.salary_min > 0 ? row.salary_min : null;
  const max = typeof row.salary_max === "number" && row.salary_max > 0 ? row.salary_max : null;
  if (min === null && max === null) return null;
  const range = min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`;
  return `USD ${range}`;
}

function rowMatches(row: RemoteOkRow, term: string): boolean {
  if (term.length === 0) return true;
  const haystack = [
    text(row.position),
    text(row.company),
    ...(Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : []),
  ]
    .filter((part): part is string => part !== null)
    .join(" ")
    .toLowerCase();
  return term
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

export function toRemoteOkHits(rows: readonly unknown[], term: string, limit: number): BoardSearchHit[] {
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as RemoteOkRow;
    // The feed's first element is the legal notice, which has no position.
    const title = text(row.position);
    const company = text(row.company);
    const id = typeof row.id === "number" ? String(row.id) : text(row.id) ?? text(row.slug);
    if (title === null || company === null || id === null) continue;
    if (!rowMatches(row, term)) continue;
    const url = text(row.url);
    hits.push({
      job: {
        externalId: id,
        url: url !== null && /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        salaryText: salaryText(row),
        location: text(row.location),
        workModel: "remote",
        description: htmlToText(typeof row.description === "string" ? row.description : null),
      },
      publishedOn: isoDate(row.date),
      closesOn: null,
    });
  }
  return hits;
}

type CacheEntry = { at: number; rows: readonly unknown[] };
let corpus: CacheEntry | null = null;

export function clearRemoteOkCache(): void {
  corpus = null;
}

export const remoteokAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Remote OK",
  summary: "Remote jobs feed; filtered locally because the feed has no query.",
  coverage: "Remote roles worldwide across tech, marketing, and design.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const now = overrides?.now?.() ?? Date.now();
    if (corpus === null || now - corpus.at >= CACHE_TTL_MS) {
      const rows = await fetchBoardJson<unknown[]>(BASE_URL, {
        board: BOARD,
        headers: { Accept: "application/json" },
        ...overrides,
      });
      corpus = { at: now, rows: Array.isArray(rows) ? rows : [] };
    }
    const term = query.text.trim().toLowerCase();
    const hits = toRemoteOkHits(corpus.rows, term, query.limit);
    // The corpus is the whole feed, so the honest total for this term is the
    // count that matched, not the feed length.
    const matched = toRemoteOkHits(corpus.rows, term, Number.MAX_SAFE_INTEGER).length;
    return { board: BOARD, hits, totalAvailable: matched };
  },
};
