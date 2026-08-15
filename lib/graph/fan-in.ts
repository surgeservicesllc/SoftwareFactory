import { batch } from "@/lib/graph/reducers";

/**
 * Fan-in guards.
 *
 * This module exists because of one specific, quiet failure: twenty nodes are
 * dispatched, nineteen return, and the synthesis step confidently writes up
 * nineteen results as though they were all of them. Nothing errors. The report
 * looks complete. The missing node was the one that mattered.
 *
 * So every fan-in states what it expected, compares it against what arrived,
 * and refuses to call itself complete when those differ. A synthesis step is
 * always told whether its inputs are whole (§14), and long result sets are
 * layered rather than truncated (§13) — because silently dropping the tail is
 * the same failure wearing a different hat.
 */

export const FAN_IN_STATUSES = ["COMPLETE", "PARTIAL_INPUT", "EMPTY"] as const;
export type FanInStatus = (typeof FAN_IN_STATUSES)[number];

export type FanInResult<T> = {
  readonly status: FanInStatus;
  readonly items: readonly T[];
  readonly expectedNodes: readonly string[];
  readonly completedNodes: readonly string[];
  readonly failedNodes: readonly string[];
  readonly missingNodes: readonly string[];
  /** Safe to present as a whole answer. False whenever anything is missing. */
  readonly isWhole: boolean;
};

export type NodeOutcome<T> = {
  readonly nodeId: string;
  readonly status: "COMPLETED" | "FAILED";
  readonly items?: readonly T[];
};

/**
 * Collect fan-out results and state plainly whether they are all of them.
 *
 * A node that completed but returned nothing is *not* missing — it ran and had
 * nothing to say. A node that never reported is missing. Conflating the two is
 * how a graph convinces itself it is finished.
 */
export function collectFanIn<T>(
  expectedNodes: readonly string[],
  outcomes: readonly NodeOutcome<T>[],
): FanInResult<T> {
  const reported = new Map(outcomes.map((outcome) => [outcome.nodeId, outcome]));

  const completedNodes: string[] = [];
  const failedNodes: string[] = [];
  const missingNodes: string[] = [];
  const items: T[] = [];

  for (const nodeId of expectedNodes) {
    const outcome = reported.get(nodeId);
    if (!outcome) {
      missingNodes.push(nodeId);
      continue;
    }
    if (outcome.status === "FAILED") {
      failedNodes.push(nodeId);
      continue;
    }
    completedNodes.push(nodeId);
    items.push(...(outcome.items ?? []));
  }

  const isWhole = missingNodes.length === 0 && failedNodes.length === 0;
  const status: FanInStatus = !isWhole
    ? "PARTIAL_INPUT"
    : items.length === 0
      ? "EMPTY"
      : "COMPLETE";

  return {
    status,
    items,
    expectedNodes,
    completedNodes,
    failedNodes,
    missingNodes,
    isWhole,
  };
}

export type LayeredFanInPolicy = {
  /** Above this many items, batch rather than synthesising in one pass. */
  readonly maxItemsPerSynthesis: number;
  /** Items per batch when layering. */
  readonly batchSize: number;
  /** Hard ceiling on layers, so layering cannot itself run away. */
  readonly maxLayers: number;
};

export const DEFAULT_LAYERED_FAN_IN: LayeredFanInPolicy = Object.freeze({
  maxItemsPerSynthesis: 50,
  batchSize: 20,
  maxLayers: 3,
});

export type LayeredPlan<T> = {
  /** True when the caller may synthesise `items` in a single pass. */
  readonly direct: boolean;
  readonly batches: readonly (readonly T[])[];
  readonly layers: number;
  readonly detail: string;
};

/**
 * Decide how to fold a result set into a synthesis step.
 *
 * Never truncates. If the set is too large for one pass it is batched, and if
 * the batch count is itself too large the caller is told how many layers it
 * implies rather than being handed a silently shortened list.
 */
export function planLayeredFanIn<T>(
  items: readonly T[],
  policy: LayeredFanInPolicy = DEFAULT_LAYERED_FAN_IN,
): LayeredPlan<T> {
  if (items.length <= policy.maxItemsPerSynthesis) {
    return {
      direct: true,
      batches: [items],
      layers: 1,
      detail: `${items.length} items fit in one synthesis pass.`,
    };
  }

  const batches = batch(items, policy.batchSize);
  let layers = 2;
  let width = batches.length;
  while (width > policy.maxItemsPerSynthesis && layers < policy.maxLayers) {
    width = Math.ceil(width / policy.batchSize);
    layers += 1;
  }

  return {
    direct: false,
    batches,
    layers,
    detail:
      `${items.length} items exceed the ${policy.maxItemsPerSynthesis}-item synthesis limit, ` +
      `so they are summarised as ${batches.length} batches across ${layers} layers. ` +
      "Nothing is discarded.",
  };
}

/**
 * A sentence a synthesis step must carry when its inputs were incomplete.
 *
 * Returned as text on purpose: the caveat has to travel with the finding into
 * the report, not sit in a field somebody forgets to render.
 */
export function incompletenessNotice(result: FanInResult<unknown>): string | null {
  if (result.isWhole) return null;

  const parts: string[] = [];
  if (result.missingNodes.length > 0) {
    parts.push(`${result.missingNodes.length} node(s) never reported (${result.missingNodes.join(", ")})`);
  }
  if (result.failedNodes.length > 0) {
    parts.push(`${result.failedNodes.length} node(s) failed (${result.failedNodes.join(", ")})`);
  }

  return (
    `Incomplete input: ${parts.join("; ")}. ` +
    `${result.completedNodes.length} of ${result.expectedNodes.length} expected nodes contributed. ` +
    "These results are a partial view and must not be presented as a complete answer."
  );
}
