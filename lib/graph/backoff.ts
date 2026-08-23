/**
 * How long a retried node waits before it tries again.
 *
 * The engine already bounds *how many* times a node may attempt its work. What
 * it did not bound was how fast: a failed attempt set the node back to PENDING
 * and the next scheduling round started it immediately. Against a transient
 * fault that is fine. Against the two faults that actually happen — a rate
 * limit and a provider outage — it is the worst possible behaviour, because
 * every retry arrives while the condition that caused the failure is still
 * true, and burns an attempt proving it.
 *
 * Exponential, capped, and jittered. The cap exists because doubling without
 * one eventually exceeds the graph's whole duration budget, which would turn a
 * retry policy into a budget stop. The jitter exists because a fan-out of four
 * nodes that all failed on the same rate limit would otherwise retry in
 * lockstep forever — the classic thundering herd, and a fan-out engine is
 * exactly the place it happens.
 *
 * Pure: the randomness is injected, so a test can pin every delay.
 */

export type BackoffPolicy = {
  /** The delay after the first failed attempt, before jitter. */
  readonly baseMs: number;
  /** The ceiling. No delay exceeds this, however many attempts have failed. */
  readonly capMs: number;
  /**
   * How much of the computed delay is randomised, as a fraction of it.
   *
   * 0 is deterministic; 1 would spread retries across the whole window. A
   * quarter is enough to break lockstep between a handful of sibling nodes
   * without making the wait unpredictable to a person watching the run.
   */
  readonly jitter: number;
};

export const DEFAULT_BACKOFF: BackoffPolicy = Object.freeze({
  // Two seconds, then four, then eight. A model call that failed on a rate
  // limit is rarely clear again inside one second and rarely still limited
  // after thirty.
  baseMs: 2_000,
  capMs: 30_000,
  jitter: 0.25,
});

/**
 * The delay before `attempt` may start, where `attempt` is the one about to
 * run: attempt 1 is the first try and never waits.
 *
 * `random` returns a value in [0, 1). It is a parameter rather than a call to
 * `Math.random` so the delay is a pure function of its inputs, which is what
 * lets the schedule be asserted rather than sampled.
 */
export function retryDelayMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  if (attempt <= 1) return 0;

  // attempt 2 waits baseMs, attempt 3 waits 2x, attempt 4 waits 4x.
  const exponent = attempt - 2;
  // Computed before the cap so an absurd attempt number cannot overflow into
  // Infinity and then produce NaN when multiplied by the jitter fraction.
  const uncapped = policy.baseMs * 2 ** Math.min(exponent, 30);
  const capped = Math.min(uncapped, policy.capMs);

  if (policy.jitter <= 0) return Math.round(capped);

  // Jitter subtracts rather than adds, so the cap stays a real ceiling and a
  // policy that says "never more than thirty seconds" means it.
  const spread = capped * Math.min(policy.jitter, 1);
  return Math.round(capped - spread * random());
}

/** A sleep that a test can replace with something that does not take time. */
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
