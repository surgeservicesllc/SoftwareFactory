import type { RiskLevel } from "@/lib/risk";

import {
  checkCapability,
  type AgentCapabilityProfile,
  type CapabilityRejection,
  type ModelCapabilityProfile,
  type NodeComplexity,
  type WorkCapability,
} from "@/lib/resources/capabilities";
import {
  admits,
  type CapacityLimits,
  type CapacityRefusal,
  type Reservation,
} from "@/lib/resources/capacity";
import { evaluateBreaker, type BreakerRecord } from "@/lib/resources/breakers";
import {
  admitsRate,
  type RateEvent,
  type RateLimitPolicy,
  type RateRefusal,
} from "@/lib/resources/rate-limits";
import {
  predictFrom,
  type ObservedPerformance,
  type Prediction,
} from "@/lib/resources/history";

/**
 * The Resource Manager: choose the worker for one node.
 *
 * It answers three questions in order, and the order matters.
 *
 * 1. Does this node need a model at all? Deterministic work should not buy
 *    inference. This gate runs first because the cheapest and most reliable
 *    model is the one you did not call.
 * 2. Which agent+model pairs are *eligible*? Capability, availability, project
 *    allowlist, context limit, risk policy, and circuit breakers. Eligibility
 *    is never traded against cost or speed.
 * 3. Among eligible pairs, which scores best for the configured objective?
 *
 * Scoring inputs that come from observed history are optional. A candidate with
 * too few recorded runs is scored on declaration and configured preference and
 * flagged `INSUFFICIENT_HISTORY`, never given an invented success rate.
 */

export const RESOURCE_POLICY_VERSION = "phase2c-resource-manager-v1";

export const ROUTING_OBJECTIVES = ["QUALITY", "SPEED", "COST", "BALANCED"] as const;
export type RoutingObjective = (typeof ROUTING_OBJECTIVES)[number];

