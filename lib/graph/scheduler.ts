import type { NodeContract } from "@/lib/graph/contracts";
import { resourceKey } from "@/lib/graph/types";
import type { GraphEdge, NodeState } from "@/lib/graph/types";
import { isTerminal } from "@/lib/graph/types";

/**
 * The DAG scheduler, as a pure function of state.
 *
 * `tick` takes the current node states and returns what should happen next. It
 * performs no I/O and holds no clock of its own, so the same graph state always
 * produces the same decision — which is what makes durability possible. A run
 * that survives a restart replays its persisted states through `tick` and
 * arrives exactly where it left off, rather than depending on anything that
 * lived only in a process's memory.
 *
 * Two invariants the scheduler is responsible for:
 *
 *   1. A node becomes `READY` only when its **real** dependencies are satisfied.
 *      Fake edges were already removed upstream; this only honours what is left.
 *   2. A failed node blocks its dependents and **nothing else** (§27). Unrelated
 *      branches keep running, because stopping them would waste completed work
 *      and hide which failure actually mattered.
 */

export type GraphState = {
  readonly states: ReadonlyMap<string, NodeState>;
  /** Nodes currently occupying a concurrency slot. */
  readonly running: ReadonlySet<string>;
};

export type SchedulerLimits = {
  readonly maxConcurrent: number;
  /** Resources currently locked, by `resourceKey`. */
  readonly heldLocks?: ReadonlySet<string>;
};

export type ScheduleDecision = {
  /** Nodes to start now, respecting concurrency and locks. */
  readonly start: readonly string[];
  /** Nodes that moved to BLOCKED because a dependency failed or was cancelled. */
  readonly blocked: readonly BlockedNode[];
  /** Nodes eligible but held back by a limit rather than a dependency. */
  readonly deferred: readonly DeferredNode[];
  readonly complete: boolean;
  /** True when nothing is running and nothing can start — a stuck graph. */
  readonly stalled: boolean;
};

export type BlockedNode = {
  readonly nodeId: string;
  readonly because: string;
};

export type DeferredNode = {
  readonly nodeId: string;
  readonly reason: "CONCURRENCY_LIMIT" | "RESOURCE_LOCKED";
  readonly detail: string;
};

function dependenciesOf(
  nodeId: string,
  edges: readonly GraphEdge[],
): readonly string[] {
  return edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
}

export function initialState(nodes: readonly NodeContract[]): GraphState {
  return {
    states: new Map(nodes.map((node) => [node.nodeId, "PENDING" as NodeState])),
    running: new Set(),
  };
}

