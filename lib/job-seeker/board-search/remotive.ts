import { fetchBoardJson, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * Remotive — remote jobs across tech, marketing, and operations, via the
 * public API at remotive.com/api/remote-jobs.
 *
 * Remotive's API terms (returned in every response) set three conditions this
 * adapter honors by construction: results must link back to the Remotive URL
 * and name Remotive as the source (every hit's `url` is Remotive's own, and
 * the UI badges the board on every card); jobs must not be re-submitted to
 * third-party boards (nothing here republishes — results render to the signed
 * -in person who searched); and the API should be called at most a few times
 * a day. That last one is why this adapter caches: one fetch per normalized
 * search term per six hours per server instance, which turns a day of a
 * person's repeated searching into a handful of upstream calls. The cache is
 * per-instance memory — bounded, and honest to clear on redeploy.
 */

const BASE_URL = "https://remotive.com/api/remote-jobs";
const BOARD = "remotive";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_TERMS = 50;

type RemotiveJob = {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  company_name?: unknown;
  category?: unknown;
  job_type?: unknown;
  publication_date?: unknown;
  candidate_required_location?: unknown;
  salary?: unknown;
  description?: unknown;
};

type RemotiveEnvelope = {
  jobs?: unknown;
  "total-job-count"?: unknown;
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

export function toRemotiveHits(envelope: RemotiveEnvelope, limit: number): BoardSearchHit[] {
  const rows = Array.isArray(envelope.jobs) ? envelope.jobs : [];
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const job = entry as RemotiveJob;
    const title = text(job.title);
    const company = text(job.company_name);
    const id = typeof job.id === "number" ? String(job.id) : text(job.id);
    if (title === null || company === null || id === null) continue;
    const url = text(job.url);
    hits.push({
      job: {
        externalId: id,
        url: url !== null && /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        salaryText: text(job.salary),
        // Remotive states where the candidate must be, not an office address.
        location: text(job.candidate_required_location),
        // Every listing on Remotive is remote by the board's charter.
        workModel: "remote",
        description: htmlToText(typeof job.description === "string" ? job.description : null),
      },
      publishedOn: isoDate(job.publication_date),
      closesOn: null,
    });
  }
  return hits;
}

type CacheEntry = { at: number; envelope: RemotiveEnvelope };
const cache = new Map<string, CacheEntry>();

export function clearRemotiveCache(): void {
  cache.clear();
}

export const remotiveAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Remotive",
  summary: "Curated remote jobs; results delayed ~24h by the board's design.",
  coverage: "Remote roles worldwide, strong in tech, marketing, and support.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const term = query.text.trim().toLowerCase();
    const now = overrides?.now?.() ?? Date.now();
    const cached = cache.get(term);
    let envelope: RemotiveEnvelope;
    if (cached && now - cached.at < CACHE_TTL_MS) {
      envelope = cached.envelope;
    } else {
      const url = term.length > 0
        ? `${BASE_URL}?search=${encodeURIComponent(term)}`
        : BASE_URL;
      envelope = await fetchBoardJson<RemotiveEnvelope>(url, { board: BOARD, ...overrides });
      if (cache.size >= CACHE_MAX_TERMS) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cache.delete(oldest[0]);
      }
      cache.set(term, { at: now, envelope });
    }
    const total = typeof envelope["total-job-count"] === "number"
      ? envelope["total-job-count"]
      : null;
    return { board: BOARD, hits: toRemotiveHits(envelope, query.limit), totalAvailable: total };
  },
};
