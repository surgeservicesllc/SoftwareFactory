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
 * JSearch — the credentialed aggregator that puts LinkedIn and Indeed
 * postings INSIDE the results list.
 *
 * Neither LinkedIn nor Indeed offers this product a lawful direct feed, and
 * this repository has repeatedly refused to scrape them — that decision
 * stands (see registry.ts). What their terms cannot forbid is reading the
 * index Google already builds from the structured data those sites publish
 * for it: JSearch (OpenWeb Ninja, via RapidAPI) exposes the Google for Jobs
 * index over an official, keyed API, and every result names the site that
 * actually hosts the posting in `job_publisher` — "LinkedIn", "Indeed",
 * "Glassdoor", "ZipRecruiter" and hundreds more. This is exactly the
 * "credentialed integration under the existing import-adapter rules" the
 * registry's LinkedIn paragraph reserved as the one acceptable route.
 *
 * ## Env-gated, honestly
 *
 * The adapter exists only when `JSEARCH_RAPIDAPI_KEY` is set. Absent the
 * key there is nothing to call, so the board is not offered — a tickable
 * board that always failed would teach people to ignore failure notices
 * (the registry's Jobbank lesson). The catalogue row says **Not Connected**
 * and names the exact variable until the owner supplies it.
 *
 * ## Parser provenance
 *
 * The 13 open boards were each probed live before their parsers were
 * written. A keyed board cannot be probed without the owner's credential,
 * so this parser is pinned to the JSearch v2 response envelope as OpenWeb
 * Ninja documents it (`{status, data: [...]}`, `job_*` fields), against a
 * fixture in its test. If the live shape differs when the key first turns
 * the board on, the failure surfaces by name in the search UI through the
 * same per-board failure channel every other board uses — never as
 * invented results.
 *
 * ## Call frugality
 *
 * One request per search (`num_pages=1`, about ten results), because the
 * free plan is ~200 requests a month and a fan-out that quietly spent five
 * of them per search would exhaust the key in a day of use. The board
 * reports no total, and `totalAvailable` stays null rather than dressing a
 * page size up as one.
 */

const BASE_URL = "https://jsearch.p.rapidapi.com";
const RAPIDAPI_HOST = "jsearch.p.rapidapi.com";
const BOARD = "jsearch";

/** The exact variable the owner sets in Vercel to turn this board on. */
export const JSEARCH_KEY_ENV = "JSEARCH_RAPIDAPI_KEY";

export function jsearchConfigured(): boolean {
  const key = process.env[JSEARCH_KEY_ENV];
  return typeof key === "string" && key.trim().length > 0;
}

type JSearchJob = {
  job_id?: unknown;
  job_title?: unknown;
  employer_name?: unknown;
  job_publisher?: unknown;
  job_apply_link?: unknown;
  job_google_link?: unknown;
  job_description?: unknown;
  job_is_remote?: unknown;
  job_posted_at_datetime_utc?: unknown;
  job_city?: unknown;
  job_state?: unknown;
  job_country?: unknown;
  job_min_salary?: unknown;
  job_max_salary?: unknown;
  job_salary_currency?: unknown;
  job_salary_period?: unknown;
};

type JSearchEnvelope = {
  status?: unknown;
  data?: unknown;
  error?: { message?: unknown } | null;
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

/** "Copenhagen, Capital Region, DK" from whichever parts the posting has. */
export function toJSearchLocation(job: JSearchJob): string | null {
  const parts = [text(job.job_city), text(job.job_state), text(job.job_country)]
    .filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(", ").slice(0, 200);
}

/** Salary said as the posting says it; absent parts stay absent. */
export function toJSearchSalaryText(job: JSearchJob): string | null {
  const min = typeof job.job_min_salary === "number" && Number.isFinite(job.job_min_salary)
    ? job.job_min_salary : null;
  const max = typeof job.job_max_salary === "number" && Number.isFinite(job.job_max_salary)
    ? job.job_max_salary : null;
  if (min === null && max === null) return null;
  const currency = text(job.job_salary_currency);
  const period = text(job.job_salary_period);
  const range = min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`;
  return [currency, range, period === null ? null : `per ${period.toLowerCase()}`]
    .filter((part): part is string => part !== null)
    .join(" ")
    .slice(0, 200);
}

export function toJSearchHits(envelope: JSearchEnvelope, limit: number): BoardSearchHit[] {
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const job = entry as JSearchJob;

    const title = text(job.job_title);
    const company = text(job.employer_name);
    const id = text(job.job_id);
    if (title === null || company === null || id === null) continue;

    // The apply link lands on the publisher's own posting (LinkedIn's page,
    // Indeed's page); Google's job panel link is the fallback when a posting
    // somehow carries none.
    const apply = text(job.job_apply_link) ?? text(job.job_google_link);
    hits.push({
      job: {
        externalId: id.slice(0, 200),
        url: apply !== null && /^https?:\/\//i.test(apply) ? apply : null,
        title,
        company,
        salaryText: toJSearchSalaryText(job),
        location: toJSearchLocation(job),
        // The index states remoteness as a boolean; false says on-site vs
        // hybrid is not stated, so anything but true stays null rather than
        // becoming a guessed arrangement.
        workModel: job.job_is_remote === true ? "remote" : null,
        description: htmlToText(typeof job.job_description === "string" ? job.job_description : null),
      },
      publishedOn: isoDate(job.job_posted_at_datetime_utc),
      closesOn: null,
      // The site that actually hosts this posting — the whole reason this
      // adapter exists. Shown beside the result so "LinkedIn" and "Indeed"
      // are visible words on the card, not implications.
      publisher: text(job.job_publisher),
    });
  }
  return hits;
}

export async function searchJSearch(
  query: BoardSearchQuery,
  overrides: BoardFetchOverrides = {},
): Promise<BoardSearchResult> {
  const key = process.env[JSEARCH_KEY_ENV]?.trim() ?? "";
  if (key.length === 0) {
    // Reachable only if a caller bypasses the gated registry; the message
    // stays honest for that caller too.
    throw new BoardSearchError(
      "board_unreachable",
      BOARD,
      `JSearch is Not Connected: set ${JSEARCH_KEY_ENV} to turn it on.`,
    );
  }

  // JSearch's documented query pattern folds the place into the text:
  // "marketing manager jobs in copenhagen". An empty text still searches,
  // location alone still searches; both empty is refused by the route.
  const composed = [
    query.text.trim(),
    query.location !== null && query.location.trim().length > 0
      ? `jobs in ${query.location.trim()}`
      : "jobs",
  ].filter((part) => part.length > 0).join(" ");

  const params = new URLSearchParams({
    query: composed,
    page: "1",
    num_pages: "1",
    date_posted: "all",
  });

  const envelope = await fetchBoardJson<JSearchEnvelope>(
    `${BASE_URL}/search?${params.toString()}`,
    {
      board: BOARD,
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": RAPIDAPI_HOST,
      },
      ...overrides,
    },
  );

  if (envelope === null || typeof envelope !== "object") {
    throw new BoardSearchError("board_response_unreadable", BOARD, "JSearch answered with no envelope.");
  }
  const declaredError = text(envelope.error?.message);
  if (declaredError !== null) {
    throw new BoardSearchError("board_response_unreadable", BOARD, `JSearch refused: ${declaredError}`);
  }
  if (!Array.isArray(envelope.data)) {
    throw new BoardSearchError("board_response_unreadable", BOARD, "JSearch answered without a job list.");
  }

  return {
    board: BOARD,
    hits: toJSearchHits(envelope, query.limit),
    // JSearch reports no corpus total; a page size dressed up as one would
    // make every search look exhaustive.
    totalAvailable: null,
  };
}

export const jsearchAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "JSearch",
  summary:
    "Google's job index over an official keyed API — the door through which LinkedIn, "
    + "Indeed, Glassdoor and ZipRecruiter postings appear inline, each naming its publisher.",
  coverage: "Worldwide aggregator (LinkedIn, Indeed, Glassdoor, ZipRecruiter and more)",
  supportsLocation: true,
  search: searchJSearch,
};
