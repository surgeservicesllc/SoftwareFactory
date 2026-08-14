// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TASK_AFFINITY,
  isRoutingProviderRequest,
  planFallback,
  providerForRequest,
  routeProvider,
  ROUTING_POLICY_VERSION,
  type ProjectRoutingPolicy,
  type ProviderAvailability,
  type RoutingRequest,
} from "@/lib/providers/routing";
import { PROVIDER_CAPABILITIES, type ProviderCapability } from "@/lib/providers/types";

const allCapabilities = PROVIDER_CAPABILITIES as readonly ProviderCapability[];

function availability(overrides: Partial<ProviderAvailability> = {}): ProviderAvailability {
  return {
    provider: "anthropic",
    state: "connected",
    capabilities: allCapabilities,
    enabledModels: ["claude-opus-5"],
    defaultModel: "claude-opus-5",
    recentSuccessRate: null,
    medianLatencyMs: null,
    declaredCostPerMillionUsd: null,
    ...overrides,
  };
}

const openaiAvailability = (overrides: Partial<ProviderAvailability> = {}) =>
  availability({
    provider: "openai",
    enabledModels: ["owner-selected-model"],
    defaultModel: "owner-selected-model",
    ...overrides,
  });

function policy(overrides: Partial<ProjectRoutingPolicy> = {}): ProjectRoutingPolicy {
  return {
    defaultProvider: "AUTO",
    allowedProviders: ["anthropic", "openai"],
    allowFallback: false,
    maximumRisk: "YELLOW",
    ...overrides,
  };
}

function request(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    taskKind: "plan",
    riskLevel: "GREEN",
    requestedProvider: "AUTO",
    policy: policy(),
    agentAssignment: null,
    availability: [availability(), openaiAvailability()],
    ...overrides,
  };
}

function reasonCodes(reasons: readonly { code: string }[]): string[] {
  return reasons.map((entry) => entry.code);
}

describe("provider request parsing", () => {
  it("recognizes only the declared request values", () => {
    expect(isRoutingProviderRequest("AUTO")).toBe(true);
    expect(isRoutingProviderRequest("CLAUDE")).toBe(false);
    expect(providerForRequest("ANTHROPIC")).toBe("anthropic");
    expect(providerForRequest("AUTO")).toBeNull();
  });
});

describe("routeProvider precedence", () => {
  it("honours an explicit owner request above every softer signal", () => {
    const decision = routeProvider(
      request({
        requestedProvider: "OPENAI",
        policy: policy({ defaultProvider: "ANTHROPIC" }),
        agentAssignment: {
          agentId: "agent-1",
          agentRole: "product",
          provider: "anthropic",
          model: "claude-opus-5",
        },
      }),
    );

    expect(decision.decision).toBe("ROUTED");
    expect(decision.provider).toBe("openai");
    expect(decision.source).toBe("OWNER_OVERRIDE");
    expect(reasonCodes(decision.reasons)).toContain("OWNER_OVERRIDE_APPLIED");
    expect(decision.policyVersion).toBe(ROUTING_POLICY_VERSION);
  });

  it("uses the agent assignment when no explicit request is made", () => {
    const decision = routeProvider(
      request({
        policy: policy({ defaultProvider: "ANTHROPIC" }),
        agentAssignment: {
          agentId: "agent-2",
          agentRole: "backend",
          provider: "openai",
          model: "owner-selected-model",
        },
      }),
    );

    expect(decision.provider).toBe("openai");
    expect(decision.model).toBe("owner-selected-model");
    expect(decision.source).toBe("AGENT_ASSIGNMENT");
  });

  it("falls through to the project default when the assignment is unavailable", () => {
    const decision = routeProvider(
      request({
        policy: policy({ defaultProvider: "ANTHROPIC" }),
        agentAssignment: {
          agentId: "agent-3",
          agentRole: "backend",
          provider: "openai",
          model: null,
        },
        availability: [availability(), openaiAvailability({ state: "not_configured" })],
      }),
    );

    expect(decision.provider).toBe("anthropic");
    expect(decision.source).toBe("PROJECT_DEFAULT");
    expect(reasonCodes(decision.reasons)).toContain("ASSIGNMENT_TARGET_UNAVAILABLE");
    expect(reasonCodes(decision.reasons)).toContain("PROVIDER_NOT_CONNECTED");
  });

  it("scores candidates when nothing stronger applies", () => {
    const decision = routeProvider(
      request({
        taskKind: "implementation_proposal",
        availability: [availability(), openaiAvailability()],
      }),
    );

    expect(decision.source).toBe("AUTO_SCORE");
    // implementation_proposal has a configured OpenAI affinity preference.
    expect(DEFAULT_TASK_AFFINITY.implementation_proposal.openai).toBeGreaterThan(
      DEFAULT_TASK_AFFINITY.implementation_proposal.anthropic,
    );
    expect(decision.provider).toBe("openai");
    expect(decision.candidates.every((candidate) => candidate.eligible)).toBe(true);
  });

  it("lets observed reliability override the affinity preference", () => {
    const decision = routeProvider(
      request({
        taskKind: "implementation_proposal",
        availability: [
          availability({ recentSuccessRate: 1, medianLatencyMs: 1_000 }),
          openaiAvailability({ recentSuccessRate: 0.1, medianLatencyMs: 110_000 }),
        ],
      }),
    );

    expect(decision.provider).toBe("anthropic");
  });

  it("produces a deterministic result for identical inputs", () => {
    const input = request({ taskKind: "qa_assessment" });
    const first = routeProvider(input);
    const second = routeProvider(input);
    expect(second.provider).toBe(first.provider);
    expect(second.model).toBe(first.model);
    expect(second.candidates.map((c) => c.score)).toEqual(first.candidates.map((c) => c.score));
  });
});

