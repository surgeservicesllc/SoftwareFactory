import type { RiskLevel } from "@/lib/risk";
import { isWithinRiskCeiling } from "@/lib/risk";

import {
  PROVIDER_LABELS,
  TASK_KIND_REQUIRED_CAPABILITIES,
  type AgentRole,
  type ProviderCapability,
  type ProviderConnectionState,
  type ProviderId,
  type ProviderTaskKind,
} from "@/lib/providers/types";

/**
 * The Orchestrator routing engine.
 *
 * This module is pure: identical inputs always produce an identical decision,
 * and every decision carries machine-readable reasons. Two rules sit above all
 * precedence and cannot be overridden by policy, assignment, or owner request:
 *
 *  1. A provider that does not declare a required capability is never chosen.
 *  2. A provider that is not `connected` is never chosen. An explicit request
 *     for an unavailable provider fails loudly rather than degrading silently.
 */

export const ROUTING_POLICY_VERSION = "phase2a-routing-v1";

/** What the caller asked for. `AUTO` delegates the choice to the engine. */
export const ROUTING_PROVIDER_REQUESTS = ["AUTO", "ANTHROPIC", "OPENAI"] as const;

export type RoutingProviderRequest = (typeof ROUTING_PROVIDER_REQUESTS)[number];

export function isRoutingProviderRequest(value: unknown): value is RoutingProviderRequest {
  return (
    typeof value === "string" &&
    (ROUTING_PROVIDER_REQUESTS as readonly string[]).includes(value)
  );
}

const REQUEST_TO_PROVIDER: Record<Exclude<RoutingProviderRequest, "AUTO">, ProviderId> = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
};

export function providerForRequest(request: RoutingProviderRequest): ProviderId | null {
  return request === "AUTO" ? null : REQUEST_TO_PROVIDER[request];
}

export type RoutingReasonCode =
  | "OWNER_OVERRIDE_APPLIED"
  | "AGENT_ASSIGNMENT_APPLIED"
  | "PROJECT_DEFAULT_APPLIED"
  | "AUTO_SCORE_SELECTED"
  | "OVERRIDE_TARGET_UNAVAILABLE"
  | "ASSIGNMENT_TARGET_UNAVAILABLE"
  | "PROJECT_DEFAULT_UNAVAILABLE"
  | "PROVIDER_NOT_CONNECTED"
  | "PROVIDER_NOT_ALLOWED_BY_POLICY"
  | "CAPABILITY_NOT_DECLARED"
  | "MODEL_NOT_AVAILABLE"
  | "EXCLUDED_BY_FALLBACK"
  | "NO_ELIGIBLE_PROVIDER"
  | "RISK_ABOVE_PROJECT_CEILING"
  | "FALLBACK_APPLIED"
  | "FALLBACK_NOT_PERMITTED_BY_POLICY"
  | "FALLBACK_NOT_ELIGIBLE_FOR_ERROR";

export interface RoutingReason {
  readonly code: RoutingReasonCode;
  readonly provider: ProviderId | null;
  readonly detail: string;
}

export interface ProviderAvailability {
  readonly provider: ProviderId;
  readonly state: ProviderConnectionState;
  readonly capabilities: readonly ProviderCapability[];
  /** Models the organization has enabled for this provider. */
  readonly enabledModels: readonly string[];
  readonly defaultModel: string | null;
  /** Observed success rate over recent runs, 0-1. Null when no history. */
  readonly recentSuccessRate: number | null;
  /** Observed median latency in milliseconds. Null when no history. */
  readonly medianLatencyMs: number | null;
  /** Blended declared price per million tokens. Null when not declared. */
  readonly declaredCostPerMillionUsd: number | null;
}

export interface ProjectRoutingPolicy {
  /** The project's preferred provider when no stronger signal exists. */
  readonly defaultProvider: RoutingProviderRequest;
  /** Providers this project may use at all. An empty list allows none. */
  readonly allowedProviders: readonly ProviderId[];
  readonly allowFallback: boolean;
  readonly maximumRisk: RiskLevel;
}

export interface AgentProviderAssignment {
  readonly agentId: string;
  readonly agentRole: AgentRole;
  readonly provider: ProviderId | null;
  readonly model: string | null;
}

