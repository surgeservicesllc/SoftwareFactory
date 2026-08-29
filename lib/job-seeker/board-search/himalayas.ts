import { fetchBoardJson, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * Himalayas — the public jobs API at himalayas.app/jobs/api.
 *
 * The endpoint pages but does not search, so a page of recent listings is
 * fetched and filtered locally against the term. Dates arrive as epoch
 * seconds; salaries as strings with a separate period field, carried through
 * as text ("USD 60–70 hourly") rather than coerced into an annual number
 * that was never stated.
 */

const BASE_URL = "https://himalayas.app/jobs/api";
const BOARD = "himalayas";
const FETCH_LIMIT = 100;

type HimalayasJob = {
  guid?: unknown;
  applicationLink?: unknown;
  title?: unknown;
  companyName?: unknown;
  minSalary?: unknown;
  maxSalary?: unknown;
  salaryPeriod?: unknown;
  currency?: unknown;
  locationRestrictions?: unknown;
  description?: unknown;
  excerpt?: unknown;
  pubDate?: unknown;
  expiryDate?: unknown;
};

type HimalayasEnvelope = {
  jobs?: unknown;
  totalCount?: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function epochToIso(value: unknown): string | null {
  const seconds = typeof value === "number" ? value : Number(text(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function salaryText(job: HimalayasJob): string | null {
  const min = text(job.minSalary);
  const max = text(job.maxSalary);
  if (min === null && max === null) return null;
  const currency = text(job.currency) ?? "";
  const period = text(job.salaryPeriod);
  const range = min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`;
  return `${currency} ${range}${period ? ` ${period}` : ""}`.trim();
}

function locationText(job: HimalayasJob): string | null {
  if (!Array.isArray(job.locationRestrictions)) return null;
  const places = job.locationRestrictions.filter((p): p is string => typeof p === "string");
  return places.length > 0 ? places.join(", ") : null;
}

function jobMatches(job: HimalayasJob, term: string): boolean {
  if (term.length === 0) return true;
  const haystack = [text(job.title), text(job.companyName), text(job.excerpt)]
    .filter((part): part is string => part !== null)
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}

export function toHimalayasHits(
  envelope: HimalayasEnvelope,
  term: string,
  limit: number,
): BoardSearchHit[] {
  const rows = Array.isArray(envelope.jobs) ? envelope.jobs : [];
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const job = entry as HimalayasJob;
    const title = text(job.title);
    const company = text(job.companyName);
    const guid = text(job.guid) ?? text(job.applicationLink);
    if (title === null || company === null || guid === null) continue;
    if (!jobMatches(job, term)) continue;
    const url = text(job.applicationLink) ?? guid;
    hits.push({
      job: {
        externalId: guid.slice(0, 200),
        url: /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        salaryText: salaryText(job),
        location: locationText(job),
        workModel: "remote",
        description: htmlToText(
          typeof job.description === "string"
            ? job.description
            : typeof job.excerpt === "string" ? job.excerpt : null,
        ),
      },
      publishedOn: epochToIso(job.pubDate),
      closesOn: epochToIso(job.expiryDate),
    });
  }
  return hits;
}

export const himalayasAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Himalayas",
  summary: "Remote jobs API paged by recency; the term filters the fetched page.",
  coverage: "Remote roles worldwide with location-restriction facets.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const envelope = await fetchBoardJson<HimalayasEnvelope>(
      `${BASE_URL}?limit=${FETCH_LIMIT}`,
      { board: BOARD, ...overrides },
    );
    const term = query.text.trim().toLowerCase();
    const hits = toHimalayasHits(envelope, term, query.limit);
    // The board's totalCount covers the whole feed; with a term applied the
    // honest total for what was actually searched is unknown.
    const total = term.length === 0 && typeof envelope.totalCount === "number"
      ? envelope.totalCount
      : null;
    return { board: BOARD, hits, totalAvailable: total };
  },
};
