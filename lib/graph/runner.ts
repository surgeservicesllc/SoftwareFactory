import { assessBudget, type BudgetAssessment, type GraphBudget, type GraphSpend } from "@/lib/graph/budgets";
import type { CompiledGraph, CompiledNode } from "@/lib/graph/compiler";
import { validateNodeOutput } from "@/lib/graph/contracts";
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
      /**
       * True when the provider refused to fuel the attempt at all — a session
       * or rate limit, not a wrong answer. Callers use this to stop spending
       * attempts on a credential that is exhausted rather than mistaken.
       */
      readonly capacityWithheld?: boolean;
      /**
       * True when the node did its work and is now waiting at a lifecycle gate.
       *
       * A failure to the engine, deliberately: the scheduler's only way to stop
       * dependents starting is for their dependency not to have completed, and
       * a node awaiting a decision has genuinely not completed. It is *not* a
       * failure to the caller, which records the node as VERIFYING and closes
       * the run PARTIAL — the same shape `capacityWithheld` already uses for
       * "this did not fail, it did not happen".
       */
      readonly gateHeld?: boolean;
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

/**
 * How many nodes the portfolio will let this graph start right now, and why
 * that number.
 *
 * `granted` is a ceiling, not an instruction: the runner starts at most this
 * many and may start fewer if the graph has less ready work. Zero is a
 * legitimate answer and means "not now", not "never" — the run ends as
 * `CAPACITY_WITHHELD` so the caller knows to come back rather than treating a
 * full factory as a failed graph.
 */
export type CapacityGrant = {
  readonly granted: number;
  readonly reason: string;
};

export type RunnerDependencies = {
  /** Runs one node. Injected so the runner needs no provider to be tested. */
  readonly executeNode: (
    node: CompiledNode,
    attempt: number,
  ) => Promise<NodeExecutionResult>;
  /**
   * Asks the portfolio for capacity before each scheduling round.
   *
   * Without this the runner takes its concurrency straight from its own
   * budget — which is to say it assumes the whole factory is available to it,
   * and two graphs in two projects would each assume the same thing. Injected
   * rather than imported so the engine core stays free of I/O, and optional so
   * an isolated graph can still be run without a portfolio around it.
   */
  readonly requestCapacity?: (
    request: { readonly wanted: number },
  ) => Promise<CapacityGrant> | CapacityGrant;
  /** Validates a node's output against its contract. */
  readonly validateOutput?: (node: CompiledNode, output: unknown) => { valid: boolean; issues: readonly string[] };
  /** Monotonic elapsed milliseconds. Injected so budgets are testable. */
  readonly elapsedMs?: () => number;
  /**
   * Waits before a retry is dispatched. Injected so a test can prove the wait
   * happened without spending it, and defaulted so production waits for real.
   */
  readonly delay?: (ms: number) => Promise<void>;
  /**
   * Answers whether a pause has been requested for this run. Polled once per
   * scheduling round before anything new starts, so a paused run finishes
   * the work already in flight and stops between waves — nothing
   * mid-execution is interrupted. Optional so an isolated graph runs
   * without a control plane around it.
   */
  readonly checkPause?: () => Promise<boolean> | boolean;
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
    | "budget_stopped"
    | "capacity_withheld"
    | "pause_honored"
    | "retry_backoff";
  readonly nodeKey?: string;
  readonly detail: string;
};

