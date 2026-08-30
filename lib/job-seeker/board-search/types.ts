/**
 * Job-board search: the shape every adapter answers in.
 *
 * Ported and adapted from the MIT-licensed `MadsLorentzen/ai-job-search`
 * (see `THIRD_PARTY_NOTICES.md`). There each board is a standalone Bun CLI
 * under `.agents/skills/<board>-search/cli`, printing JSON to stdout. The
 * fetch, retry and parsing logic is the valuable part and is what came across;
 * the `@bunli/core` argument parsing did not, because a Next.js route is the
 * caller here and a CLI framework has nothing to do in one.
 *
 * ## Why this is a sibling of `import-adapters.ts` and not a member of it
 *
 * `JobImportAdapter.fetchPostings(identifier)` reads *one company's* board:
 * the input is which employer to read. These adapters answer a different
 * question — which jobs anywhere match this text and place — so the input is a
 * query and the output is ranked-by-recency across employers. Forcing both
 * through one signature would make `identifier` mean two things, and the
 * import route's "which company" prompt would start lying about what it does.
 *
 * What they deliberately share is `ImportedJob`. A search result a person
 * saves becomes a row in `job_seeker_jobs` through exactly the same normalized
 * shape and the same bounds, so there is one definition of what a stored job
 * is regardless of which door it came through.
 */

import type { ImportedJob } from "@/lib/job-seeker/import-adapters";

/** What a person typed, after validation. */
export type BoardSearchQuery = Readonly<{
  /** Free text. Empty is allowed: some boards list recent postings for it. */
  text: string;
  /** Free-text place, passed to whichever field the board uses for it. */
  location: string | null;
  /** How many results to return, already clamped by the route. */
  limit: number;
}>;

/**
 * One posting a board returned.
 *
 * `job` is the part that can become a stored row; everything beside it is
 * board-specific context that is worth showing and not worth storing, because
 * `job_seeker_jobs` has no column for it and inventing one per board is how a
 * schema becomes a union of six vendors.
 */
export type BoardSearchHit = Readonly<{
  job: ImportedJob;
  /** ISO date the board published it, when it says. */
  publishedOn: string | null;
  /** ISO date applications close, when it says. */
  closesOn: string | null;
  /**
   * For aggregator boards: the site that actually hosts this posting
   * ("LinkedIn", "Indeed", …), as the aggregator states it. Absent for
   * boards that host their own postings — the board IS the publisher there,
   * and repeating its name would say nothing.
   */
  publisher?: string | null;
}>;

/**
 * One board's answer.
 *
 * `totalAvailable` is the board's own count, not `hits.length`. A person who
 * asked for 25 of 812 needs to see 812, and reporting the page size as the
 * total is the quiet way to make a search look exhaustive when it is a sample.
 * `null` means the board did not say — which is not the same as zero and must
 * not be rendered as one.
 */
export type BoardSearchResult = Readonly<{
  board: string;
  hits: readonly BoardSearchHit[];
  totalAvailable: number | null;
}>;

export type BoardSearchErrorCode =
  /** The board answered, but not in the shape its parser knows. */
  | "board_response_unreadable"
  /** The board refused, timed out, or was unreachable within the deadline. */
  | "board_unreachable"
  /** The query cannot be sent to this board as written. */
  | "query_invalid";

/**
 * A typed failure, so the route answers with a reason rather than a 500.
 *
 * The source CLIs threw bare `Error` and printed `{error, code}` to stderr,
 * which is right for a terminal and useless to an HTTP boundary. This carries
 * the board that failed, because "search failed" across five boards tells a
 * person nothing about whether to retry or to try elsewhere.
 */
export class BoardSearchError extends Error {
  constructor(
    readonly code: BoardSearchErrorCode,
    readonly board: string,
    message: string,
  ) {
    super(message);
    this.name = "BoardSearchError";
  }
}

/**
 * The seams a test replaces: the clock, the wait, the jitter, the fetch.
 *
 * Every adapter takes these and every adapter defaults them to the real ones,
 * so a test can drive a retry, a deadline or a malformed payload without a
 * network and without a real second passing. Production never passes them.
 */
export type BoardFetchOverrides = Readonly<{
  deadlineMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  fetchImpl?: typeof fetch;
}>;

/** What a board adapter is. */
export type BoardSearchAdapter = Readonly<{
  /** Recorded as `job_seeker_jobs.source`; must match that column's CHECK. */
  key: string;
  name: string;
  summary: string;
  /** Where this board's postings actually are, stated rather than implied. */
  coverage: string;
  /** Whether the board can truthfully apply the route's free-text place. */
  supportsLocation: boolean;
  search: (query: BoardSearchQuery, overrides?: BoardFetchOverrides) => Promise<BoardSearchResult>;
}>;
