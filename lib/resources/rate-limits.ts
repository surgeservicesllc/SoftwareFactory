/**
 * Rate accounting: how much work may start *per unit time*.
 *
 * `AI/PHASE_2C_IMPLEMENTATION_PLAN.md` recorded API/rate limits as PARTIAL once
 * per-provider concurrency existed, and the qualifier was the point: bounding
 * how many calls run *at once* does not bound how many are made *per minute*.
 * Short calls are the case that separates them. Six concurrent slots occupied by
 * calls lasting two seconds each is 180 requests a minute against a limit that
 * never sees more than six in flight — the concurrency cap is satisfied
 * throughout, and the provider still refuses.
 *
 * ## Why this is a separate gate rather than more capacity
 *
 * Concurrency asks "is a slot free?"; rate asks "has too much happened
 * recently?". The second question needs history the first one throws away: a
 * finished call releases its slot but must still count against the window it
 * happened in. Folding rate into `capacity.ts` would mean keeping completed work
 * in a structure whose whole contract is that finishing removes you from it.
 *
 * ## A rate limit knows when it clears
 *
 * This is the practically important difference, and it is why `retryAfterMs` is
 * on the verdict here and deliberately absent from the capacity verdict. A
 * concurrency refusal clears when some other run finishes, which nobody can
 * predict. A sliding-window refusal clears when the oldest event in the window
 * ages out — a time this function can compute exactly. A caller that knows the
 * wait can schedule; a caller that does not can only poll.
 *
 * ## Tokens are estimated, and estimates are labelled
 *
 * Token budgets are checked against an *estimate* supplied by the caller, since
 * the real count is only known after the call. An estimate that is too low
 * overruns the budget, so the reported usage marks how much of it is estimated
 * rather than observed. Recording an estimate as though it were a measurement is
 * the same error as inventing a success rate for a worker with no history, and
 * the rest of this subsystem already refuses to do that.
 */

export interface RateLimitPolicy {
  /** Length of the sliding window. */
  readonly windowMs: number;
  /** Requests permitted within one window. */
  readonly maxRequests: number;
  /**
   * Tokens permitted within one window, or null when the owner has not declared
   * a token budget. Null means "not limited on tokens" — never zero, which
   * would refuse everything.
   */
  readonly maxTokens: number | null;
}

/**
 * A minute-long window, because that is the unit providers actually publish
 * limits in. The numbers are deliberately conservative for the same reason the
 * capacity defaults are: a generous default is one nobody revisits, and the
 * first time it matters is an incident.
 */
export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = Object.freeze({
  windowMs: 60_000,
  maxRequests: 60,
  maxTokens: null,
});

export interface RateEvent {
  readonly provider: string;
  /** Epoch millis the request was made. */
  readonly at: number;
  /**
   * Tokens attributed to this request. `estimated` marks whether this is a
   * prediction or a measurement, so a window built from estimates cannot be
   * reported as though it were counted.
   */
  readonly tokens: number;
  readonly estimated: boolean;
}

export type RateRefusal = "REQUEST_RATE_EXCEEDED" | "TOKEN_RATE_EXCEEDED";

export interface RateUsage {
  readonly requests: number;
  readonly tokens: number;
  /** True when any event counted toward `tokens` was an estimate. */
  readonly tokensIncludeEstimates: boolean;
}

export interface RateVerdict {
  readonly admitted: boolean;
  readonly refusal: RateRefusal | null;
  readonly usage: RateUsage;
  readonly policy: RateLimitPolicy;
  /**
   * Millis until this refusal could clear, or null when admitted. Unlike a
   * concurrency refusal, this is computable: it is when the oldest event in the
   * window ages out.
   */
  readonly retryAfterMs: number | null;
}

/** Events for one provider still inside the window ending at `now`. */
export function eventsInWindow(
  events: readonly RateEvent[],
  provider: string,
  now: number,
  windowMs: number,
): readonly RateEvent[] {
  const floor = now - windowMs;
  // Strictly greater, so an event is retired exactly at `at + windowMs` rather
  // than one tick later. That makes the window half-open, [at, at + windowMs),
  // and lets `retryAfterMs` be the plain difference with no fudge factor -- an
  // off-by-one here is invisible until a caller waits the reported time and is
  // refused again, which turns a polite backoff into a hot loop.
  return events.filter((event) => event.provider === provider && event.at > floor);
}

export function rateUsage(
  events: readonly RateEvent[],
  provider: string,
  now: number,
  windowMs: number,
): RateUsage {
  const live = eventsInWindow(events, provider, now, windowMs);
  return Object.freeze({
    requests: live.length,
    tokens: live.reduce((total, event) => total + event.tokens, 0),
    tokensIncludeEstimates: live.some((event) => event.estimated),
  });
}