export interface RoutingRequest {
  readonly taskKind: ProviderTaskKind;
  readonly riskLevel: RiskLevel;
  /** An explicit owner or caller request. Wins over every softer signal. */
  readonly requestedProvider: RoutingProviderRequest;
  readonly policy: ProjectRoutingPolicy;
  readonly agentAssignment: AgentProviderAssignment | null;
  readonly availability: readonly ProviderAvailability[];
  /** Providers already tried in this attempt chain. */
  readonly excludedProviders?: readonly ProviderId[];
}

export type RoutingSource =
  | "OWNER_OVERRIDE"
  | "AGENT_ASSIGNMENT"
  | "PROJECT_DEFAULT"
  | "AUTO_SCORE"
  | "FALLBACK";

export interface ScoredCandidate {
  readonly provider: ProviderId;
  readonly model: string | null;
  readonly eligible: boolean;
  /** Composite score in 0-1. Zero for ineligible candidates. */
  readonly score: number;
  readonly components: {
    readonly reliability: number;
    readonly latency: number;
    readonly cost: number;
    readonly affinity: number;
  };
  readonly ineligibleReasons: readonly RoutingReasonCode[];
}

export type RoutingDecisionKind =
  | "ROUTED"
  | "NO_PROVIDER_AVAILABLE"
  | "BLOCKED_BY_RISK_POLICY";

export interface RoutingDecision {
  readonly policyVersion: typeof ROUTING_POLICY_VERSION;
  readonly decision: RoutingDecisionKind;
  readonly provider: ProviderId | null;
  readonly model: string | null;
  readonly source: RoutingSource | null;
  readonly requiredCapabilities: readonly ProviderCapability[];
  readonly reasons: readonly RoutingReason[];
  readonly candidates: readonly ScoredCandidate[];
  /** True when the risk tier still needs an explicit owner approval to run. */
  readonly requiresOwnerApproval: boolean;
}

/**
 * Default task affinity.
 *
 * This is a *configured preference*, not a benchmark claim: it encodes the
 * owner's stated split of planning and review work toward Anthropic and
 * implementation-shaped work toward OpenAI. Values are 0-1 and only break ties
 * between providers that are already eligible. An organization changes the
 * split by setting an explicit agent assignment or project default, both of
 * which outrank scoring entirely.
 */
export const DEFAULT_TASK_AFFINITY: Readonly<
  Record<ProviderTaskKind, Readonly<Record<ProviderId, number>>>
> = Object.freeze({
  plan: Object.freeze({ anthropic: 0.9, openai: 0.6 }),
  architecture_review: Object.freeze({ anthropic: 0.9, openai: 0.6 }),
  implementation_proposal: Object.freeze({ anthropic: 0.6, openai: 0.9 }),
  implementation_review: Object.freeze({ anthropic: 0.75, openai: 0.75 }),
  security_review: Object.freeze({ anthropic: 0.85, openai: 0.65 }),
  qa_assessment: Object.freeze({ anthropic: 0.7, openai: 0.7 }),
  status_report: Object.freeze({ anthropic: 0.8, openai: 0.6 }),
});

const SCORE_WEIGHTS = Object.freeze({
  reliability: 0.35,
  latency: 0.2,
  cost: 0.15,
  affinity: 0.3,
});

/** Neutral assumptions used when a provider has no observed history yet. */
const UNKNOWN_RELIABILITY = 0.7;
const UNKNOWN_LATENCY_SCORE = 0.5;
const UNKNOWN_COST_SCORE = 0.5;
const LATENCY_CEILING_MS = 120_000;

function reason(
  code: RoutingReasonCode,
  provider: ProviderId | null,
  detail: string,
): RoutingReason {
  return Object.freeze({ code, provider, detail });
}

function resolveModel(
  availability: ProviderAvailability,
  preferredModel: string | null,
): string | null {
  if (preferredModel && availability.enabledModels.includes(preferredModel)) {
    return preferredModel;
  }
  if (
    availability.defaultModel &&
    availability.enabledModels.includes(availability.defaultModel)
  ) {
    return availability.defaultModel;
  }
  return availability.enabledModels[0] ?? null;
}

function latencyScore(medianLatencyMs: number | null): number {
  if (medianLatencyMs === null || !Number.isFinite(medianLatencyMs) || medianLatencyMs < 0) {
    return UNKNOWN_LATENCY_SCORE;
  }
  return 1 - Math.min(medianLatencyMs, LATENCY_CEILING_MS) / LATENCY_CEILING_MS;
}

