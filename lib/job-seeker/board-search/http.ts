import { htmlToText as importHtmlToText } from "@/lib/job-seeker/import-adapters";
import { BoardSearchError } from "@/lib/job-seeker/board-search/types";

/**
 * The one outbound fetch every board adapter uses.
 *
 * Adapted from the retry helper each CLI in the MIT-licensed
 * `MadsLorentzen/ai-job-search` carried its own near-identical copy of
 * (`.agents/skills/<board>-search/cli/src/helpers.ts`). Six copies drifted:
 * one sent no User-Agent, one mapped 404 to "Job not found" and the rest did
 * not. One copy here, with the differences that actually matter passed in.
 *
 * ## The retry budget is deliberately smaller than the source's
 *
 * The source retried 6 times with a 500ms base doubling to a 5s cap plus
 * jitter, each attempt allowed 15s. A run of that can exceed a minute, which
 * is correct for a CLI a person left running and wrong here: this sits inside
 * an HTTP request someone is watching, and a search that takes a minute to
 * fail has already failed. So the budget is a wall-clock deadline for the
 * whole operation rather than a retry count — attempts stop when the deadline
 * cannot accommodate another one, and what a person waits is bounded by a
 * number stated here instead of emerging from arithmetic.
 *
 * Retries are confined to 429 and 5xx — the two answers that mean "ask again".
 * A 4xx is the board saying the request was wrong, and repeating a wrong
 * request is how a rate limit gets earned rather than avoided.
 */

/** Whole-operation budget, including every retry and the waits between them. */
export const SEARCH_DEADLINE_MS = 12_000;
/** One attempt's own timeout; never allowed to outlive the deadline. */
export const ATTEMPT_TIMEOUT_MS = 6_000;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 2_000;

/**
 * Identifies this application to the boards it reads.
 *
 * Named rather than disguised. The source CLIs sent
 * `Mozilla/5.0 (compatible; <board>-cli/1.0)`; the Mozilla prefix is a
 * compatibility convention rather than a claim to be a browser, and the
 * comment-bracketed identity is the part a board operator reads in a log. A
 * board that wants to refuse this traffic must be able to recognise it.
 */
export const USER_AGENT =
  "Mozilla/5.0 (compatible; SoftwareFactoryJobSeeker/1.0; +https://github.com/surgeservicesllc/SoftwareFactory)";

export type BoardFetchOptions = Readonly<{
  board: string;
  headers?: Readonly<Record<string, string>>;
  /** Present for the boards whose search is a POST. */
  body?: unknown;
  deadlineMs?: number;
  /** Injected in tests; production uses the real ones. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  fetchImpl?: typeof fetch;
}>;

function backoffFor(attempt: number, random: () => number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  // Jitter downward only. Spreading a fan-out of retries is the point; adding
  // to the delay would let a retry outlive the deadline it was measured against.
  return Math.round(exponential * (1 - 0.25 * random()));
}

async function boardFetch(url: string, options: BoardFetchOptions): Promise<Response> {
  const {
    board,
    headers = {},
    body,
    deadlineMs = SEARCH_DEADLINE_MS,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    fetchImpl = fetch,
  } = options;

  const startedAt = now();
  const remaining = () => deadlineMs - (now() - startedAt);

  let attempt = 0;
  let lastStatus: number | null = null;
  for (;;) {
    const left = remaining();
    if (left <= 0) break;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: body === undefined ? "application/json, text/html;q=0.9, */*;q=0.8" : "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "follow",
        signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, left)),
      });
    } catch {
      /*
       * A timeout or a DNS failure. Both are worth one more try inside the
       * deadline, and neither is worth reporting to a person as anything but
       * "the board did not answer" — the underlying message names hosts and
       * internals that mean nothing on a job search page.
       */
      if (remaining() <= BASE_BACKOFF_MS) {
        throw new BoardSearchError("board_unreachable", board, `${board} did not answer in time.`);
      }
      await sleep(Math.min(backoffFor(attempt, random), Math.max(0, remaining())));
      attempt += 1;
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      lastStatus = response.status;
      if (remaining() <= BASE_BACKOFF_MS) break;
      await sleep(Math.min(backoffFor(attempt, random), Math.max(0, remaining())));
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      throw new BoardSearchError(
        "board_unreachable",
        board,
        `${board} refused the request (${response.status}).`,
      );
    }
    return response;
  }

  throw new BoardSearchError(
    "board_unreachable",
    board,
    lastStatus === 429
      ? `${board} is rate limiting this search. Try again shortly.`
      : `${board} did not answer within ${Math.round(deadlineMs / 1000)}s.`,
  );
}

export async function fetchBoardJson<T>(url: string, options: BoardFetchOptions): Promise<T> {
  const response = await boardFetch(url, options);
  try {
    return (await response.json()) as T;
  } catch {
    throw new BoardSearchError(
      "board_response_unreadable",
      options.board,
      `${options.board} answered with something that is not JSON.`,
    );
  }
}

export async function fetchBoardText(url: string, options: BoardFetchOptions): Promise<string> {
  const response = await boardFetch(url, options);
  return response.text();
}

/**
 * Board descriptions arrive as HTML fragments; `job_seeker_jobs.description`
 * stores text.
 *
 * The conversion itself is `import-adapters.ts`'s, not a second copy. That one
 * already handles more block tags and double-encoded entities, and the source
 * repository's own lesson here was six near-identical helpers that drifted
 * apart — repeating that inside one feature would be worse, not better.
 *
 * The only thing added is the null: an absent description must stay absent
 * rather than becoming `""`, which renders as a description that exists and
 * says nothing.
 */
export function htmlToText(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;
  const text = importHtmlToText(html);
  return text.length === 0 ? null : text;
}