describe("routeProvider absolute rules", () => {
  it("never silently re-routes an explicit request for an unavailable provider", () => {
    const decision = routeProvider(
      request({
        requestedProvider: "OPENAI",
        availability: [availability(), openaiAvailability({ state: "error" })],
      }),
    );

    expect(decision.decision).toBe("NO_PROVIDER_AVAILABLE");
    expect(decision.provider).toBeNull();
    expect(reasonCodes(decision.reasons)).toContain("OVERRIDE_TARGET_UNAVAILABLE");
  });

  it("never selects a provider missing a required capability", () => {
    const decision = routeProvider(
      request({
        taskKind: "security_review",
        availability: [
          availability({
            capabilities: allCapabilities.filter((capability) => capability !== "security_review"),
          }),
          openaiAvailability({
            capabilities: allCapabilities.filter((capability) => capability !== "security_review"),
          }),
        ],
      }),
    );

    expect(decision.decision).toBe("NO_PROVIDER_AVAILABLE");
    expect(reasonCodes(decision.reasons)).toContain("CAPABILITY_NOT_DECLARED");
  });

  it("never selects a provider the project policy disallows", () => {
    const decision = routeProvider(
      request({ policy: policy({ allowedProviders: ["anthropic"] }) }),
    );
    expect(decision.provider).toBe("anthropic");

    const blocked = routeProvider(
      request({
        requestedProvider: "OPENAI",
        policy: policy({ allowedProviders: ["anthropic"] }),
      }),
    );
    expect(blocked.decision).toBe("NO_PROVIDER_AVAILABLE");
    expect(reasonCodes(blocked.reasons)).toContain("PROVIDER_NOT_ALLOWED_BY_POLICY");
  });

  it("rejects a provider with no enabled model", () => {
    const decision = routeProvider(
      request({
        availability: [
          availability({ enabledModels: [], defaultModel: null }),
          openaiAvailability({ enabledModels: [], defaultModel: null }),
        ],
      }),
    );

    expect(decision.decision).toBe("NO_PROVIDER_AVAILABLE");
    expect(reasonCodes(decision.reasons)).toContain("MODEL_NOT_AVAILABLE");
  });

  it("blocks a task above the project risk ceiling before choosing anything", () => {
    const decision = routeProvider(
      request({ riskLevel: "RED", policy: policy({ maximumRisk: "GREEN" }) }),
    );

    expect(decision.decision).toBe("BLOCKED_BY_RISK_POLICY");
    expect(decision.provider).toBeNull();
    expect(decision.requiresOwnerApproval).toBe(true);
    expect(reasonCodes(decision.reasons)).toContain("RISK_ABOVE_PROJECT_CEILING");
  });

  it("flags RED work as needing owner approval even when routable", () => {
    const decision = routeProvider(
      request({ riskLevel: "RED", policy: policy({ maximumRisk: "RED" }) }),
    );

    expect(decision.decision).toBe("ROUTED");
    expect(decision.requiresOwnerApproval).toBe(true);
  });
});

describe("planFallback", () => {
  const failedProvider = "anthropic" as const;

  it("refuses when the project policy does not permit fallback", () => {
    const attempt = planFallback(request(), failedProvider, {
      code: "rate_limited",
      fallbackEligible: true,
    });

    expect(attempt.allowed).toBe(false);
    expect(reasonCodes(attempt.reasons)).toContain("FALLBACK_NOT_PERMITTED_BY_POLICY");
  });

  it("refuses when the failure class is not fallback eligible", () => {
    const attempt = planFallback(request({ policy: policy({ allowFallback: true }) }), failedProvider, {
      code: "unauthorized",
      fallbackEligible: false,
    });

    expect(attempt.allowed).toBe(false);
    expect(reasonCodes(attempt.reasons)).toContain("FALLBACK_NOT_ELIGIBLE_FOR_ERROR");
  });

  it("re-routes to an eligible alternative and records why", () => {
    const attempt = planFallback(request({ policy: policy({ allowFallback: true }) }), failedProvider, {
      code: "rate_limited",
      fallbackEligible: true,
    });

    expect(attempt.allowed).toBe(true);
    expect(attempt.decision?.provider).toBe("openai");
    expect(attempt.decision?.source).toBe("FALLBACK");
    expect(reasonCodes(attempt.reasons)).toContain("FALLBACK_APPLIED");
  });

  it("does not re-select the failed provider even when it was explicitly requested", () => {
    const attempt = planFallback(
      request({
        requestedProvider: "ANTHROPIC",
        policy: policy({ allowFallback: true }),
      }),
      failedProvider,
      { code: "timeout", fallbackEligible: true },
    );

    expect(attempt.decision?.provider).toBe("openai");
  });

  it("does not widen the allowed provider set", () => {
    const attempt = planFallback(
      request({ policy: policy({ allowFallback: true, allowedProviders: ["anthropic"] }) }),
      failedProvider,
      { code: "timeout", fallbackEligible: true },
    );

    expect(attempt.allowed).toBe(false);
    expect(attempt.decision?.decision).toBe("NO_PROVIDER_AVAILABLE");
  });
});