export const RUN_OUTCOMES = [
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "BUDGET_STOPPED",
  "STALLED",
  // Distinct from STALLED on purpose. A stalled graph cannot proceed however
  // long you wait; a capacity-withheld graph is simply behind other work.
  "CAPACITY_WITHHELD",
  // A person asked the run to stop between steps. Completed work is kept and
  // the graph stays claimable, so a later run resumes from it.
  "PAUSED",
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
    toleratesPartialInputs: node.toleratesPartialInputs,
  }));

  let state: GraphState = initialState(
    schedulerNodes as unknown as Parameters<typeof initialState>[0],
  );

  const outputs = new Map<string, unknown>();
  const events: RunnerEvent[] = [];
  const attemptsByNode = new Map<string, number>();
  const elapsed = deps.elapsedMs ?? (() => 0);
  const delay = deps.delay
    ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const validateOutput = deps.validateOutput
    ?? ((node: CompiledNode, output: unknown) => {
      if (!node.outputSchema) {
        return { valid: false, issues: ["The compiled node has no output contract."] };
      }
      const result = validateNodeOutput(
        { nodeId: node.nodeKey, outputSchema: node.outputSchema },
        output,
      );
      return result.valid
        ? { valid: true, issues: [] }
        : { valid: false, issues: result.issues };
    });

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
  let capacityWithheld = false;
  let pausedByRequest = false;

  // Bounded by node count and attempts, so a pathological graph cannot spin.
  const maxIterations = budget.maxNodes * (Math.max(1, budget.maxRetries) + 2) + 10;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    // The pause is honored at the wave boundary: everything the previous
    // round started has already settled, and nothing new begins.
    if (deps.checkPause && await deps.checkPause()) {
      pausedByRequest = true;
      emit({
        type: "pause_honored",
        detail: "Pause requested; nothing new starts. Completed work is kept and the run resumes on a later claim.",
      });
      break;
    }

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

    // Ask before starting anything. The budget says what this graph may use;
    // the portfolio says what is actually free, and the smaller of the two is
    // what the scheduler is allowed to work with.
    let allowed = concurrency;
    if (deps.requestCapacity) {
      const grant = await deps.requestCapacity({ wanted: concurrency });
      allowed = Math.max(0, Math.min(concurrency, Math.floor(grant.granted)));
      if (allowed < concurrency) {
        emit({
          type: "capacity_withheld",
          detail: `Portfolio granted ${allowed} of ${concurrency}: ${grant.reason}`,
        });
      }
      if (allowed === 0 && state.running.size === 0) {
        capacityWithheld = true;
        break;
      }
    }

    const decision = tick(
      schedulerNodes as unknown as Parameters<typeof tick>[0],
      graph.edges,
      state,
      { maxConcurrent: allowed },
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

    // One wait per scheduling round, not one per node. When a provider is
    // overloaded it refuses whatever is in flight, so the whole batch comes
    // back asking for the same pause; serving it once is both the shorter
    // wait and the politer one.
    let retryPauseMs = 0;

    for (const { nodeKey, node, attempt, result } of results) {
      if (result.tokensUsed !== undefined) tokensUsed = (tokensUsed ?? 0) + result.tokensUsed;
      if (result.costMicros !== undefined) costMicros = (costMicros ?? 0) + result.costMicros;

      if (result.status === "SUCCEEDED") {
        const validation = validateOutput(node, result.output);
        if (!validation.valid) {
          // A node that returned the wrong shape has not succeeded, whatever
          // it thinks. Letting it through would poison everything downstream.
          emit({
            type: "node_output_rejected",
            nodeKey,
            detail: validation.issues.join("; "),
          });

          if (attempt < node.maxAttempts) {
            retriesUsed += 1;
            if (node.backoffMs > retryPauseMs) retryPauseMs = node.backoffMs;
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
        if (node.backoffMs > retryPauseMs) retryPauseMs = node.backoffMs;
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

    // The node's retry policy has always declared a backoff; until this line
    // nothing read it, so every retry fired into the same instant that had
    // just refused it. Waiting here rather than inside the results loop keeps
    // the pause to one per round.
    if (retryPauseMs > 0) {
      emit({
        type: "retry_backoff",
        detail: `Waiting ${retryPauseMs}ms before the retries this round scheduled.`,
      });
      await delay(retryPauseMs);
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

  const outcome: RunOutcome = pausedByRequest
    ? "PAUSED"
    : capacityWithheld
    ? "CAPACITY_WITHHELD"
    : stoppedByBudget
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