function costScore(
  declaredCostPerMillionUsd: number | null,
  maxDeclaredCost: number,
): number {
  if (
    declaredCostPerMillionUsd === null ||
    !Number.isFinite(declaredCostPerMillionUsd) ||
    declaredCostPerMillionUsd < 0 ||
    maxDeclaredCost <= 0
  ) {
    return UNKNOWN_COST_SCORE;
  }
  return 1 - Math.min(declaredCostPerMillionUsd, maxDeclaredCost) / maxDeclaredCost;
}

function reliabilityScore(recentSuccessRate: number | null): number {
  if (
    recentSuccessRate === null ||
    !Number.isFinite(recentSuccessRate) ||
    recentSuccessRate < 0 ||
    recentSuccessRate > 1
  ) {
    return UNKNOWN_RELIABILITY;
  }
  return recentSuccessRate;
}

function evaluateCandidates(request: RoutingRequest): readonly ScoredCandidate[] {
  const required = TASK_KIND_REQUIRED_CAPABILITIES[request.taskKind];
  const excluded = new Set(request.excludedProviders ?? []);
  const affinity = DEFAULT_TASK_AFFINITY[request.taskKind];

  const maxDeclaredCost = request.availability.reduce((highest, item) => {
    const value = item.declaredCostPerMillionUsd;
    return value !== null && Number.isFinite(value) && value > highest ? value : highest;
  }, 0);

  return Object.freeze(
    request.availability.map((availability) => {
      const ineligibleReasons: RoutingReasonCode[] = [];

      if (excluded.has(availability.provider)) {
        ineligibleReasons.push("EXCLUDED_BY_FALLBACK");
      }
      if (!request.policy.allowedProviders.includes(availability.provider)) {
        ineligibleReasons.push("PROVIDER_NOT_ALLOWED_BY_POLICY");
      }
      if (availability.state !== "connected") {
        ineligibleReasons.push("PROVIDER_NOT_CONNECTED");
      }
      if (!required.every((capability) => availability.capabilities.includes(capability))) {
        ineligibleReasons.push("CAPABILITY_NOT_DECLARED");
      }

      const model = resolveModel(
        availability,
        request.agentAssignment?.provider === availability.provider
          ? request.agentAssignment.model
          : null,
      );
      if (!model) {
        ineligibleReasons.push("MODEL_NOT_AVAILABLE");
      }

      const eligible = ineligibleReasons.length === 0;
      const components = Object.freeze({
        reliability: reliabilityScore(availability.recentSuccessRate),
        latency: latencyScore(availability.medianLatencyMs),
        cost: costScore(availability.declaredCostPerMillionUsd, maxDeclaredCost),
        affinity: affinity[availability.provider] ?? 0.5,
      });

      const score = eligible
        ? components.reliability * SCORE_WEIGHTS.reliability +
          components.latency * SCORE_WEIGHTS.latency +
          components.cost * SCORE_WEIGHTS.cost +
          components.affinity * SCORE_WEIGHTS.affinity
        : 0;

      return Object.freeze({
        provider: availability.provider,
        model,
        eligible,
        score: Number(score.toFixed(6)),
        components,
        ineligibleReasons: Object.freeze(ineligibleReasons),
      });
    }),
  );
}

function describeIneligibility(candidate: ScoredCandidate): string {
  const label = PROVIDER_LABELS[candidate.provider];
  const detail: Record<RoutingReasonCode, string> = {
    EXCLUDED_BY_FALLBACK: `${label} already failed in this attempt chain.`,
    PROVIDER_NOT_ALLOWED_BY_POLICY: `${label} is not in the project's allowed provider list.`,
    PROVIDER_NOT_CONNECTED: `${label} is not connected.`,
    CAPABILITY_NOT_DECLARED: `${label} does not declare every capability this task requires.`,
    MODEL_NOT_AVAILABLE: `${label} has no enabled model configured.`,
  } as Record<RoutingReasonCode, string>;

  return candidate.ineligibleReasons
    .map((code) => detail[code] ?? `${label} is unavailable.`)
    .join(" ");
}

function ineligibilityReasons(candidate: ScoredCandidate): readonly RoutingReason[] {
  return candidate.ineligibleReasons.map((code) =>
    reason(code, candidate.provider, describeIneligibility(candidate)),
  );
}

