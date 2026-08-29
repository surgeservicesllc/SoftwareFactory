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
 * We Work Remotely — the official RSS feed at weworkremotely.com/remote-jobs.rss.
 *
 * RSS is the board's published integration surface, so this reads exactly
 * what the board offers and nothing it protects. Items title as
 * "Company : Role", carry a region and category, and link to the board's own
 * listing page — which is where every hit here points. No query parameter
 * exists, so the feed is filtered locally, with the same short cache the
 * other corpus feeds use.
 */

const FEED_URL = "https://weworkremotely.com/remote-jobs.rss";
const BOARD = "weworkremotely";
const CACHE_TTL_MS = 30 * 60 * 1000;

type FeedItem = Readonly<{
  title: string;
  company: string;
  region: string | null;
  category: string | null;
  link: string | null;
  guid: string | null;
  description: string | null;
  pubDate: string | null;
}>;

function tagText(item: string, tag: string): string | null {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return null;
  const raw = match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
  return raw.length === 0 ? null : raw;
}

export function parseWwrFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = match[1];
    const rawTitle = tagText(body, "title");
    if (rawTitle === null) continue;
    // "Company : Role" is the feed's own convention; a title without the
    // separator keeps its whole text as the role and no company claim is made.
    const separator = rawTitle.indexOf(" : ");
    const company = separator > 0 ? rawTitle.slice(0, separator).trim() : "";
    const title = separator > 0 ? rawTitle.slice(separator + 3).trim() : rawTitle;
    if (title.length === 0) continue;
    items.push({
      title,
      company,
      region: tagText(body, "region"),
      category: tagText(body, "category"),
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
  const haystack = [item.title, item.company, item.category ?? ""]
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}

export function toWwrHits(items: readonly FeedItem[], term: string, limit: number): BoardSearchHit[] {
  const hits: BoardSearchHit[] = [];
  for (const item of items) {
    if (hits.length >= limit) break;
    if (item.company.length === 0) continue;
    if (!itemMatches(item, term)) continue;
    const url = item.link ?? item.guid;
    hits.push({
      job: {
        externalId: (item.guid ?? item.link ?? `${item.company}:${item.title}`).slice(0, 200),
        url: url !== null && /^https?:\/\//i.test(url) ? url : null,
        title: item.title,
        company: item.company,
        salaryText: null,
        location: item.region,
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

export function clearWwrCache(): void {
  cached = null;
}

export const weworkremotelyAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "We Work Remotely",
  summary: "The board's official RSS feed, filtered locally.",
  coverage: "Remote roles worldwide; strong Sales and Marketing category.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const now = overrides?.now?.() ?? Date.now();
    if (cached === null || now - cached.at >= CACHE_TTL_MS) {
      const xml = await fetchBoardText(FEED_URL, { board: BOARD, ...overrides });
      const items = parseWwrFeed(xml);
      if (items.length === 0 && !xml.includes("<rss")) {
        throw new BoardSearchError("board_response_unreadable", BOARD, "The feed did not parse as RSS.");
      }
      cached = { at: now, items };
    }
    const term = query.text.trim().toLowerCase();
    const hits = toWwrHits(cached.items, term, query.limit);
    const matched = toWwrHits(cached.items, term, Number.MAX_SAFE_INTEGER).length;
    return { board: BOARD, hits, totalAvailable: matched };
  },
};
