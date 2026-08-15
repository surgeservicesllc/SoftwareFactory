import { dedupeBy } from "@/lib/graph/reducers";

/**
 * Discovery graphs.
 *
 * Some investigations have no knowable size up front: find every route missing
 * auth, and each answer suggests where to look next. The shape is rounds —
 * discover, dedupe, verify, generate the next round — and the danger is that it
 * never stops, because there is always one more place to look.
 *
 * So a discovery graph cannot run without stop conditions, and the conditions
 * are checked before each round rather than after, so a budget is never
 * overshot by exactly one expensive round.
 */

export const DISCOVERY_STOP_REASONS = [
  "NO_NEW_VERIFIED_ITEMS",
  "MAX_ROUNDS_REACHED",
  "BUDGET_EXHAUSTED",
  "OWNER_CANCELLED",
  "POLICY_BLOCKED",
] as const;
export type DiscoveryStopReason = (typeof DISCOVERY_STOP_REASONS)[number];

export type DiscoveryPolicy = {
  readonly maxRounds: number;
  /** Stop after this many consecutive rounds that verified nothing new. */
  readonly quietRoundsBeforeStop: number;
};

export const DEFAULT_DISCOVERY_POLICY: DiscoveryPolicy = Object.freeze({
  maxRounds: 5,
  quietRoundsBeforeStop: 2,
});

export type DiscoveryRound = {
  readonly round: number;
  /** Items this round verified. Unverified candidates never count as new. */
  readonly verifiedItems: readonly string[];
};

export type DiscoveryState = {
  readonly rounds: readonly DiscoveryRound[];
  /** Every distinct verified item found so far. */
  readonly knownItems: readonly string[];
  readonly consecutiveQuietRounds: number;
};

export function emptyDiscoveryState(): DiscoveryState {
  return { rounds: [], knownItems: [], consecutiveQuietRounds: 0 };
}

/**
 * Fold a round's findings into the state.
 *
 * Only *verified* items count toward progress. Without that, a discovery loop
 * sustains itself indefinitely on plausible-looking candidates that never
 * survive checking — the machine equivalent of mistaking activity for progress.
 */
export function recordRound(
  state: DiscoveryState,
  verifiedItems: readonly string[],
  policy: DiscoveryPolicy = DEFAULT_DISCOVERY_POLICY,
): DiscoveryState {
  void policy;
  const known = new Set(state.knownItems);
  const genuinelyNew = dedupeBy(
    verifiedItems.filter((item) => !known.has(item)),
    (item) => item,
  ).items;

  const round: DiscoveryRound = {
    round: state.rounds.length + 1,
    verifiedItems: genuinelyNew,
  };

  return {
    rounds: [...state.rounds, round],
    knownItems: [...state.knownItems, ...genuinelyNew],
    consecutiveQuietRounds:
      genuinelyNew.length === 0 ? state.consecutiveQuietRounds + 1 : 0,
  };
}

export type DiscoveryDecision = {
  readonly shouldContinue: boolean;
  readonly stopReason: DiscoveryStopReason | null;
  readonly detail: string;
};

export type DiscoveryConditions = {
  readonly budgetExhausted?: boolean;
  readonly ownerCancelled?: boolean;
  readonly policyBlocked?: boolean;
};

/** Decide whether another round may run. Checked *before* spending on one. */
export function shouldContinueDiscovery(
  state: DiscoveryState,
  policy: DiscoveryPolicy = DEFAULT_DISCOVERY_POLICY,
  conditions: DiscoveryConditions = {},
): DiscoveryDecision {
  if (conditions.ownerCancelled) {
    return {
      shouldContinue: false,
      stopReason: "OWNER_CANCELLED",
      detail: "The owner cancelled the graph.",
    };
  }

  if (conditions.policyBlocked) {
    return {
      shouldContinue: false,
      stopReason: "POLICY_BLOCKED",
      detail: "A policy blocked further discovery.",
    };
  }

  if (conditions.budgetExhausted) {
    return {
      shouldContinue: false,
      stopReason: "BUDGET_EXHAUSTED",
      detail: `Budget exhausted after ${state.rounds.length} round(s).`,
    };
  }

  if (state.rounds.length >= policy.maxRounds) {
    return {
      shouldContinue: false,
      stopReason: "MAX_ROUNDS_REACHED",
      detail: `Reached the ceiling of ${policy.maxRounds} rounds.`,
    };
  }

  if (state.consecutiveQuietRounds >= policy.quietRoundsBeforeStop) {
    return {
      shouldContinue: false,
      stopReason: "NO_NEW_VERIFIED_ITEMS",
      detail: `${state.consecutiveQuietRounds} consecutive round(s) verified nothing new, so the search has converged.`,
    };
  }

  return {
    shouldContinue: true,
    stopReason: null,
    detail: `Round ${state.rounds.length + 1} of at most ${policy.maxRounds}.`,
  };
}
