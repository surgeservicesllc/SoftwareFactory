/**
 * Observed performance, and the discipline of admitting when there is none.
 *
 * Every number here comes from a recorded run. Nothing is estimated, defaulted
 * to a flattering value, or carried over from a similar-looking candidate. When
 * a candidate has fewer than `MINIMUM_SAMPLES` recorded runs for a task class,
 * this module returns `null` and says `INSUFFICIENT_HISTORY` — the caller then
 * routes on declared capability and configured preference instead.
 *
 * That threshold is the whole point. Routing on a 100% success rate drawn from
 * one run is not learning; it is noise with a confident face on it.
 */

/** Recorded runs required before observed history may influence routing. */
export const MINIMUM_SAMPLES = 5;

/** Runs required before a *material* preference change is allowed. */
export const MINIMUM_SAMPLES_FOR_PREFERENCE_CHANGE = 20;

export interface RunOutcome {
  readonly succeeded: boolean;
  readonly durationMs: number;
  readonly retries: number;
  /** Null when the step does not run verification, not when it failed. */
  readonly verificationPassed: boolean | null;
  readonly reviewRequestedChanges: boolean | null;
  /** Null when the provider reported no usage, which is common and not an error. */
  readonly costUsd: number | null;
  readonly failureType: string | null;
}

export interface ObservedPerformance {
  readonly samples: number;
  readonly successRate: number;
  readonly medianDurationMs: number;
  readonly verificationPassRate: number | null;
  readonly reviewRejectionRate: number | null;
  readonly meanCostUsd: number | null;
  readonly retryRate: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * Summarize recorded outcomes, or return null when there are too few to mean
 * anything. Rates over sub-populations (verification, review, cost) are
 * themselves null when that sub-population is empty, so "no review data" never
 * reads as "no rejections".
 */
export function summarizePerformance(outcomes: readonly RunOutcome[]): ObservedPerformance | null {
  if (outcomes.length < MINIMUM_SAMPLES) return null;

  const verified = outcomes.filter((outcome) => outcome.verificationPassed !== null);
  const reviewed = outcomes.filter((outcome) => outcome.reviewRequestedChanges !== null);
  const costed = outcomes.filter((outcome) => outcome.costUsd !== null);

  return Object.freeze({
    samples: outcomes.length,
    successRate: outcomes.filter((outcome) => outcome.succeeded).length / outcomes.length,
    medianDurationMs: median(outcomes.map((outcome) => outcome.durationMs)),
    verificationPassRate: verified.length === 0
      ? null
      : verified.filter((outcome) => outcome.verificationPassed).length / verified.length,
    reviewRejectionRate: reviewed.length === 0
      ? null
      : reviewed.filter((outcome) => outcome.reviewRequestedChanges).length / reviewed.length,
    meanCostUsd: costed.length === 0
      ? null
      : costed.reduce((total, outcome) => total + (outcome.costUsd ?? 0), 0) / costed.length,
    retryRate: outcomes.reduce((total, outcome) => total + outcome.retries, 0) / outcomes.length,
  });
}

/* ------------------------------------------------------------- prediction */

export interface Prediction {
  readonly expectedSuccessRate: number | null;
  readonly expectedDurationMs: number | null;
  readonly expectedCostUsd: number | null;
  /** True when the prediction rests on observed runs rather than declaration. */
  readonly evidenced: boolean;
}

export function predictFrom(performance: ObservedPerformance | null): Prediction {
  if (!performance) {
    return Object.freeze({
      expectedSuccessRate: null,
      expectedDurationMs: null,
      expectedCostUsd: null,
      evidenced: false,
    });
  }
  return Object.freeze({
    expectedSuccessRate: performance.successRate,
    expectedDurationMs: performance.medianDurationMs,
    expectedCostUsd: performance.meanCostUsd,
    evidenced: true,
  });
}

/* ---------------------------------------------------------------- regret */

export interface RoutingRegret {
  /** Positive when the chosen worker did worse than predicted. */
  readonly successRegret: number | null;
  readonly durationRegretMs: number | null;
  readonly costRegretUsd: number | null;
  readonly comparable: boolean;
}

/**
 * Compare what routing expected against what actually happened.
 *
 * An unevidenced prediction produces no regret rather than a regret of zero:
 * routing that guessed cannot be scored as if it had been right.
 */
export function measureRegret(prediction: Prediction, actual: RunOutcome): RoutingRegret {
  if (!prediction.evidenced) {
    return Object.freeze({
      successRegret: null,
      durationRegretMs: null,
      costRegretUsd: null,
      comparable: false,
    });
  }

  return Object.freeze({
    successRegret: (prediction.expectedSuccessRate ?? 0) - (actual.succeeded ? 1 : 0),
    durationRegretMs: actual.durationMs - (prediction.expectedDurationMs ?? 0),
    costRegretUsd: prediction.expectedCostUsd === null || actual.costUsd === null
      ? null
      : actual.costUsd - prediction.expectedCostUsd,
    comparable: true,
  });
}

/**
 * Whether observed history is allowed to materially change a routing
 * preference. Deliberately stricter than the threshold for *using* history in a
 * single decision: shifting a standing preference on thin evidence is how a
 * router talks itself into a rut.
 */
export function mayChangePreference(
  candidate: ObservedPerformance | null,
  incumbent: ObservedPerformance | null,
): { readonly allowed: boolean; readonly reason: string } {
  if (!candidate || candidate.samples < MINIMUM_SAMPLES_FOR_PREFERENCE_CHANGE) {
    return {
      allowed: false,
      reason: `A preference change needs at least ${MINIMUM_SAMPLES_FOR_PREFERENCE_CHANGE} recorded runs for the candidate.`,
    };
  }
  if (!incumbent || incumbent.samples < MINIMUM_SAMPLES_FOR_PREFERENCE_CHANGE) {
    return {
      allowed: false,
      reason: `A preference change needs at least ${MINIMUM_SAMPLES_FOR_PREFERENCE_CHANGE} recorded runs for the incumbent to compare against.`,
    };
  }
  // Require a margin, not merely a higher number, so ordinary variance does not
  // flip a standing preference back and forth.
  if (candidate.successRate <= incumbent.successRate + 0.05) {
    return {
      allowed: false,
      reason: "The candidate does not beat the incumbent by a wide enough margin.",
    };
  }
  return { allowed: true, reason: "The candidate beats the incumbent on sufficient evidence." };
}
