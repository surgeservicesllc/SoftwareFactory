import { fetchBoardText, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  BoardSearchError,
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * Jobindex — Denmark's largest commercial job board.
 *
 * Adapted from `.agents/skills/jobindex-search/cli` in the MIT-licensed
 * `MadsLorentzen/ai-job-search`, whose helper carries the finding this whole
 * file rests on, quoted here because it is the reason the code looks like it
 * does:
 *
 *   "Jobindex moved its search results client-side. The /jobsoegning.json
 *    endpoint now returns 204 No Content. The HTML page (/jobsoegning) embeds
 *    the full result payload in a `var Stash = {...}` script blob."
 *
 * So this reads the page a browser reads and lifts the payload the page was
 * going to render. It is the most fragile adapter of the five by construction:
 * a markup change breaks it, and it must fail loudly when that happens rather
 * than return an empty list, because "no jobs matched" and "the parser no
 * longer works" look identical to a person and mean opposite things.
 */

const BASE_URL = "https://www.jobindex.dk";
const BOARD = "jobindex";
const STASH_MARKER = "var Stash = ";

/**
 * Lift the `var Stash = {...}` object out of the page.
 *
 * Brace-counting with string awareness, carried across from the source almost
 * unchanged. A regex cannot do this: the payload contains job descriptions,
 * descriptions contain braces and escaped quotes, and the first `}` is
 * nowhere near the end. The escape handling is what stops a `\"` inside a
 * description from being read as the end of a string and throwing the depth
 * count off for the rest of the document.
 */
export function extractStash(html: string): unknown {
  const start = html.indexOf(STASH_MARKER);
  if (start === -1) {
    throw new BoardSearchError(
      "board_response_unreadable",
      BOARD,
      "Jobindex returned a page with no result payload in it.",
    );
  }
  const open = start + STASH_MARKER.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let index = open; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end === -1) {
    throw new BoardSearchError(
      "board_response_unreadable",
      BOARD,
      "Jobindex's result payload was cut off.",
    );
  }
  try {
    return JSON.parse(html.slice(open, end));
  } catch {
    throw new BoardSearchError(
      "board_response_unreadable",
      BOARD,
      "Jobindex's result payload was not valid JSON.",
    );
  }
}

type SearchResponse = { results: unknown[]; hitcount?: unknown };

/**
 * Find `searchResponse` wherever it currently sits in the blob.
 *
 * The source walked the tree rather than indexing a fixed path
 * (`jobsearch/result_app -> storeData -> searchResponse`), and that judgement
 * is kept: the path is Jobindex's internal component layout, which it can
 * rename without changing what it serves. A search that survives a rename is
 * worth the walk. Depth is bounded so a self-referencing payload cannot hang
 * the request.
 */
export function findSearchResponse(node: unknown, depth = 0): SearchResponse | null {
  if (depth > 12 || node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findSearchResponse(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  const candidate = record.searchResponse;
  if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
    const results = (candidate as Record<string, unknown>).results;
    if (Array.isArray(results)) return candidate as SearchResponse;
  }
  for (const value of Object.values(record)) {
    const found = findSearchResponse(value, depth + 1);
    if (found) return found;
  }
  return null;
}

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

function absoluteUrl(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return raw.startsWith("/") ? `${BASE_URL}${raw}` : null;
}

export function toJobindexHits(response: SearchResponse, limit: number): BoardSearchHit[] {
  const hits: BoardSearchHit[] = [];
  for (const entry of response.results) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;

    const title = text(row.headline) ?? text(row.title);
    const company = text(row.company) ?? text(row.companyName);
    if (title === null || company === null) continue;

    const url = absoluteUrl(row.url) ?? absoluteUrl(row.link);
    const externalId =
      text(row.tid) ?? text(row.id) ?? (url === null ? null : url.slice(-200));
    if (externalId === null) continue;

    hits.push({
      job: {
        externalId,
        url,
        title,
        company,
        salaryText: null,
        location: text(row.area) ?? text(row.location),
        workModel: null,
        description: htmlToText(
          typeof row.description === "string"
            ? row.description
            : typeof row.teaser === "string"
              ? row.teaser
              : null,
        ),
      },
      publishedOn: isoDate(row.date) ?? isoDate(row.firstdate),
      closesOn: isoDate(row.deadline),
    });
  }
  return hits;
}

export async function searchJobindex(
  query: BoardSearchQuery,
  overrides: BoardFetchOverrides = {},
): Promise<BoardSearchResult> {
  const params = new URLSearchParams();
  if (query.text.length > 0) params.set("q", query.text);
  if (query.location !== null) params.set("supid", query.location);

  const html = await fetchBoardText(`${BASE_URL}/jobsoegning?${params.toString()}`, {
    board: BOARD,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "da,en;q=0.9",
    },
    ...overrides,
  });

  const response = findSearchResponse(extractStash(html));
  if (response === null) {
    throw new BoardSearchError(
      "board_response_unreadable",
      BOARD,
      "Jobindex's page no longer contains a readable result set.",
    );
  }

  const hitcount = response.hitcount;
  return {
    board: BOARD,
    hits: toJobindexHits(response, query.limit),
    totalAvailable:
      typeof hitcount === "number" && Number.isFinite(hitcount) && hitcount >= 0 ? hitcount : null,
  };
}

export const jobindexAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Jobindex",
  summary: "Denmark's largest commercial job board.",
  coverage: "Denmark",
  search: searchJobindex,
};
