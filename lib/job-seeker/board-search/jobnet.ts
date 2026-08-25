import { fetchBoardJson, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  BoardSearchError,
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * Jobnet — the Danish public employment service's job bank.
 *
 * Adapted from `.agents/skills/jobnet-search/cli` in the MIT-licensed
 * `MadsLorentzen/ai-job-search`. Jobnet exposes a real JSON BFF, so this is
 * the cleanest of the five: no HTML parsing, and the field names below are
 * the board's own.
 *
 * The `x-csrf: 1` header is not decoration and not a token. Jobnet's BFF
 * refuses requests without it; the value is never checked. It came across from
 * the source verbatim because removing it produces a 403 that looks like an
 * authorization problem and is not one.
 */

const BASE_URL = "https://jobnet.dk/bff";
const BOARD = "jobnet";

type JobnetAd = {
  jobAdId?: unknown;
  title?: unknown;
  hiringOrgName?: unknown;
  municipality?: unknown;
  postalDistrictName?: unknown;
  workPlaceAddress?: unknown;
  publicationDate?: unknown;
  applicationDeadline?: unknown;
  description?: unknown;
};

type JobnetSearchResponse = {
  jobAds?: unknown;
  totalJobAdCount?: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Jobnet writes "no deadline" as `1900-01-01`, which a date column would
 * happily store as a real date eighty years before the posting existed. The
 * source dropped it the same way; this keeps that and says why.
 */
function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  if (raw.startsWith("1900-01-01")) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function toJobnetHits(payload: JobnetSearchResponse, limit: number): BoardSearchHit[] {
  const ads = Array.isArray(payload.jobAds) ? payload.jobAds : [];
  const hits: BoardSearchHit[] = [];
  for (const entry of ads) {
    if (hits.length >= limit) break;
    const ad = entry as JobnetAd;
    const title = text(ad.title);
    const company = text(ad.hiringOrgName);
    const externalId = text(ad.jobAdId);
    /*
     * A posting with no title, no employer, or no id is dropped rather than
     * filled in. `job_seeker_jobs` requires title and company, and an
     * "Unknown company" placeholder is a fabricated employer sitting in a
     * person's job list — the exact thing the source column's comment forbids.
     */
    if (title === null || company === null || externalId === null) continue;

    hits.push({
      job: {
        externalId,
        url: `https://jobnet.dk/find-job/${encodeURIComponent(externalId)}`,
        title,
        company,
        salaryText: null,
        location: text(ad.postalDistrictName) ?? text(ad.municipality) ?? text(ad.workPlaceAddress),
        // Jobnet's search payload carries no arrangement field. Guessing one
        // from the title is how "remote" appears on an onsite job.
        workModel: null,
        description: htmlToText(typeof ad.description === "string" ? ad.description : null),
      },
      publishedOn: isoDate(ad.publicationDate),
      closesOn: isoDate(ad.applicationDeadline),
    });
  }
  return hits;
}

export function jobnetTotal(payload: JobnetSearchResponse): number | null {
  const total = payload.totalJobAdCount;
  return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null;
}

export async function searchJobnet(
  query: BoardSearchQuery,
  overrides: BoardFetchOverrides = {},
): Promise<BoardSearchResult> {
  const params = new URLSearchParams({
    resultsPerPage: String(Math.min(Math.max(query.limit, 1), 100)),
    pageNumber: "1",
    orderType: "10",
  });
  if (query.text.length > 0) params.set("searchString", query.text);
  /*
   * Jobnet's postal-code filter takes a code, not a place name. Sending
   * "Copenhagen" to it returns everything rather than erroring, which reads as
   * "the location filter is broken". A non-numeric place goes into the free
   * text instead, where the board can actually match it.
   */
  if (query.location !== null) {
    if (/^\d{4}$/.test(query.location)) {
      params.set("postalCode", query.location);
      params.set("kmRadius", "30");
    } else {
      params.set("searchString", [query.text, query.location].filter((part) => part.length > 0).join(" "));
    }
  }

  const payload = await fetchBoardJson<JobnetSearchResponse>(
    `${BASE_URL}/jobsearch?${params.toString()}`,
    { board: BOARD, headers: { "x-csrf": "1" }, ...overrides },
  );

  if (payload === null || typeof payload !== "object" || !Array.isArray(payload.jobAds)) {
    throw new BoardSearchError(
      "board_response_unreadable",
      BOARD,
      "Jobnet answered without a job list.",
    );
  }

  return { board: BOARD, hits: toJobnetHits(payload, query.limit), totalAvailable: jobnetTotal(payload) };
}

export const jobnetAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Jobnet",
  summary: "The Danish public employment service's national job bank.",
  coverage: "Denmark",
  search: searchJobnet,
};
