/**
 * Self-healing limits and ancestry.
 *
 * A system that can detect a failure, fix it, deploy the fix and observe the
 * result can also do all of that wrongly, forever. The loop is the feature and
 * the loop is the hazard, so this module tracks where an attempt came from and
 * decides when to stop trying.
 *
 * The distinction that matters is between *progress* and *activity*. Three
 * repair attempts that each failed differently are a system working through a
 * hard problem. Three that failed identically are a system doing the same
 * useless thing three times, and the second is far more common. Counting
 * attempts alone cannot tell them apart, so this counts *distinct* failures too.
 */

export const ANCESTRY_KINDS = ["INCIDENT", "REPAIR", "RUN", "PULL_REQUEST", "DEPLOYMENT"] as const;
export type AncestryKind = (typeof ANCESTRY_KINDS)[number];

export type AncestryNode = {
  readonly kind: AncestryKind;
  readonly id: string;
  /** The node this one was created from. Null only for the originating incident. */
  readonly parentId: string | null;
  /** A stable signature of how this attempt failed, when it did. */
  readonly failureSignature?: string | null;
};

export const HEALING_DECISIONS = ["CONTINUE", "STOP_AND_ESCALATE", "STOP_EXHAUSTED"] as const;
export type HealingDecision = (typeof HEALING_DECISIONS)[number];

export type HealingLimits = {
  readonly maxRollbackAttempts: number;
  readonly maxRepairAttempts: number;
  readonly maxDeploymentAttempts: number;
  /**
   * How many times the *same* failure may recur before the loop stops.
   *
   * Lower than the attempt ceilings on purpose: an identical failure repeating
   * is evidence the approach is wrong, and spending the remaining budget on it
   * only delays the escalation.
   */
  readonly maxIdenticalFailures: number;
};

export const DEFAULT_HEALING_LIMITS: HealingLimits = Object.freeze({
  maxRollbackAttempts: 3,
  maxRepairAttempts: 3,
  maxDeploymentAttempts: 3,
  maxIdenticalFailures: 2,
});

export type HealingAssessment = {
  readonly decision: HealingDecision;
  readonly reason: string;
  /** Present when a person has to look at it. */
  readonly ownerAction: string | null;
};

/**
 * Walk from a node back to its originating incident.
 *
 * Returned oldest-first so a reader follows the causal order rather than
 * reversing it in their head. A broken parent link truncates rather than
 * throwing: partial ancestry is still useful, and losing the whole chain
 * because one row is missing would be worse.
 */
export function ancestryOf(
  nodeId: string,
  nodes: readonly AncestryNode[],
): readonly AncestryNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: AncestryNode[] = [];
  const seen = new Set<string>();

  let current = byId.get(nodeId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) ?? null : null;
  }

  return chain.reverse();
}

/** Attempts of one kind descending from an incident. */
export function attemptsOfKind(
  incidentId: string,
  kind: AncestryKind,
  nodes: readonly AncestryNode[],
): readonly AncestryNode[] {
  return nodes.filter(
    (node) =>
      node.kind === kind &&
      ancestryOf(node.id, nodes).some((ancestor) => ancestor.id === incidentId),
  );
}

/**
 * Decide whether the healing loop may take another step.
 *
 * Checks the repeated-failure condition before the ceilings, because "this is
 * not working" is a better reason to stop than "we ran out of budget", and it
 * is the one worth telling a person.
 */
