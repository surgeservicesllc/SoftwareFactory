import { assessBudget, type BudgetAssessment, type GraphBudget, type GraphSpend } from "@/lib/graph/budgets";
import type { CompiledGraph, CompiledNode } from "@/lib/graph/compiler";
import { applyDecision, initialState, progress, tick, transition, type GraphState } from "@/lib/graph/scheduler";
import { collectFanIn, incompletenessNotice, type NodeOutcome } from "@/lib/graph/fan-in";
import { resourceKey, type NodeState } from "@/lib/graph/types";

/**
 * The node runner.
 *
 * This is the loop that turns a compiled graph into a sequence of executions.
 * Everything it does *not* do is as deliberate as what it does: it holds no
 * provider client, opens no connection, and reads no clock of its own.
 * Execution, time, and locking are injected, which is what lets the whole of
 * the graph engine's behaviour — retry, fallback, budget degradation, partial
 * completion — be tested without a credential or a network.
 *
 * The runner owns four responsibilities the scheduler deliberately does not:
 *
 *   1. Attempts and retries, bounded by the node's own policy.
 *   2. Output validation, so a node that returns the wrong shape fails rather
 *      than poisoning everything downstream.
 *   3. Budget assessment between ticks, so a graph degrades before it
 *      overspends rather than after.
 *   4. Deciding, at the end, whether the run may call itself complete.
 */

export type NodeExecutionResult =
  | {
      readonly status: "SUCCEEDED";
      readonly output: unknown;
      readonly provider?: string;
      readonly model?: string;
      readonly latencyMs?: number;
      readonly tokensUsed?: number;
      readonly costMicros?: number;
    }
  | {
      readonly status: "FAILED";
      readonly error: string;
      /** Whether trying a different provider could plausibly help. */
      readonly retryable: boolean;
      readonly provider?: string;
      readonly model?: string;
      readonly latencyMs?: number;
      /**
       * A failed call still costs money. Omitting usage here would let retries
       * spend the budget invisibly, which is exactly the direction a graph
       * engine overspends in.
       */
      readonly tokensUsed?: number;
      readonly costMicros?: number;
    };

export type RunnerDependencies = {
  /** Runs one node. Injected so the runner needs no provider to be tested. */
  readonly executeNode: (
    node: CompiledNode,
    attempt: number,
  ) => Promise<NodeExecutionResult>;
  /** Validates a node's output against its contract. */
  readonly validateOutput?: (node: CompiledNode, output: unknown) => { valid: boolean; issues: readonly string[] };
  /** Monotonic elapsed milliseconds. Injected so budgets are testable. */
  readonly elapsedMs?: () => number;
  readonly onEvent?: (event: RunnerEvent) => void;
};

export type RunnerEvent = {
  readonly type:
    | "node_started"
    | "node_succeeded"
    | "node_failed"
    | "node_retrying"
    | "node_blocked"
    | "node_output_rejected"
    | "budget_degraded"
    | "budget_stopped";
  readonly nodeKey?: string;
  readonly detail: string;
};

export const RUN_OUTCOMES = [
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "BUDGET_STOPPED",
  "STALLED",
] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export type RunResult = {
  readonly outcome: RunOutcome;
  readonly states: ReadonlyMap<string, NodeState>;
  readonly outputs: ReadonlyMap<string, unknown>;
  readonly spend: GraphSpend;
  readonly lastBudgetAssessment: BudgetAssessment;
  readonly percentComplete: number;
  /** Present whenever the run could not account for every node. */
  readonly incompleteness: string | null;
  readonly events: readonly RunnerEvent[];
};