/**
 * When would enough events age out for one more to fit?
 *
 * For a request-count refusal, that is the moment the oldest event leaves the
 * window. For a token refusal it may take several: events are retired oldest
 * first until the freed tokens cover the shortfall. Returning "when the oldest
 * leaves" for the token case would under-report the wait and produce a caller
 * that retries too early, repeatedly, which is how a polite backoff turns into
 * a hot loop.
 */
function retryAfter(
  live: readonly RateEvent[],
  now: number,
  windowMs: number,
  needed: number,
  measure: (event: RateEvent) => number,
): number | null {
  if (live.length === 0) return null;
  const oldestFirst = [...live].sort((left, right) => left.at - right.at);

  let freed = 0;
  for (const event of oldestFirst) {
    freed += measure(event);
    if (freed >= needed) {
      // Exact, not padded: at `at + windowMs` this event has aged out.
      return Math.max(0, event.at + windowMs - now);
    }
  }
  return null;
}

/**
 * Decide whether one more request may be made against a provider now.
 *
 * Pure, and takes `now` from the caller, so the same history always yields the
 * same verdict — the property that makes a decision replayable rather than
 * dependent on when it happened to run.
 */
export function admitsRate(
  events: readonly RateEvent[],
  provider: string,
  now: number,
  estimatedTokens: number = 0,
  policy: RateLimitPolicy = DEFAULT_RATE_LIMIT_POLICY,
): RateVerdict {
  const live = eventsInWindow(events, provider, now, policy.windowMs);
  const usage = rateUsage(events, provider, now, policy.windowMs);

  if (usage.requests >= policy.maxRequests) {
    return Object.freeze({
      admitted: false,
      refusal: "REQUEST_RATE_EXCEEDED",
      usage,
      policy,
      retryAfterMs: retryAfter(live, now, policy.windowMs, usage.requests - policy.maxRequests + 1, () => 1),
    });
  }

  if (policy.maxTokens !== null && usage.tokens + estimatedTokens > policy.maxTokens) {
    const shortfall = usage.tokens + estimatedTokens - policy.maxTokens;
    return Object.freeze({
      admitted: false,
      refusal: "TOKEN_RATE_EXCEEDED",
      usage,
      policy,
      retryAfterMs: retryAfter(live, now, policy.windowMs, shortfall, (event) => event.tokens),
    });
  }

  return Object.freeze({ admitted: true, refusal: null, usage, policy, retryAfterMs: null });
}

/**
 * Record a request against the window, dropping what has aged out.
 *
 * Pruning here rather than only at read time keeps the retained history bounded
 * by the window instead of by uptime. A long-lived caller that only ever
 * appended would accumulate every request it had ever made and pay for that on
 * each check.
 */
export function recordRequest(
  events: readonly RateEvent[],
  event: RateEvent,
  windowMs: number = DEFAULT_RATE_LIMIT_POLICY.windowMs,
): readonly RateEvent[] {
  const floor = event.at - windowMs;
  return Object.freeze([...events.filter((entry) => entry.at > floor), event]);
}

/**
 * Replace an estimate with the count the provider actually reported.
 *
 * Matched on identity, so settling one of several identical estimates settles
 * exactly one. A call whose estimate is never settled still ages out of the
 * window on schedule; this only makes the accounting true in the meantime.
 */
export function settleTokens(
  events: readonly RateEvent[],
  estimate: RateEvent,
  actualTokens: number,
): readonly RateEvent[] {
  const index = events.indexOf(estimate);
  if (index === -1) return events;
  return Object.freeze(
    events.map((entry, position) =>
      position === index ? Object.freeze({ ...entry, tokens: actualTokens, estimated: false }) : entry,
    ),
  );
}

/**
 * Reject a policy that cannot mean what it says.
 *
 * `maxTokens: 0` is refused for the same reason a capacity limit of zero is:
 * it reads as "no token limit" to about half the people who see it and "no
 * tokens may be spent" to the other half. Null says the first one unambiguously.
 */
export function validatePolicy(policy: RateLimitPolicy): readonly string[] {
  const problems: string[] = [];
  if (!Number.isInteger(policy.windowMs) || policy.windowMs < 1_000) {
    problems.push("windowMs must be a whole number of at least 1000ms.");
  }
  if (!Number.isInteger(policy.maxRequests) || policy.maxRequests < 1) {
    problems.push("maxRequests must be a whole number of at least 1.");
  }
  if (policy.maxTokens !== null) {
    if (!Number.isInteger(policy.maxTokens) || policy.maxTokens < 1) {
      problems.push('maxTokens must be a whole number of at least 1, or null for "not limited on tokens"; 0 is ambiguous.');
    }
  }
  return Object.freeze(problems);
}