/**
 * Select a provider and model for one task.
 *
 * Precedence, strongest first: explicit caller request, agent assignment,
 * project default, automatic score. Capability and availability filtering
 * applies at every level, so a stronger signal can lose to an absolute rule
 * but never the other way round.
 */
export function routeProvider(request: RoutingRequest): RoutingDecision {
  const requiredCapabilities = TASK_KIND_REQUIRED_CAPABILITIES[request.taskKind];
  const candidates = evaluateCandidates(request);
  const reasons: RoutingReason[] = [];
  const requiresOwnerApproval = request.riskLevel === "RED";

  if (!isWithinRiskCeiling(request.riskLevel, request.policy.maximumRisk)) {
    reasons.push(
      reason(
        "RISK_ABOVE_PROJECT_CEILING",
        null,
        `${request.riskLevel} exceeds the project's ${request.policy.maximumRisk} routing ceiling.`,
      ),
    );
    return Object.freeze({
      policyVersion: ROUTING_POLICY_VERSION,
      decision: "BLOCKED_BY_RISK_POLICY",
      provider: null,
      model: null,
      source: null,
      requiredCapabilities,
      reasons: Object.freeze(reasons),
      candidates,
      requiresOwnerApproval,
    });
  }

  const byProvider = new Map(candidates.map((candidate) => [candidate.provider, candidate]));

  const routed = (
    candidate: ScoredCandidate,
    source: RoutingSource,
    code: RoutingReasonCode,
    detail: string,
  ): RoutingDecision => {
    reasons.push(reason(code, candidate.provider, detail));
    return Object.freeze({
      policyVersion: ROUTING_POLICY_VERSION,
      decision: "ROUTED",
      provider: candidate.provider,
      model: candidate.model,
      source,
      requiredCapabilities,
      reasons: Object.freeze(reasons),
      candidates,
      requiresOwnerApproval,
    });
  };

  const unavailable = (
    code: RoutingReasonCode,
    candidate: ScoredCandidate | undefined,
    provider: ProviderId,
    detail: string,
  ): RoutingDecision => {
    reasons.push(reason(code, provider, detail));
    if (candidate) reasons.push(...ineligibilityReasons(candidate));
    return Object.freeze({
      policyVersion: ROUTING_POLICY_VERSION,
      decision: "NO_PROVIDER_AVAILABLE",
      provider: null,
      model: null,
      source: null,
      requiredCapabilities,
      reasons: Object.freeze(reasons),
      candidates,
      requiresOwnerApproval,
    });
  };

  // 1. Explicit caller request. Never silently degrades to another provider.
  const requestedProvider = providerForRequest(request.requestedProvider);
  if (requestedProvider) {
    const candidate = byProvider.get(requestedProvider);
    if (candidate?.eligible) {
      return routed(
        candidate,
        "OWNER_OVERRIDE",
        "OWNER_OVERRIDE_APPLIED",
        `${PROVIDER_LABELS[requestedProvider]} was explicitly requested and is eligible.`,
      );
    }
    return unavailable(
      "OVERRIDE_TARGET_UNAVAILABLE",
      candidate,
      requestedProvider,
      `${PROVIDER_LABELS[requestedProvider]} was explicitly requested but cannot run this task. The request was not re-routed.`,
    );
  }

  // 2. Per-agent assignment.
  const assignedProvider = request.agentAssignment?.provider ?? null;
  if (assignedProvider) {
    const candidate = byProvider.get(assignedProvider);
    if (candidate?.eligible) {
      return routed(
        candidate,
        "AGENT_ASSIGNMENT",
        "AGENT_ASSIGNMENT_APPLIED",
        `The ${request.agentAssignment?.agentRole ?? "assigned"} agent is bound to ${PROVIDER_LABELS[assignedProvider]}.`,
      );
    }
    reasons.push(
      reason(
        "ASSIGNMENT_TARGET_UNAVAILABLE",
        assignedProvider,
        `The agent's assigned provider ${PROVIDER_LABELS[assignedProvider]} is not eligible; continuing to the project default.`,
      ),
    );
    if (candidate) reasons.push(...ineligibilityReasons(candidate));
  }

  // 3. Project default.
  const defaultProvider = providerForRequest(request.policy.defaultProvider);
  if (defaultProvider) {
    const candidate = byProvider.get(defaultProvider);
    if (candidate?.eligible) {
      return routed(
        candidate,
        "PROJECT_DEFAULT",
        "PROJECT_DEFAULT_APPLIED",
        `The project default provider is ${PROVIDER_LABELS[defaultProvider]}.`,
      );
    }
    reasons.push(
      reason(
        "PROJECT_DEFAULT_UNAVAILABLE",
        defaultProvider,
        `The project default ${PROVIDER_LABELS[defaultProvider]} is not eligible; scoring the remaining providers.`,
      ),
    );
    if (candidate) reasons.push(...ineligibilityReasons(candidate));
  }

  // 4. Automatic scoring over the eligible remainder.
  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) {
    reasons.push(
      reason(
        "NO_ELIGIBLE_PROVIDER",
        null,
        "No connected provider declares the capabilities this task requires.",
      ),
    );
    for (const candidate of candidates) reasons.push(...ineligibilityReasons(candidate));
    return Object.freeze({
      policyVersion: ROUTING_POLICY_VERSION,
      decision: "NO_PROVIDER_AVAILABLE",
      provider: null,
      model: null,
      source: null,
      requiredCapabilities,
      reasons: Object.freeze(reasons),
      candidates,
      requiresOwnerApproval,
    });
  }

  // Ties resolve by provider id so the decision stays deterministic.
  const best = [...eligible].sort(
    (left, right) => right.score - left.score || left.provider.localeCompare(right.provider),
  )[0];

  return routed(
    best,
    "AUTO_SCORE",
    "AUTO_SCORE_SELECTED",
    `${PROVIDER_LABELS[best.provider]} scored highest at ${best.score.toFixed(3)} across reliability, latency, cost, and configured task affinity.`,
  );
}

