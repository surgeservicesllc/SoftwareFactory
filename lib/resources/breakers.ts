/**
 * Circuit breakers for providers and models.
 *
 * A breaker exists so a provider having a bad hour stops absorbing work, and
 * so it is reconsidered automatically once the hour passes rather than staying
 * quietly excluded forever.
 *
 * Only observed failures open a breaker. With no observations every breaker is
 * closed, and the UI says so rather than implying health nobody measured.
 */

export const BREAKER_FAULTS = [
  "outage",
  "rate_limit",
  "malformed_output",
  "validation_failure",
  "excessive_latency",
] as const;

export type BreakerFault = (typeof BREAKER_FAULTS)[number];

export type BreakerState = "closed" | "open" | "half_open";

/** Consecutive faults of one kind before the breaker opens. */
export const FAULT_THRESHOLDS: Readonly<Record<BreakerFault, number>> = Object.freeze({
  // A rate limit is the provider telling us plainly to back off, so it needs
  // less corroboration than a symptom we inferred.
  rate_limit: 2,
  outage: 3,
  malformed_output: 3,
  validation_failure: 3,
  excessive_latency: 5,
});

/** How long a breaker stays open before one trial request is allowed. */
export const COOLDOWN_MS: Readonly<Record<BreakerFault, number>> = Object.freeze({
  rate_limit: 60_000,
  outage: 120_000,
  malformed_output: 300_000,
  validation_failure: 300_000,
  excessive_latency: 120_000,
});

export interface BreakerRecord {
  readonly target: string;
  readonly state: BreakerState;
  readonly fault: BreakerFault | null;
  readonly consecutiveFaults: number;
  readonly openedAt: number | null;
  readonly reason: string | null;
}

export function closedBreaker(target: string): BreakerRecord {
  return Object.freeze({
    target,
    state: "closed",
    fault: null,
    consecutiveFaults: 0,
    openedAt: null,
    reason: null,
  });
}

/** Fold one observed fault into a breaker. */
export function recordFault(
  breaker: BreakerRecord,
  fault: BreakerFault,
  now: number,
): BreakerRecord {
  // A different fault class restarts counting: three unrelated symptoms are not
  // evidence of one problem.
  const consecutive = breaker.fault === fault ? breaker.consecutiveFaults + 1 : 1;

  if (consecutive >= FAULT_THRESHOLDS[fault]) {
    return Object.freeze({
      target: breaker.target,
      state: "open",
      fault,
      consecutiveFaults: consecutive,
      openedAt: now,
      reason: `${consecutive} consecutive ${fault.replace(/_/g, " ")} failures.`,
    });
  }

  return Object.freeze({
    target: breaker.target,
    state: breaker.state === "open" ? "open" : "closed",
    fault,
    consecutiveFaults: consecutive,
    openedAt: breaker.openedAt,
    reason: breaker.reason,
  });
}

/** A success closes the breaker outright — recovery needs no ceremony. */
export function recordSuccess(breaker: BreakerRecord): BreakerRecord {
  return closedBreaker(breaker.target);
}

/**
 * Whether the target may take work now.
 *
 * After its cooldown an open breaker becomes half-open, which admits exactly
 * one trial request. If that succeeds the breaker closes; if it faults, the
 * next `recordFault` re-opens it with a fresh timer.
 */
export function evaluateBreaker(
  breaker: BreakerRecord,
  now: number,
): { readonly usable: boolean; readonly state: BreakerState; readonly reason: string | null } {
  if (breaker.state !== "open" || breaker.openedAt === null || breaker.fault === null) {
    return { usable: true, state: "closed", reason: null };
  }

  const elapsed = now - breaker.openedAt;
  if (elapsed >= COOLDOWN_MS[breaker.fault]) {
    return {
      usable: true,
      state: "half_open",
      reason: "Cooldown elapsed; allowing one trial request.",
    };
  }

  const remainingSeconds = Math.ceil((COOLDOWN_MS[breaker.fault] - elapsed) / 1000);
  return {
    usable: false,
    state: "open",
    reason: `${breaker.reason ?? "Suppressed"} Retrying in ${remainingSeconds}s.`,
  };
}

export const BREAKER_FAULT_EXPLANATIONS: Record<BreakerFault, string> = {
  outage: "The provider could not be reached or returned a server error.",
  rate_limit: "The provider rejected the request for exceeding its rate limit.",
  malformed_output: "The provider returned output that did not parse.",
  validation_failure: "The provider returned output that parsed but failed schema validation.",
  excessive_latency: "The provider responded far slower than its observed norm.",
};
