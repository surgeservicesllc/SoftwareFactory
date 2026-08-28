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
 * Freehire — a public REST API rather than a page to be read.
 *
 * Adapted from `.agents/skills/freehire-search/cli` in the MIT-licensed
 * `MadsLorentzen/ai-job-search`, whose helper describes it as
 * "the freehire.me public REST API (JSON, `{data, meta}` envelope). Reads are
 * unauthenticated … unlike the HTML-scraping portals there is no markup to
 * parse". That makes it the sturdiest of the boards here: no `Stash` blob to
 * lift, and a documented envelope with a real total in `meta`.
 *
 * It is also the only board that fills two fields the others leave null.
 * `work_mode` is a first-class facet, so remote/hybrid/onsite is read rather
 * than guessed; and enrichment carries a salary range, so `salaryText` says
 * what the posting says instead of staying empty.
 *
 * The source made the base URL swappable through `FREEHIRE_API_URL` for
 * self-hosting. That is deliberately not carried across. An environment
 * variable that redirects where this server sends queries — and whose answers
 * become rows in a person's job list attributed to "freehire" — is a
 * redirection of trust, not a convenience, and this deployment has no reason
 * to point anywhere but the public API.
 */

const BASE_URL = "https://freehire.me";
const SEARCH_PATH = "/api/v1/agent/jobs/search";
const BOARD = "freehire";

type FreehireEnrichment = {
  salary_min?: unknown;
  salary_max?: unknown;
  salary_currency?: unknown;
};

type FreehireJob = {
  public_slug?: unknown;
  title?: unknown;
  company?: unknown;
  location?: unknown;
  url?: unknown;
  posted_at?: unknown;
  work_mode?: unknown;
  description?: unknown;
  enrichment?: FreehireEnrichment;
};

type FreehireEnvelope = {
  data?: unknown;
  meta?: { total?: unknown } | null;
  error?: unknown;
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

/**
 * Only the three arrangements `job_seeker_jobs.work_model` can hold.
 *
 * Anything else the facet grows later becomes null rather than being coerced
 * into the nearest-looking value: a posting recorded as "remote" because the
 * board said something this code did not recognise is a wrong fact about
 * someone's job, and null is merely a missing one.
 */
export function toWorkModel(value: unknown): "remote" | "hybrid" | "onsite" | null {
  const raw = text(value)?.toLowerCase() ?? null;
  return raw === "remote" || raw === "hybrid" || raw === "onsite" ? raw : null;
}

/** Adapted from the source's `formatSalary`; absent stays absent. */
export function toSalaryText(enrichment: FreehireEnrichment | undefined): string | null {
  if (enrichment === undefined || enrichment === null) return null;
  const min = typeof enrichment.salary_min === "number" ? enrichment.salary_min : null;
  const max = typeof enrichment.salary_max === "number" ? enrichment.salary_max : null;
  if (min === null && max === null) return null;
  const currency = text(enrichment.salary_currency);
  const prefix = currency === null ? "" : `${currency} `;
  const range = min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`;
  return `${prefix}${range}`.slice(0, 200);
}

export function toFreehireHits(envelope: FreehireEnvelope, limit: number): BoardSearchHit[] {
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const job = entry as FreehireJob;

    const title = text(job.title);
    const company = text(job.company);
    const slug = text(job.public_slug);
    /*
     * The source defaulted a missing title to "(untitled)". That is right for
     * a CLI listing and wrong for a stored row: "(untitled)" in a person's job
     * list is a job that does not exist under a name nobody chose. Dropped.
     */
    if (title === null || company === null || slug === null) continue;

    const url = text(job.url);
    hits.push({
      job: {
        externalId: slug,
        url: url !== null && /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        salaryText: toSalaryText(job.enrichment),
        location: text(job.location),
        workModel: toWorkModel(job.work_mode),
        description: htmlToText(typeof job.description === "string" ? job.description : null),
      },
      publishedOn: isoDate(job.posted_at),
      // Freehire's search payload carries no application deadline.
      closesOn: null,
    });
  }
  return hits;
}

export async function searchFreehire(
  query: BoardSearchQuery,
  overrides: BoardFetchOverrides = {},
): Promise<BoardSearchResult> {
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(query.limit, 1), 100)) });
  if (query.text.length > 0) params.set("q", query.text);
  if (query.location !== null) params.append("cities", query.location);

  const envelope = await fetchBoardJson<FreehireEnvelope>(
    `${BASE_URL}${SEARCH_PATH}?${params.toString()}`,
    { board: BOARD, ...overrides },
  );

  if (envelope === null || typeof envelope !== "object") {
    throw new BoardSearchError("board_response_unreadable", BOARD, "Freehire answered with no envelope.");
  }
  /*
   * The envelope carries its own error field. A 200 with an error in the body
   * is still a failure, and treating it as an empty result would report "no
   * matches" for something that never ran.
   */
  const declaredError = text(envelope.error);
  if (declaredError !== null) {
    throw new BoardSearchError("board_response_unreadable", BOARD, `Freehire refused: ${declaredError}`);
  }
  if (!Array.isArray(envelope.data)) {
    throw new BoardSearchError("board_response_unreadable", BOARD, "Freehire answered without a job list.");
  }

  const total = envelope.meta?.total;
  return {
    board: BOARD,
    hits: toFreehireHits(envelope, query.limit),
    totalAvailable: typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null,
  };
}

export const freehireAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Freehire",
  summary: "A public developer-job API, with work arrangement and salary where the posting states them.",
  coverage: "International",
  supportsLocation: true,
  search: searchFreehire,
};
