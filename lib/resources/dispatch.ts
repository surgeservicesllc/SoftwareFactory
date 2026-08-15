/**
 * The join between "which nodes may start" and "who runs them".
 *
 * `AI/PHASE_2C_IMPLEMENTATION_PLAN.md` names this MISSING: "Central
 * scheduler/router across agent, provider, model, capacity — `routeProvider`
 * routes provider+model only. Nothing selects an agent or reserves capacity."
 *
 * Two halves already existed and never met:
 *
 * - `lib/graph/scheduler.ts` decides *which* nodes are startable, from
 *   dependencies, the concurrency limit, and resource locks. It does not know
 *   what a worker is.
 * - `lib/resources/manager.ts` decides *who* should run **one** node, from
 *   capability, risk, breakers, and capacity. It does not know a batch exists.
 *
 * ## Why a batch cannot be a loop over the single-node decision
 *
 * `assignWorker` is told the reservations that are live *now*. Call it twice in
 * one tick with the same reservation list and both calls see the same free slot,
 * both admit, and the fleet ends the tick over its limit — by exactly as many
 * nodes as the scheduler happened to release together. The limit would appear to
 * work in every single-node test and fail only under the concurrency it exists
 * to bound, which is the worst possible shape for a safety property.
 *
 * So `dispatch` threads reservations *forward* through the batch: each accepted
 * assignment is added to the working set before the next node is considered.
 * The nth node in a tick sees the first n-1 assignments from that same tick.
 *
 * ## Order is explicit, not incidental
 *
 * When capacity binds, some nodes in a tick start and others wait, so the order
 * decides who waits. Relying on the order the scheduler happened to emit would
 * make that a silent side effect of an unrelated module. Nodes are sorted by
 * risk first (RED work should not queue behind GREEN), then by the caller's
 * stated priority, then by nodeId so the result is deterministic and replayable
 * — the same property `tick` is careful to preserve.
 *
 * ## Deferral is not failure
 *
 * A node that finds no worker because the fleet is full is `DEFERRED`, and the
 * caller is expected to offer it again next tick. A node that finds no worker
 * because nothing can *ever* satisfy it — no agent declares the capability, the
 * risk tier rules out every model — is `UNROUTABLE`, and offering it again will
 * not help. Collapsing the two would either spin forever on impossible work or
 * abandon work that only needed to wait.
 */

import type { RiskLevel } from "@/lib/risk";

import {
  DEFAULT_CAPACITY_LIMITS,
  type CapacityLimits,
  type Reservation,
} from "@/lib/resources/capacity";
import {
  recordRequest,
  type RateEvent,
  type RateLimitPolicy,
} from "@/lib/resources/rate-limits";
import {
  assignWorker,
  type ResourceAssignment,
  type ResourceNode,
  type RoutingMode,
  type RoutingObjective,
  type WorkerCandidate,
} from "@/lib/resources/manager";

/** One node the graph scheduler says may start, with what it needs to be routed. */
export interface DispatchRequest {
  readonly node: ResourceNode;
  readonly candidates: readonly WorkerCandidate[];
  readonly objective: RoutingObjective;
  readonly mode: RoutingMode;
  readonly requestedAgentId?: string | null;
  readonly requestedModel?: string | null;
  readonly requestedProvider?: string | null;
  /**
   * Caller-stated ordering hint, higher first. Ties break on nodeId, never on
   * input order, so a replay produces the same dispatch.
   */
  readonly priority?: number;
}

export interface DispatchInput {
  readonly requests: readonly DispatchRequest[];
  /** Reservations already held when the tick begins. */
  readonly reservations: readonly Reservation[];
  readonly capacityLimits?: CapacityLimits;
  /**
   * Requests already made in the rate window. Threaded forward through the
   * batch exactly as reservations are, and for the same reason: a tick that
   * routed every node against the window as it stood at the *start* could
   * admit a whole batch through a limit with one request left.
   */
  readonly rateEvents?: readonly RateEvent[];
  readonly ratePolicy?: RateLimitPolicy;
  /** How long an accepted assignment holds its slot. */
  readonly leaseDurationMs: number;
  readonly now: number;
}

export interface Dispatched {
  readonly nodeId: string;
  readonly assignment: ResourceAssignment;
  readonly reservation: Reservation;
}

export type WithheldReason = "DEFERRED" | "UNROUTABLE";

export interface Withheld {
  readonly nodeId: string;
  readonly reason: WithheldReason;
  /** The assignment that refused, so the caller can report *which* limit or rule. */
  readonly assignment: ResourceAssignment;
}

export interface DispatchResult {
  readonly dispatched: readonly Dispatched[];
  readonly withheld: readonly Withheld[];
  /** Reservations held when the tick ends: the input set plus this tick's. */
  readonly reservations: readonly Reservation[];
  /**
   * Rate events after the tick, or the input unchanged when the caller does not
   * account for rate. Token counts here are estimates until settled.
   */
  readonly rateEvents: readonly RateEvent[];
}

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = Object.freeze({
  RED: 0,
  YELLOW: 1,
  GREEN: 2,
});

function riskRank(risk: RiskLevel): number {
  return RISK_ORDER[risk] ?? RISK_ORDER.GREEN;
}

/**
 * Deterministic dispatch order: risk, then stated priority, then nodeId.
 *
 * Risk leads because a full fleet is exactly when it matters that a RED node is
 * not sitting behind a queue of GREEN ones. `nodeId` is the final tiebreak so
 * two runs of the same tick never disagree.
 */
