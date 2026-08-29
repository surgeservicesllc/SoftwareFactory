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
 * Jobdanmark — a JSON search behind a POST.
 *
 * Adapted from `.agents/skills/jobdanmark-search/cli` in the MIT-licensed
 * `MadsLorentzen/ai-job-search`. The largest of the source adapters, though
 * most of that size is commands this does not need — autocomplete, categories,
 * locations and detail are all interactive-CLI affordances.
 *
 * Its search is a POST carrying a typed filter list rather than a query
 * string, which is why this is the only adapter that sends a body.
 */

const BASE_URL = "https://jobdanmark.dk";
const BOARD = "jobdanmark";

type JobdanmarkItem = {
  title?: unknown;
  companyName?: unknown;
  companyAddress?: unknown;
  publishedDate?: unknown;
  applicationDeadline?: unknown;
  url?: unknown;
  jobTypes?: unknown;
};

type JobdanmarkResponse = { items?: unknown; totalItems?: unknown };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Jobdanmark writes dates as `DD-MM-YYYY`.
 *
 * Carried across from the source's `toContractDate`, with one change: a value
 * that does not match returns null rather than passing through. The source let
 * an unexpected shape flow onward so it "stays visible downstream", which is
 * right for a CLI a person is reading. Here the value would be stored and
 * rendered as a date, and `20-08-2026` shown as a posting date is a wrong fact
 * rather than a visible anomaly.
 */
export function toIsoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const danish = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (danish) return `${danish[3]}-${danish[2]}-${danish[1]}`;
  const iso = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/**
 * Pull the city out of a Danish postal address.
 *
 * The source's `extractCity`, kept with its reasoning, which is the sort of
 * thing that is expensive to rediscover:
 *
 *   "Live companyAddress values put the city after the postcode either as
 *    'Lautruphoej 2, 2750 Ballerup' or '2670, Greve'. The comma fallback
 *    requires a non-digit after the comma so a 4-digit street number
 *    ('Vejlevej 1234, 7100 Vejle') never wins over the real postcode."
 */
export function extractCity(address: string | null): string | null {
  if (address === null) return null;
  const city =
    address.match(/\d{4}\s+(.+)$/)?.[1] ?? address.match(/\d{4}\s*,\s*([^\d,].*)$/)?.[1];
  return text(city ?? null);
}

export function toJobdanmarkHits(payload: JobdanmarkResponse, limit: number): BoardSearchHit[] {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const hits: BoardSearchHit[] = [];
  for (const entry of items) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const item = entry as JobdanmarkItem;

    const title = text(item.title);
    const company = text(item.companyName);
    const relative = text(item.url);
    if (title === null || company === null || relative === null) continue;

    const url = relative.startsWith("http") ? relative : `${BASE_URL}${relative}`;
    // The slug is the stable identity; the full URL carries a host that could
    // change without the posting changing.
    const externalId = relative.replace(/^\/job\//, "").slice(0, 200);

    hits.push({
      job: {
        externalId: externalId.length === 0 ? relative.slice(0, 200) : externalId,
        url: /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        salaryText: null,
        location: extractCity(text(item.companyAddress)),
        workModel: null,
        description: htmlToText(null),
      },
      publishedOn: toIsoDate(item.publishedDate),
      closesOn: toIsoDate(item.applicationDeadline),
    });
  }
  return hits;
}

export async function searchJobdanmark(
  query: BoardSearchQuery,
  overrides: BoardFetchOverrides = {},
): Promise<BoardSearchResult> {
  const filters: Array<{ type: string; value: string; displayText: string }> = [];
  if (query.text.length > 0) {
    filters.push({ type: "freetext", value: query.text, displayText: query.text });
  }
  if (query.location !== null) {
    /*
     * Jobdanmark separates a postcode filter from a municipality one, and
     * sending a place name as a zip returns everything rather than erroring —
     * which reads as a broken location filter rather than a rejected one.
     */
    const asZip = /^\d{4}$/.test(query.location);
    filters.push({
      type: asZip ? "zip" : "municipality",
      value: query.location,
      displayText: query.location,
    });
  }

  const payload = await fetchBoardJson<JobdanmarkResponse>(
    `${BASE_URL}/api/jobsearch/search/1`,
    { board: BOARD, body: { jobTypes: [], filters, locationMode: "Text", distance: 50 }, ...overrides },
  );

  if (payload === null || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new BoardSearchError(
      "board_response_unreadable",
      BOARD,
      "Jobdanmark answered without a job list.",
    );
  }

  const total = payload.totalItems;
  return {
    board: BOARD,
    hits: toJobdanmarkHits(payload, query.limit),
    totalAvailable: typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null,
  };
}

export const jobdanmarkAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Jobdanmark",
  summary: "A Danish commercial job board, searched by free text and place.",
  coverage: "Denmark",
  supportsLocation: true,
  search: searchJobdanmark,
};