export interface FallbackAttempt {
  readonly allowed: boolean;
  readonly decision: RoutingDecision | null;
  readonly reasons: readonly RoutingReason[];
}

/**
 * Plan a controlled fallback after a primary provider failed.
 *
 * Fallback requires all of: the project policy allows it, the primary error is
 * declared fallback eligible, and a different provider independently satisfies
 * every capability, policy, and availability rule. Fallback never widens the
 * allowed provider set, never changes the risk tier, and never substitutes for
 * an independent reviewer.
 */
export function planFallback(
  request: RoutingRequest,
  failedProvider: ProviderId,
  failure: { readonly code: string; readonly fallbackEligible: boolean },
): FallbackAttempt {
  if (!request.policy.allowFallback) {
    return Object.freeze({
      allowed: false,
      decision: null,
      reasons: Object.freeze([
        reason(
          "FALLBACK_NOT_PERMITTED_BY_POLICY",
          failedProvider,
          "The project policy does not permit provider fallback.",
        ),
      ]),
    });
  }

  if (!failure.fallbackEligible) {
    return Object.freeze({
      allowed: false,
      decision: null,
      reasons: Object.freeze([
        reason(
          "FALLBACK_NOT_ELIGIBLE_FOR_ERROR",
          failedProvider,
          `A ${failure.code} failure is not eligible for fallback; it must reach the owner.`,
        ),
      ]),
    });
  }

  const excludedProviders = Object.freeze([
    ...new Set([...(request.excludedProviders ?? []), failedProvider]),
  ]);

  // A fallback attempt is never an owner override: drop the explicit request
  // so the engine re-selects under policy rather than re-picking the failure.
  const decision = routeProvider({
    ...request,
    requestedProvider: "AUTO",
    excludedProviders,
  });

  if (decision.decision !== "ROUTED" || !decision.provider) {
    return Object.freeze({ allowed: false, decision, reasons: decision.reasons });
  }

  const fallbackDecision: RoutingDecision = Object.freeze({
    ...decision,
    source: "FALLBACK",
    reasons: Object.freeze([
      reason(
        "FALLBACK_APPLIED",
        decision.provider,
        `${PROVIDER_LABELS[failedProvider]} failed with ${failure.code}; retrying once on ${PROVIDER_LABELS[decision.provider]}.`,
      ),
      ...decision.reasons,
    ]),
  });

  return Object.freeze({
    allowed: true,
    decision: fallbackDecision,
    reasons: fallbackDecision.reasons,
  });
}
