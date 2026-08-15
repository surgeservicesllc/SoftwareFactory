/**
 * Graph budgets.
 *
 * A graph engine's characteristic failure is not crashing — it is quietly
 * spending. Fan-out multiplies, discovery generates more rounds, retries stack,
 * and each individual decision looks reasonable. Budgets are the ceiling that
 * makes the total bounded rather than emergent.
 *
 * Cost is only ever reported when there is real usage and real declared
 * pricing behind it. A graph that cannot compute its spend says so; it never
 * estimates one, because a fabricated number is worse than an absent one — it
 * gets believed.
 */

export type GraphBudget = {
  readonly maxNodes: number;
  readonly maxConcurrentNodes: number;
  readonly maxDurationMs: number;
  readonly maxRetries: number;
  readonly maxDiscoveryRounds: number;
  /** Omitted when the provider does not report token usage. */
  readonly maxTokens?: number;
  /** Omitted unless real pricing exists for every model in play. */
  readonly maxCostMicros?: number;
};

export const DEFAULT_GRAPH_BUDGET: GraphBudget = Object.freeze({
  maxNodes: 50,
  maxConcurrentNodes: 8,
  maxDurationMs: 30 * 60_000,
  maxRetries: 10,
  maxDiscoveryRounds: 5,
});

export type GraphSpend = {
  readonly nodesStarted: number;
  readonly elapsedMs: number;
  readonly retriesUsed: number;
  readonly discoveryRounds: number;
  readonly tokensUsed?: number;
  /** Only present when every model involved had declared pricing. */
  readonly costMicros?: number;
};

export const BUDGET_ACTIONS = [
  "CONTINUE",
  "REDUCE_CONCURRENCY",
  "PREFER_CHEAPER_MODEL",
  "STOP_GRACEFULLY",
] as const;
export type BudgetAction = (typeof BUDGET_ACTIONS)[number];

export type BudgetAssessment = {
  readonly action: BudgetAction;
  readonly exhausted: readonly string[];
  readonly approaching: readonly string[];
  readonly reasons: readonly string[];
  /** Concurrency the graph should use now, never above the budget. */
  readonly allowedConcurrency: number;
};

/** Fraction of a limit at which the engine starts degrading rather than waiting to hit it. */
const APPROACH_THRESHOLD = 0.8;

function ratio(used: number, limit: number): number {
  return limit <= 0 ? 1 : used / limit;
}

export function assessBudget(budget: GraphBudget, spend: GraphSpend): BudgetAssessment {
  const exhausted: string[] = [];
  const approaching: string[] = [];
  const reasons: string[] = [];

  const check = (name: string, used: number, limit: number | undefined) => {
    if (limit === undefined) return;
    const r = ratio(used, limit);
    if (r >= 1) {
      exhausted.push(name);
      reasons.push(`${name}: ${used} of ${limit} — exhausted.`);
    } else if (r >= APPROACH_THRESHOLD) {
      approaching.push(name);
      reasons.push(`${name}: ${used} of ${limit} — approaching the limit.`);
    }
  };

  check("nodes", spend.nodesStarted, budget.maxNodes);
  check("duration", spend.elapsedMs, budget.maxDurationMs);
  check("retries", spend.retriesUsed, budget.maxRetries);
  check("discoveryRounds", spend.discoveryRounds, budget.maxDiscoveryRounds);
  if (spend.tokensUsed !== undefined) check("tokens", spend.tokensUsed, budget.maxTokens);
  // Only assessed against real, declared spend. No estimate is ever invented.
  if (spend.costMicros !== undefined) check("cost", spend.costMicros, budget.maxCostMicros);

  if (exhausted.length > 0) {
    return {
      action: "STOP_GRACEFULLY",
      exhausted,
      approaching,
      reasons: [
        ...reasons,
        "Stopping gracefully: completed work is kept and reported as partial rather than discarded.",
      ],
      allowedConcurrency: 0,
    };
  }

  if (approaching.length > 0) {
    // Cost and token pressure is best relieved by cheaper models; wall-clock
    // and node pressure by narrowing concurrency.
    const spendPressure = approaching.some((name) => name === "tokens" || name === "cost");
    const halved = Math.max(1, Math.floor(budget.maxConcurrentNodes / 2));

    return {
      action: spendPressure ? "PREFER_CHEAPER_MODEL" : "REDUCE_CONCURRENCY",
      exhausted,
      approaching,
      reasons: [
        ...reasons,
        spendPressure
          ? "Routing should prefer the cheapest model still eligible for each node."
          : `Concurrency reduced to ${halved} to leave headroom.`,
      ],
      allowedConcurrency: spendPressure ? budget.maxConcurrentNodes : halved,
    };
  }

  return {
    action: "CONTINUE",
    exhausted,
    approaching,
    reasons: ["Within budget."],
    allowedConcurrency: budget.maxConcurrentNodes,
  };
}

/**
 * Real cost, or nothing.
 *
 * Returns `null` when any model in the graph has no declared price, because a
 * partial total presented as a total is a fabrication.
 */
export function computeCostMicros(
  usage: readonly { readonly model: string; readonly inputTokens: number; readonly outputTokens: number }[],
  pricing: Readonly<Record<string, { readonly inputPerMillionMicros: number; readonly outputPerMillionMicros: number }>>,
): number | null {
  let total = 0;
  for (const entry of usage) {
    const price = pricing[entry.model];
    if (!price) return null;
    total +=
      (entry.inputTokens / 1_000_000) * price.inputPerMillionMicros +
      (entry.outputTokens / 1_000_000) * price.outputPerMillionMicros;
  }
  return Math.round(total);
}
