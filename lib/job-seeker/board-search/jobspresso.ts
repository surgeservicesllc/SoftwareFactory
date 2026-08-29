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
 * Jobspresso — the official WordPress job feed at jobspresso.co/?feed=job_feed.
 *
 * The feed is the board's published integration surface. Each item's
 * `dc:creator` carries "Company<br>⚲ Location" — the shared htmlToText turns
 * the break into a newline, and the location marker is stripped rather than
 * stored as part of a place name. No query parameter exists, so the feed is
 * filtered locally with the same short cache the other corpus feeds use.
 */

const FEED_URL = "https://jobspresso.co/?feed=job_feed";
const BOARD = "jobspresso";
const CACHE_TTL_MS = 30 * 60 * 1000;

type FeedItem = Readonly<{
  title: string;
  company: string | null;
  location: string | null;
  link: string | null;
  guid: string | null;
  description: string | null;
  pubDate: string | null;
}>;

function tagText(item: string, tag: string): string | null {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return null;
  const raw = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return raw.length === 0 ? null : raw;
}

function creatorParts(creator: string | null): { company: string | null; location: string | null } {
  if (creator === null) return { company: null, location: null };
  const decoded = htmlToText(creator) ?? "";
  const [companyLine, ...rest] = decoded.split("\n");
  const company = companyLine?.trim() ?? "";
  const location = rest.join(" ").replace(/⚲/g, "").trim();
  return {
    company: company.length > 0 ? company : null,
    location: location.length > 0 ? location : null,
  };
}

export function parseJobspressoFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = match[1];
    const rawTitle = tagText(body, "title");
    if (rawTitle === null) continue;
    const title = htmlToText(rawTitle);
    if (title === null) continue;
    const { company, location } = creatorParts(tagText(body, "dc:creator"));
    items.push({
      title,
      company,
      location,
      link: tagText(body, "link"),
      guid: tagText(body, "guid"),
      description: tagText(body, "description"),
      pubDate: tagText(body, "pubDate"),
    });
  }
  return items;
}

function isoDate(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function itemMatches(item: FeedItem, term: string): boolean {
  if (term.length === 0) return true;
  const haystack = [item.title, item.company ?? "", item.location ?? ""]
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}

export function toJobspressoHits(
  items: readonly FeedItem[],
  term: string,
  limit: number,
): BoardSearchHit[] {
  const hits: BoardSearchHit[] = [];
  for (const item of items) {
    if (hits.length >= limit) break;
    // A stored job needs a company; an item without one makes no claim.
    if (item.company === null) continue;
    if (!itemMatches(item, term)) continue;
    const url = item.link ?? item.guid;
    hits.push({
      job: {
        externalId: (item.guid ?? item.link ?? `${item.company}:${item.title}`).slice(0, 200),
        url: url !== null && /^https?:\/\//i.test(url) ? url : null,
        title: item.title,
        company: item.company,
        salaryText: null,
        location: item.location,
        // Jobspresso curates remote positions by the board's charter.
        workModel: "remote",
        description: htmlToText(item.description),
      },
      publishedOn: isoDate(item.pubDate),
      closesOn: null,
    });
  }
  return hits;
}

type CacheEntry = { at: number; items: readonly FeedItem[] };
let cached: CacheEntry | null = null;

export function clearJobspressoCache(): void {
  cached = null;
}

export const jobspressoAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Jobspresso",
  summary: "The board's official job feed, filtered locally.",
  coverage: "Curated remote roles in tech, marketing, and customer support.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const now = overrides?.now?.() ?? Date.now();
    if (cached === null || now - cached.at >= CACHE_TTL_MS) {
      const xml = await fetchBoardText(FEED_URL, { board: BOARD, ...overrides });
      const items = parseJobspressoFeed(xml);
      if (items.length === 0 && !xml.includes("<rss")) {
        throw new BoardSearchError("board_response_unreadable", BOARD, "The feed did not parse as RSS.");
      }
      cached = { at: now, items };
    }
    const term = query.text.trim().toLowerCase();
    const hits = toJobspressoHits(cached.items, term, query.limit);
    const matched = toJobspressoHits(cached.items, term, Number.MAX_SAFE_INTEGER).length;
    return { board: BOARD, hits, totalAvailable: matched };
  },
};
