/**
 * Retry bounds for the loop.
 *
 * A loop that retries without a ceiling is the failure mode that turns one bad
 * change into an outage: it burns budget, floods the provider, and hides the
 * original fault behind noise. Every retryable stage therefore carries an
 * explicit attempt cap, and exhausting it escalates to a human rather than
 * trying once more.
 *
 * Phase 1E already caps repair attempts at three in the database. This module
 * is the same rule for the decision layer, so the cap does not exist in only
 * one of the two halves.
 */

export const MAX_ATTEMPTS = Object.freeze({
  /** Writing the change. Expensive, and a third failure is a design problem. */
  implement: 3,
  /** Re-running verification. Cheap, but a flaky suite must not spin forever. */
  verify: 3,
  /** Re-running the reviewing agents. Deterministic, so more than one is odd. */
  review: 2,
  /** Repair work, matching Phase 1E's database-enforced cap. */
  repair: 3,
});

export type RetryableStage = keyof typeof MAX_ATTEMPTS;

export type RetryDecision = "RETRY" | "ESCALATE" | "STOP";

export interface RetryOutcome {
  readonly decision: RetryDecision;
  readonly attemptsUsed: number;
  readonly attemptsRemaining: number;
  readonly reason: string;
  /** Seconds to wait before the next attempt. Zero when not retrying. */
  readonly backoffSeconds: number;
}

/** Exponential, capped. Deterministic so a test can assert the schedule. */
function backoffFor(attempt: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempt - 1), 900);
}

export function isRetryableStage(value: unknown): value is RetryableStage {
  return typeof value === "string" && value in MAX_ATTEMPTS;
}

/**
 * Decide whether a failed stage may be tried again.
 *
 * `attemptsUsed` counts attempts already made, so the first failure arrives as
 * `1`. A permanent failure never retries regardless of the budget: re-running a
 * change that was refused on policy grounds cannot produce a different answer,
 * and pretending otherwise wastes the budget that a genuinely flaky failure
 * needs.
 */
export function evaluateRetry(
  stage: RetryableStage,
  attemptsUsed: number,
  options: { readonly permanent?: boolean } = {},
): RetryOutcome {
  const limit = MAX_ATTEMPTS[stage];
  const used = Math.max(0, Math.trunc(attemptsUsed));
  const remaining = Math.max(0, limit - used);

  if (options.permanent) {
    return Object.freeze({
      decision: "STOP",
      attemptsUsed: used,
      attemptsRemaining: remaining,
      reason: "The failure is permanent; retrying cannot change the outcome.",
      backoffSeconds: 0,
    });
  }

  if (remaining <= 0) {
    return Object.freeze({
      decision: "ESCALATE",
      attemptsUsed: used,
      attemptsRemaining: 0,
      reason: `All ${limit} attempts at ${stage} are used; escalating instead of retrying.`,
      backoffSeconds: 0,
    });
  }

  return Object.freeze({
    decision: "RETRY",
    attemptsUsed: used,
    attemptsRemaining: remaining,
    reason: `${remaining} of ${limit} attempts at ${stage} remain.`,
    backoffSeconds: backoffFor(used),
  });
}
