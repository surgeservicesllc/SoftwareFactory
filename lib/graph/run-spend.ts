/**
 * How a run's spend reads on a page.
 *
 * One module because three surfaces show it and a run must not read as
 * costing one thing on the panel and another on its own page.
 *
 * Every function here answers `null` for `null` rather than a zero. A run
 * whose nodes never reported usage has no measurement, and "$0.00" is a
 * measurement — the strongest claim on the page, made from the absence of
 * data. The callers render nothing, or say "not recorded", instead.
 */

/** Micro-dollars as money. Sub-cent runs keep their precision. */
export function formatCost(costMicros: number | null | undefined): string | null {
  if (typeof costMicros !== "number" || !Number.isFinite(costMicros)) return null;
  const dollars = costMicros / 1_000_000;
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Tokens, grouped, because six digits unseparated are unreadable. */
export function formatTokens(tokensUsed: number | null | undefined): string | null {
  if (typeof tokensUsed !== "number" || !Number.isFinite(tokensUsed)) return null;
  return tokensUsed.toLocaleString("en-US");
}

/**
 * What the budget did, in words.
 *
 * The four values the column permits, said as what happened rather than as
 * the enum. An unrecognized value is returned as-is: a new action the
 * database learns before this list does should appear, not disappear.
 */
export function budgetActionLabel(action: string | null | undefined): string | null {
  if (!action) return null;
  switch (action) {
    case "CONTINUE":
      return "Ran within budget";
    case "REDUCE_CONCURRENCY":
      return "Slowed down to stay in budget";
    case "PREFER_CHEAPER_MODEL":
      return "Switched to a cheaper model";
    case "STOP_GRACEFULLY":
      return "Stopped on budget";
    default:
      return action;
  }
}

/** Whether the budget did anything worth drawing attention to. */
export function budgetActionIsNotable(action: string | null | undefined): boolean {
  return action === "REDUCE_CONCURRENCY"
    || action === "PREFER_CHEAPER_MODEL"
    || action === "STOP_GRACEFULLY";
}