export const ROUTING_MODES = ["AUTO", "CLAUDE", "CODEX", "SPECIFIC_AGENT", "SPECIFIC_MODEL"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

export interface ResourceNode {
  readonly nodeId: string;
  readonly projectId: string;
  readonly required: readonly WorkCapability[];
  readonly complexity: NodeComplexity;
  readonly riskLevel: RiskLevel;
  readonly estimatedContextTokens: number;
  /**
   * True when the node's whole output can be produced by code. Deterministic
   * work is never sent to a model.
   */
  readonly deterministicHandlerAvailable: boolean;
}

export interface WorkerCandidate {
  readonly agent: AgentCapabilityProfile;
  readonly model: ModelCapabilityProfile;
  /** Recorded outcomes for this pair on this task class, or null if too few. */
  readonly performance: ObservedPerformance | null;
  /** Configured preference for this pair, 0-1. A stated preference, not a measurement. */
  readonly configuredAffinity: number;
  readonly breaker: BreakerRecord;
}

export interface ResourceRequest {
  readonly node: ResourceNode;
  readonly candidates: readonly WorkerCandidate[];
  readonly objective: RoutingObjective;
  readonly mode: RoutingMode;
  /** Set for SPECIFIC_AGENT / SPECIFIC_MODEL, and for CLAUDE / CODEX shorthands. */
  readonly requestedAgentId?: string | null;
  readonly requestedModel?: string | null;
  readonly requestedProvider?: string | null;
  /**
   * Runs currently holding capacity. Optional: a caller that does not track
   * reservations gets the previous behaviour rather than a silent limit of
   * zero, which would refuse everything and look like a routing bug.
   */
  readonly reservations?: readonly Reservation[];
  readonly capacityLimits?: CapacityLimits;
  /**
   * Requests already made in the current window. Optional for the same reason
   * `reservations` is: absent means "this caller does not account for rate",
   * not "no requests are permitted".
   */
  readonly rateEvents?: readonly RateEvent[];
  readonly ratePolicy?: RateLimitPolicy;
  readonly now: number;
}

export type AssignmentDecision =
  | "DETERMINISTIC_NO_MODEL_REQUIRED"
  | "ASSIGNED"
  | "NO_ELIGIBLE_WORKER"
  | "REQUESTED_WORKER_INELIGIBLE";

export type ScoreNote =
  | "INSUFFICIENT_HISTORY"
  | "BREAKER_OPEN"
  | "RISK_REQUIRES_STRONG_MODEL"
  | "AT_CAPACITY"
  | "RATE_LIMITED";

export interface ScoredWorker {
  readonly agentId: string;
  readonly provider: string;
  readonly model: string;
  readonly eligible: boolean;
  readonly score: number;
  readonly components: {
    readonly capabilityFit: number;
    readonly reliability: number | null;
    readonly speed: number | null;
    readonly cost: number | null;
    readonly affinity: number;
  };
  readonly rejections: readonly (CapabilityRejection | "BREAKER_OPEN" | "RISK_TIER_TOO_WEAK" | CapacityRefusal | RateRefusal)[];
  /**
   * When a rate refusal could clear, in millis. Null unless rate accounting
   * refused this candidate. A concurrency refusal has no equivalent, because
   * nobody can say when another run will finish.
   */
  readonly retryAfterMs: number | null;
  readonly notes: readonly ScoreNote[];
  readonly prediction: Prediction;
}

export interface ResourceAssignment {
  readonly policyVersion: typeof RESOURCE_POLICY_VERSION;
  readonly decision: AssignmentDecision;
  readonly agentId: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly objective: RoutingObjective;
  readonly mode: RoutingMode;
  readonly reason: string;
  readonly candidates: readonly ScoredWorker[];
  readonly prediction: Prediction;
}

/** Objective weights. Capability fit is not here: it gates, it does not trade. */
const OBJECTIVE_WEIGHTS: Readonly<
  Record<RoutingObjective, { reliability: number; speed: number; cost: number; affinity: number }>
> = Object.freeze({
  QUALITY: Object.freeze({ reliability: 0.7, speed: 0.05, cost: 0.05, affinity: 0.2 }),
  SPEED: Object.freeze({ reliability: 0.25, speed: 0.55, cost: 0.05, affinity: 0.15 }),
  COST: Object.freeze({ reliability: 0.25, speed: 0.05, cost: 0.55, affinity: 0.15 }),
  BALANCED: Object.freeze({ reliability: 0.4, speed: 0.2, cost: 0.2, affinity: 0.2 }),
});

/** Normalize a value against a population, where lower is better. */
function invertedNormal(value: number, population: readonly number[]): number {
  const finite = population.filter((entry) => Number.isFinite(entry));
  if (finite.length === 0) return 0.5;
  const max = Math.max(...finite);
  const min = Math.min(...finite);
  if (max === min) return 0.5;
  return 1 - (value - min) / (max - min);
}

/**
 * RED work, and judgement work generally, may not be pushed onto an economical
 * model to save money. This is the "never sacrifice frozen requirements to save
 * cost" rule expressed as an eligibility gate rather than a weight, because a
 * weight can always be outvoted.
 */
function requiresStrongModel(node: ResourceNode): boolean {
  return (
    node.riskLevel === "RED"
    || node.complexity === "judgement"
    || node.required.includes("security")
    || node.required.includes("architecture")
    || node.required.includes("synthesis")
  );
}

function modelTierRank(tier: ModelCapabilityProfile["tier"]): number {
  return tier === "strong" ? 2 : tier === "balanced" ? 1 : 0;
}

export function assignWorker(request: ResourceRequest): ResourceAssignment {
  const { node, candidates, objective, mode } = request;

  // 1. Deterministic work never buys inference.
  if (node.deterministicHandlerAvailable) {
    return Object.freeze({
      policyVersion: RESOURCE_POLICY_VERSION,
      decision: "DETERMINISTIC_NO_MODEL_REQUIRED",
      agentId: null,
      provider: null,
      model: null,
      objective,
      mode,
      reason: "A deterministic handler covers this node, so no model is needed.",
      candidates: Object.freeze([]),
      prediction: predictFrom(null),
    });
  }

  const strongRequired = requiresStrongModel(node);

  // 2. Eligibility.
  const scored: ScoredWorker[] = candidates.map((candidate) => {
    const capability = checkCapability({
      required: node.required,
      agent: candidate.agent,
      model: candidate.model,
      projectId: node.projectId,
      estimatedContextTokens: node.estimatedContextTokens,
    });

    const breaker = evaluateBreaker(candidate.breaker, request.now);
    const rejections: (CapabilityRejection | "BREAKER_OPEN" | "RISK_TIER_TOO_WEAK" | CapacityRefusal | RateRefusal)[] = [
      ...capability.rejections,
    ];
    const notes: ScoreNote[] = [];

    if (!breaker.usable) {
      rejections.push("BREAKER_OPEN");
      notes.push("BREAKER_OPEN");
    }
    if (strongRequired && modelTierRank(candidate.model.tier) < 1) {
      rejections.push("RISK_TIER_TOO_WEAK");
      notes.push("RISK_REQUIRES_STRONG_MODEL");
    }
    // Capacity is a gate, not a weight. A worker at its limit is ineligible in
    // the same way an undeclared capability is -- a weight could be outvoted,
    // and exceeding a concurrency limit to save cost is not a trade anyone
    // chose. Skipped entirely when the caller tracks no reservations, so this
    // cannot become an accidental limit of zero.
    if (request.reservations) {
      const verdict = admits(
        request.reservations,
        {
          agentId: candidate.agent.agentId,
          provider: candidate.model.provider,
          model: candidate.model.model,
          projectId: node.projectId,
        },
        request.now,
        request.capacityLimits,
      );
      if (!verdict.admitted) {
        rejections.push(verdict.refusal!);
        notes.push("AT_CAPACITY");
      }
    }

    // Rate is the third gate, and it asks a question capacity cannot: not "is a
    // slot free" but "has too much happened recently". Short calls satisfy a
    // concurrency cap continuously while still exceeding a per-minute limit, so
    // one does not imply the other.
    let retryAfterMs: number | null = null;
    if (request.rateEvents) {
      const verdict = admitsRate(
        request.rateEvents,
        candidate.model.provider,
        request.now,
        node.estimatedContextTokens,
        request.ratePolicy,
      );
      if (!verdict.admitted) {
        rejections.push(verdict.refusal!);
        notes.push("RATE_LIMITED");
        retryAfterMs = verdict.retryAfterMs;
      }
    }

    if (!candidate.performance) notes.push("INSUFFICIENT_HISTORY");

    return {
      agentId: candidate.agent.agentId,
      provider: candidate.model.provider,
      model: candidate.model.model,
      eligible: rejections.length === 0,
      score: 0,
      components: {
        capabilityFit: capability.fit,
        reliability: candidate.performance?.successRate ?? null,
        speed: candidate.performance?.medianDurationMs ?? null,
        cost: candidate.performance?.meanCostUsd ?? null,
        affinity: candidate.configuredAffinity,
      },
      rejections: Object.freeze(rejections),
      retryAfterMs,
      notes: Object.freeze(notes),
      prediction: predictFrom(candidate.performance),
    };
  });

  const eligible = scored.filter((candidate) => candidate.eligible);
  const durations = eligible.map((candidate) => candidate.components.speed).filter((value): value is number => value !== null);
  const costs = eligible.map((candidate) => candidate.components.cost).filter((value): value is number => value !== null);
  const weights = OBJECTIVE_WEIGHTS[objective];

  // 3. Score. A candidate with no history scores on capability fit and
  //    configured preference alone; it is not penalised for being unmeasured,
  //    and it is not credited with performance it has not demonstrated.
  const withScores = scored.map((candidate) => {
    if (!candidate.eligible) return { ...candidate, score: 0 };

    const reliability = candidate.components.reliability;
    const speed = candidate.components.speed === null ? null : invertedNormal(candidate.components.speed, durations);
    const cost = candidate.components.cost === null ? null : invertedNormal(candidate.components.cost, costs);

    let weighted = 0;
    let applied = 0;
    if (reliability !== null) { weighted += reliability * weights.reliability; applied += weights.reliability; }
    if (speed !== null) { weighted += speed * weights.speed; applied += weights.speed; }
    if (cost !== null) { weighted += cost * weights.cost; applied += weights.cost; }
    weighted += candidate.components.affinity * weights.affinity;
    applied += weights.affinity;

    // Renormalize over the weights that had evidence, so an unmeasured
    // candidate is not diluted toward zero by dimensions nobody can score.
    const evidencedScore = applied === 0 ? 0 : weighted / applied;
    return { ...candidate, score: Number((candidate.components.capabilityFit * evidencedScore).toFixed(6)) };
  });

  const ranked = [...withScores].sort((left, right) => right.score - left.score);

  // An explicit request wins among *eligible* candidates only. An override may
  // choose a worker; it may not make an ineligible one eligible.
  const requested = (candidate: ScoredWorker) => {
    if (mode === "SPECIFIC_AGENT") return candidate.agentId === request.requestedAgentId;
    if (mode === "SPECIFIC_MODEL") return candidate.model === request.requestedModel;
    if (mode === "CLAUDE") return candidate.provider === "anthropic";
    if (mode === "CODEX") return candidate.provider === "openai";
    return false;
  };

  if (mode !== "AUTO") {
    const chosen = ranked.find((candidate) => candidate.eligible && requested(candidate));
    if (chosen) {
      return Object.freeze({
        policyVersion: RESOURCE_POLICY_VERSION,
        decision: "ASSIGNED",
        agentId: chosen.agentId,
        provider: chosen.provider,
        model: chosen.model,
        objective,
        mode,
        reason: `Explicit ${mode} request satisfied by an eligible worker.`,
        candidates: Object.freeze(ranked),
        prediction: chosen.prediction,
      });
    }

    const blocked = scored.find(requested);
    return Object.freeze({
      policyVersion: RESOURCE_POLICY_VERSION,
      decision: "REQUESTED_WORKER_INELIGIBLE",
      agentId: null,
      provider: null,
      model: null,
      objective,
      mode,
      reason: blocked
        ? `The requested worker is not eligible: ${blocked.rejections.join(", ")}.`
        : "No candidate matches the request.",
      candidates: Object.freeze(ranked),
      prediction: predictFrom(null),
    });
  }

  const best = ranked.find((candidate) => candidate.eligible);
  if (!best) {
    // Capacity is worth naming separately. "No eligible worker" reads as a
    // misconfiguration -- a missing capability, a wrong allowlist -- and sends
    // someone to change a declaration. Being at capacity is a queue, not a
    // misconfiguration, and the fix is to wait or raise a named limit.
    const capacityRefusals = new Set<string>([
      "WORKER_AT_CAPACITY",
      "PROVIDER_AT_CAPACITY",
      "PROJECT_AT_CAPACITY",
    ]);
    const capacityOnly = ranked.length > 0
      && ranked.every(
        (candidate) =>
          candidate.rejections.length > 0
          && candidate.rejections.every((rejection) => capacityRefusals.has(rejection)),
      );

    return Object.freeze({
      policyVersion: RESOURCE_POLICY_VERSION,
      decision: "NO_ELIGIBLE_WORKER",
      agentId: null,
      provider: null,
      model: null,
      objective,
      mode,
      reason: capacityOnly
        ? "Every otherwise-eligible worker is at capacity; this node waits rather than exceeding a concurrency limit."
        : "No candidate satisfied capability, availability, risk, capacity, and breaker requirements.",
      candidates: Object.freeze(ranked),
      prediction: predictFrom(null),
    });
  }

  return Object.freeze({
    policyVersion: RESOURCE_POLICY_VERSION,
    decision: "ASSIGNED",
    agentId: best.agentId,
    provider: best.provider,
    model: best.model,
    objective,
    mode,
    reason: best.notes.includes("INSUFFICIENT_HISTORY")
      ? "Highest score on declared capability and configured preference; no recorded history yet."
      : "Highest score on capability fit and observed performance.",
    candidates: Object.freeze(ranked),
    prediction: best.prediction,
  });
}