export function assessHealing(input: {
  readonly incidentId: string;
  readonly nodes: readonly AncestryNode[];
  readonly nextKind: Extract<AncestryKind, "REPAIR" | "DEPLOYMENT">;
  readonly rollbackAttempts: number;
  readonly limits?: HealingLimits;
}): HealingAssessment {
  const limits = input.limits ?? DEFAULT_HEALING_LIMITS;
  const related = attemptsOfKind(input.incidentId, input.nextKind, input.nodes);

  const signatures = related
    .map((node) => node.failureSignature)
    .filter((signature): signature is string => Boolean(signature));

  const counts = new Map<string, number>();
  for (const signature of signatures) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  for (const [signature, count] of counts) {
    if (count >= limits.maxIdenticalFailures) {
      return {
        decision: "STOP_AND_ESCALATE",
        reason:
          `The same failure has recurred ${count} time(s): ${signature}. ` +
          "Repeating the attempt is activity rather than progress.",
        ownerAction:
          `Incident ${input.incidentId} keeps failing the same way (${signature}). ` +
          "The automated path cannot resolve it; it needs a person to look at the cause.",
      };
    }
  }

  const ceiling =
    input.nextKind === "REPAIR" ? limits.maxRepairAttempts : limits.maxDeploymentAttempts;
  if (related.length >= ceiling) {
    return {
      decision: "STOP_EXHAUSTED",
      reason: `${related.length} ${input.nextKind.toLowerCase()} attempt(s) reached the ceiling of ${ceiling}.`,
      ownerAction: `Incident ${input.incidentId} exhausted its ${input.nextKind.toLowerCase()} budget without resolving.`,
    };
  }

  if (input.rollbackAttempts >= limits.maxRollbackAttempts) {
    return {
      decision: "STOP_EXHAUSTED",
      reason: `Rollback already attempted ${input.rollbackAttempts} time(s), reaching its ceiling.`,
      ownerAction: `Incident ${input.incidentId} could not be recovered by rollback.`,
    };
  }

  return {
    decision: "CONTINUE",
    reason:
      `${related.length} of ${ceiling} ${input.nextKind.toLowerCase()} attempt(s) used, ` +
      "and no failure has repeated identically.",
    ownerAction: null,
  };
}

export const REPAIR_ROUTING_STATES = [
  "ROUTED_TO_1C",
  "BLOCKED_BY_1C",
  "BLOCKED_BY_POLICY",
  "STOPPED",
] as const;
export type RepairRoutingState = (typeof REPAIR_ROUTING_STATES)[number];

export type RepairRouting = {
  readonly state: RepairRoutingState;
  readonly detail: string;
  readonly ownerAction: string | null;
};

/**
 * Route a repair into the **existing** Phase 1C path.
 *
 * There is deliberately no second coding engine here. If 1C cannot execute, the
 * repair is recorded as `BLOCKED_BY_1C` and stops. Building a fallback executor
 * would be the wrong fix twice over: it would duplicate the thing that already
 * exists, and it would route real repair work through a path with none of 1C's
 * gates.
 */
export function routeRepair(input: {
  readonly incidentId: string;
  readonly risk: "GREEN" | "YELLOW" | "RED";
  readonly workerConnected: boolean;
  readonly healing: HealingAssessment;
}): RepairRouting {
  if (input.healing.decision !== "CONTINUE") {
    return {
      state: "STOPPED",
      detail: input.healing.reason,
      ownerAction: input.healing.ownerAction,
    };
  }

  if (input.risk === "RED") {
    return {
      state: "BLOCKED_BY_POLICY",
      detail: "RED repair work requires explicit owner approval and is never dispatched automatically.",
      ownerAction: `Incident ${input.incidentId} needs a RED-approved repair, which only the owner can authorize.`,
    };
  }

  if (!input.workerConnected) {
    // Truthful rather than optimistic: the task is real and queued, and nothing
    // will claim it.
    return {
      state: "BLOCKED_BY_1C",
      detail:
        "The repair task was created and is queued, but no Phase 1C worker is registered to claim it, " +
        "so no fix will be produced.",
      ownerAction:
        "Register and enable a Phase 1C worker so queued repair work can be claimed. Until then repairs " +
        "accumulate as queued tasks rather than fixes.",
    };
  }

  return {
    state: "ROUTED_TO_1C",
    detail: "The repair entered the existing Phase 1C execution path as an ordinary queued command.",
    ownerAction: null,
  };
}