export function dispatchOrder(requests: readonly DispatchRequest[]): readonly DispatchRequest[] {
  return [...requests].sort((left, right) => {
    const byRisk = riskRank(left.node.riskLevel) - riskRank(right.node.riskLevel);
    if (byRisk !== 0) return byRisk;
    const byPriority = (right.priority ?? 0) - (left.priority ?? 0);
    if (byPriority !== 0) return byPriority;
    return left.node.nodeId.localeCompare(right.node.nodeId);
  });
}

/**
 * True when re-offering this node on a later tick could succeed.
 *
 * Capacity frees up; a missing capability does not. So the question is not
 * whether the *whole* candidate list was refused on capacity — it is whether
 * **any single** candidate's only problem was capacity. That one candidate
 * becoming free is enough to route the node, and the permanent rejections
 * recorded against its peers say nothing about it.
 *
 * Reading this the other way round — requiring every candidate to be
 * capacity-refused — would mark a node UNROUTABLE the moment one unrelated
 * agent in the fleet lacked the capability, abandoning work that only needed to
 * wait. That is the more damaging of the two errors, because the node is
 * dropped rather than retried.
 */
function canRetryLater(assignment: ResourceAssignment): boolean {
  return assignment.candidates.some(
    (candidate) =>
      candidate.rejections.length > 0
      && candidate.rejections.every(
        (rejection) =>
          rejection === "WORKER_AT_CAPACITY"
          || rejection === "PROVIDER_AT_CAPACITY"
          || rejection === "PROJECT_AT_CAPACITY"
          // A rate refusal is the most clearly temporary of all: unlike
          // capacity, it even reports when it lifts.
          || rejection === "REQUEST_RATE_EXCEEDED"
          || rejection === "TOKEN_RATE_EXCEEDED",
      ),
  );
}

/**
 * Route a tick's worth of startable nodes, holding capacity as it goes.
 *
 * Pure: no clock, no I/O. The caller supplies `now` and persists the returned
 * reservations, exactly as `tick` expects its caller to persist node states.
 */
export function dispatch(input: DispatchInput): DispatchResult {
  const limits = input.capacityLimits ?? DEFAULT_CAPACITY_LIMITS;
  const dispatched: Dispatched[] = [];
  const withheld: Withheld[] = [];

  // The working set grows within the tick. This is the whole point: node n sees
  // the slots taken by nodes 1..n-1 of the same batch.
  let held: Reservation[] = [...input.reservations];
  let rateEvents: readonly RateEvent[] | undefined = input.rateEvents;

  for (const request of dispatchOrder(input.requests)) {
    const assignment = assignWorker({
      node: request.node,
      candidates: request.candidates,
      objective: request.objective,
      mode: request.mode,
      requestedAgentId: request.requestedAgentId,
      requestedModel: request.requestedModel,
      requestedProvider: request.requestedProvider,
      reservations: held,
      capacityLimits: limits,
      rateEvents,
      ratePolicy: input.ratePolicy,
      now: input.now,
    });

    // Deterministic work takes no worker and holds no slot, so it neither
    // consumes capacity nor waits for it.
    if (assignment.decision === "DETERMINISTIC_NO_MODEL_REQUIRED") {
      dispatched.push(
        Object.freeze({
          nodeId: request.node.nodeId,
          assignment,
          reservation: Object.freeze({
            agentId: "",
            provider: "",
            model: "",
            projectId: request.node.projectId,
            // Already expired: recorded for the audit trail, counted by nobody.
            expiresAt: input.now,
          }),
        }),
      );
      continue;
    }

    if (assignment.decision !== "ASSIGNED") {
      withheld.push(
        Object.freeze({
          nodeId: request.node.nodeId,
          reason: canRetryLater(assignment) ? "DEFERRED" : "UNROUTABLE",
          assignment,
        }),
      );
      continue;
    }

    const reservation: Reservation = Object.freeze({
      agentId: assignment.agentId!,
      provider: assignment.provider!,
      model: assignment.model!,
      projectId: request.node.projectId,
      expiresAt: input.now + input.leaseDurationMs,
    });

    held = [...held, reservation];
    if (rateEvents) {
      // Recorded as an estimate, because the real token count is only known
      // after the call. `settleTokens` replaces it with the measurement.
      rateEvents = recordRequest(
        rateEvents,
        {
          provider: assignment.provider!,
          at: input.now,
          tokens: request.node.estimatedContextTokens,
          estimated: true,
        },
        input.ratePolicy?.windowMs,
      );
    }
    dispatched.push(Object.freeze({ nodeId: request.node.nodeId, assignment, reservation }));
  }

  return Object.freeze({
    dispatched: Object.freeze(dispatched),
    withheld: Object.freeze(withheld),
    reservations: Object.freeze(held),
    rateEvents: Object.freeze(rateEvents ?? []),
  });
}

/**
 * Give back the slot a finished node held.
 *
 * Matched on identity rather than by value equality across the whole list, so
 * releasing one of two identical reservations releases exactly one. Releasing a
 * reservation that is not held is a no-op rather than an error: a worker that
 * dies after its lease expires and is then reported complete would otherwise
 * throw on the happy path of a recovery, and the expiry has already done the
 * work correctly.
 */
export function release(
  reservations: readonly Reservation[],
  released: Reservation,
): readonly Reservation[] {
  const index = reservations.indexOf(released);
  if (index === -1) {
    const equivalent = reservations.findIndex(
      (entry) =>
        entry.agentId === released.agentId
        && entry.provider === released.provider
        && entry.model === released.model
        && entry.projectId === released.projectId
        && entry.expiresAt === released.expiresAt,
    );
    if (equivalent === -1) return reservations;
    return Object.freeze(reservations.filter((_, position) => position !== equivalent));
  }
  return Object.freeze(reservations.filter((_, position) => position !== index));
}