export function tick(
  nodes: readonly NodeContract[],
  edges: readonly GraphEdge[],
  state: GraphState,
  limits: SchedulerLimits,
): ScheduleDecision {
  const start: string[] = [];
  const blocked: BlockedNode[] = [];
  const deferred: DeferredNode[] = [];

  const stateOf = (id: string): NodeState => state.states.get(id) ?? "PENDING";
  let slots = Math.max(0, limits.maxConcurrent - state.running.size);

  // Resources already spoken for: held externally, or written by a node we are
  // about to start in this same tick. Without the second half, two independent
  // nodes writing the same file would both start on the very first tick.
  const claimed = new Set(limits.heldLocks ?? []);

  for (const node of nodes) {
    const current = stateOf(node.nodeId);
    if (isTerminal(current) || current === "RUNNING" || current === "VERIFYING") {
      continue;
    }

    // Already blocked is already decided. BLOCKED is only reachable through a
    // dependency that failed, was cancelled, or was itself blocked, and none of
    // those can un-happen — so re-deciding it every tick would re-report the
    // same node forever, and a caller writing an event per blocked node would
    // write one on every tick rather than once.
    if (current === "BLOCKED") continue;

    const deps = dependenciesOf(node.nodeId, edges);

    // BLOCKED counts as fatal, not merely unmet.
    //
    // Without it, blocking stopped after one hop: in A -> B -> C with A failed,
    // B was blocked and C sat PENDING forever, because C's only dependency was
    // BLOCKED rather than FAILED. The graph then never reported `complete`, and
    // reported `stalled` instead — which claims something is wrong, when in
    // fact a failure had simply made a subtree unreachable, the most ordinary
    // outcome there is. Blocking propagates one hop per tick, reaching a
    // fixpoint the same way the rest of this function does.
    const fatal = deps.find((dep) => {
      const depState = stateOf(dep);
      return depState === "FAILED" || depState === "CANCELLED" || depState === "BLOCKED";
    });
    if (fatal) {
      const fatalState = stateOf(fatal);
      blocked.push({
        nodeId: node.nodeId,
        because: fatalState === "BLOCKED"
          // Named differently so a reader can tell the origin of a failure from
          // the nodes downstream of it, which is the difference between one
          // thing to investigate and twenty.
          ? `Dependency ${fatal} is blocked, so this cannot run either.`
          : `Dependency ${fatal} is ${fatalState}.`,
      });
      continue;
    }

    const unmet = deps.filter((dep) => {
      const depState = stateOf(dep);
      return depState !== "COMPLETED" && depState !== "SKIPPED";
    });
    if (unmet.length > 0) continue;

    if (slots <= 0) {
      deferred.push({
        nodeId: node.nodeId,
        reason: "CONCURRENCY_LIMIT",
        detail: `Ready, but the graph is already running ${state.running.size} of ${limits.maxConcurrent} nodes.`,
      });
      continue;
    }

    const contended = node.writes
      .map(resourceKey)
      .find((key) => claimed.has(key));
    if (contended) {
      deferred.push({
        nodeId: node.nodeId,
        reason: "RESOURCE_LOCKED",
        detail: `Ready, but ${contended} is held by another node.`,
      });
      continue;
    }

    for (const write of node.writes) claimed.add(resourceKey(write));
    start.push(node.nodeId);
    slots -= 1;
  }

  const terminalCount = nodes.filter((node) => isTerminal(stateOf(node.nodeId))).length;
  const blockedCount = nodes.filter((node) => stateOf(node.nodeId) === "BLOCKED").length;
  const complete = terminalCount + blockedCount === nodes.length;
  // Blocking something is progress, so a tick that blocks is not a stall. While
  // a failure propagates down a chain there are ticks that start nothing and
  // defer nothing, and calling those stalled would raise an alarm about a graph
  // that is shutting down exactly as designed.
  const stalled =
    !complete
    && start.length === 0
    && state.running.size === 0
    && deferred.length === 0
    && blocked.length === 0;

  return { start, blocked, deferred, complete, stalled };
}

/** Apply a state transition, returning a new state rather than mutating. */
export function transition(
  state: GraphState,
  nodeId: string,
  next: NodeState,
): GraphState {
  const states = new Map(state.states);
  states.set(nodeId, next);

  const running = new Set(state.running);
  if (next === "RUNNING") running.add(nodeId);
  else running.delete(nodeId);

  return { states, running };
}

export function applyDecision(
  state: GraphState,
  decision: ScheduleDecision,
): GraphState {
  let next = state;
  for (const nodeId of decision.start) next = transition(next, nodeId, "RUNNING");
  for (const entry of decision.blocked) next = transition(next, entry.nodeId, "BLOCKED");
  return next;
}

export type GraphProgress = {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly running: number;
  readonly percentComplete: number;
};

export function progress(
  nodes: readonly NodeContract[],
  state: GraphState,
): GraphProgress {
  const count = (target: NodeState) =>
    nodes.filter((node) => state.states.get(node.nodeId) === target).length;

  const total = nodes.length;
  const completed = count("COMPLETED");

  return {
    total,
    completed,
    failed: count("FAILED"),
    blocked: count("BLOCKED"),
    running: count("RUNNING"),
    // Deliberately completed-only: a graph that failed half its nodes is not
    // "100% done" just because nothing is still moving.
    percentComplete: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}