export async function runGraph(
  graph: CompiledGraph,
  budget: GraphBudget,
  deps: RunnerDependencies,
): Promise<RunResult> {
  const nodesByKey = new Map(graph.nodes.map((node) => [node.nodeKey, node]));
  const schedulerNodes = graph.nodes.map((node) => ({
    nodeId: node.nodeKey,
    writes: node.writes,
  }));

  let state: GraphState = initialState(
    schedulerNodes as unknown as Parameters<typeof initialState>[0],
  );

  const outputs = new Map<string, unknown>();
  const events: RunnerEvent[] = [];
  const attemptsByNode = new Map<string, number>();
  const elapsed = deps.elapsedMs ?? (() => 0);

  const emit = (event: RunnerEvent) => {
    events.push(event);
    deps.onEvent?.(event);
  };

  let nodesStarted = 0;
  let retriesUsed = 0;
  let tokensUsed: number | undefined;
  let costMicros: number | undefined;
  let concurrency = budget.maxConcurrentNodes;

  const spendNow = (): GraphSpend => ({
    nodesStarted,
    elapsedMs: elapsed(),
    retriesUsed,
    discoveryRounds: 0,
    tokensUsed,
    costMicros,
  });

  let assessment = assessBudget(budget, spendNow());
  let stoppedByBudget = false;

  // Bounded by node count and attempts, so a pathological graph cannot spin.
  const maxIterations = budget.maxNodes * (Math.max(1, budget.maxRetries) + 2) + 10;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    assessment = assessBudget(budget, spendNow());

    if (assessment.action === "STOP_GRACEFULLY") {
      stoppedByBudget = true;
      emit({
        type: "budget_stopped",
        detail: `Budget exhausted (${assessment.exhausted.join(", ")}). Completed work is kept.`,
      });
      break;
    }

    if (assessment.action === "REDUCE_CONCURRENCY" && assessment.allowedConcurrency < concurrency) {
      concurrency = assessment.allowedConcurrency;
      emit({
        type: "budget_degraded",
        detail: `Concurrency reduced to ${concurrency}: ${assessment.approaching.join(", ")}.`,
      });
    }

    const decision = tick(
      schedulerNodes as unknown as Parameters<typeof tick>[0],
      graph.edges,
      state,
      { maxConcurrent: concurrency },
    );

    for (const blocked of decision.blocked) {
      emit({ type: "node_blocked", nodeKey: blocked.nodeId, detail: blocked.because });
    }

    if (decision.complete || decision.stalled) {
      state = applyDecision(state, decision);
      break;
    }

    if (decision.start.length === 0) {
      // Nothing startable and nothing running: only deferrals remain, which
      // cannot clear on their own. Treat it as stalled rather than looping.
      if (decision.deferred.length > 0 && state.running.size === 0) {
        state = applyDecision(state, decision);
        break;
      }
      state = applyDecision(state, decision);
      continue;
    }

    state = applyDecision(state, decision);

    // Independent nodes run concurrently; that concurrency is the entire point
    // of having removed the fake edges upstream.
    const results = await Promise.all(
      decision.start.map(async (nodeKey) => {
        const node = nodesByKey.get(nodeKey)!;
        const attempt = (attemptsByNode.get(nodeKey) ?? 0) + 1;
        attemptsByNode.set(nodeKey, attempt);
        nodesStarted += 1;
        emit({ type: "node_started", nodeKey, detail: `Attempt ${attempt}.` });

        const result = await deps.executeNode(node, attempt);
        return { nodeKey, node, attempt, result };
      }),
    );

    for (const { nodeKey, node, attempt, result } of results) {
      if (result.tokensUsed !== undefined) tokensUsed = (tokensUsed ?? 0) + result.tokensUsed;
      if (result.costMicros !== undefined) costMicros = (costMicros ?? 0) + result.costMicros;

      if (result.status === "SUCCEEDED") {
        const validation = deps.validateOutput?.(node, result.output);
        if (validation && !validation.valid) {
          // A node that returned the wrong shape has not succeeded, whatever
          // it thinks. Letting it through would poison everything downstream.
          emit({
            type: "node_output_rejected",
            nodeKey,
            detail: validation.issues.join("; "),
          });

          if (attempt < node.maxAttempts) {
            retriesUsed += 1;
            state = transition(state, nodeKey, "PENDING");
            emit({ type: "node_retrying", nodeKey, detail: `Output rejected; retrying (${attempt}/${node.maxAttempts}).` });
          } else {
            state = transition(state, nodeKey, "FAILED");
            emit({ type: "node_failed", nodeKey, detail: "Output never satisfied the contract." });
          }
          continue;
        }

        outputs.set(nodeKey, result.output);
        state = transition(state, nodeKey, "COMPLETED");
        emit({ type: "node_succeeded", nodeKey, detail: `Completed on attempt ${attempt}.` });
        continue;
      }

      const canRetry = result.retryable && attempt < node.maxAttempts;
      if (canRetry) {
        retriesUsed += 1;
        state = transition(state, nodeKey, "PENDING");
        emit({
          type: "node_retrying",
          nodeKey,
          detail: `${result.error} — retrying (${attempt}/${node.maxAttempts}).`,
        });
        continue;
      }

      state = transition(state, nodeKey, "FAILED");
      emit({
        type: "node_failed",
        nodeKey,
        detail: result.retryable
          ? `${result.error} — retry budget spent after ${attempt} attempt(s).`
          : `${result.error} — not retryable.`,
      });
    }
  }

  // Fan-in over the whole graph: did every node account for itself?
  const outcomes: NodeOutcome<unknown>[] = [];
  for (const node of graph.nodes) {
    const nodeState = state.states.get(node.nodeKey);
    if (nodeState === "COMPLETED") {
      outcomes.push({ nodeId: node.nodeKey, status: "COMPLETED", items: [] });
    } else if (nodeState === "FAILED") {
      outcomes.push({ nodeId: node.nodeKey, status: "FAILED" });
    }
    // Anything else never reported, which collectFanIn treats as missing —
    // deliberately distinct from a node that ran and had nothing to say.
  }

  const fanIn = collectFanIn(
    graph.nodes.map((node) => node.nodeKey),
    outcomes,
  );

  const summary = progress(
    schedulerNodes as unknown as Parameters<typeof progress>[0],
    state,
  );

  const outcome: RunOutcome = stoppedByBudget
    ? "BUDGET_STOPPED"
    : fanIn.isWhole
      ? "COMPLETED"
      : summary.completed === 0
        ? "FAILED"
        : "PARTIAL";

  return {
    outcome,
    states: state.states,
    outputs,
    spend: spendNow(),
    lastBudgetAssessment: assessment,
    percentComplete: summary.percentComplete,
    // A run that lost a node says so, in words, wherever it is reported.
    incompleteness: incompletenessNotice(fanIn),
    events,
  };
}

/** Resources a node set would contend for, for lock acquisition up front. */
export function contendedResources(nodes: readonly CompiledNode[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const write of node.writes) {
      const key = resourceKey(write);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}
