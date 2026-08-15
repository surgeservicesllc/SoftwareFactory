import { describe, expect, it } from "vitest";

import {
  BREAKER_FAULT_EXPLANATIONS,
  COOLDOWN_MS,
  closedBreaker,
  evaluateBreaker,
  recordFault,
  recordSuccess,
} from "@/lib/resources/breakers";
import { checkCapability, type AgentCapabilityProfile, type ModelCapabilityProfile } from "@/lib/resources/capabilities";
import {
  MINIMUM_SAMPLES,
  MINIMUM_SAMPLES_FOR_PREFERENCE_CHANGE,
  mayChangePreference,
  measureRegret,
  predictFrom,
  summarizePerformance,
  type RunOutcome,
} from "@/lib/resources/history";
import { DEFAULT_CAPACITY_LIMITS, type Reservation } from "@/lib/resources/capacity";
import { assignWorker, type ResourceNode, type WorkerCandidate } from "@/lib/resources/manager";

const agent: AgentCapabilityProfile = {
  agentId: "agent-backend",
  role: "backend",
  capabilities: ["coding", "backend", "qa"],
  available: true,
  allowedProjectIds: [],
};

const strongModel: ModelCapabilityProfile = {
  provider: "anthropic",
  model: "claude-strong",
  capabilities: ["coding", "backend", "qa", "architecture", "security", "synthesis", "review"],
  contextLimitTokens: 200_000,
  tier: "strong",
  available: true,
};

const cheapModel: ModelCapabilityProfile = {
  provider: "openai",
  model: "gpt-economical",
  capabilities: ["coding", "backend", "qa"],
  contextLimitTokens: 32_000,
  tier: "economical",
  available: true,
};

function outcomes(count: number, overrides: Partial<RunOutcome> = {}): RunOutcome[] {
  return Array.from({ length: count }, () => ({
    succeeded: true,
    durationMs: 1_000,
    retries: 0,
    verificationPassed: true,
    reviewRequestedChanges: false,
    costUsd: 0.01,
    failureType: null,
    ...overrides,
  }));
}

function candidate(overrides: Partial<WorkerCandidate> = {}): WorkerCandidate {
  return {
    agent,
    model: cheapModel,
    performance: null,
    configuredAffinity: 0.5,
    breaker: closedBreaker("openai/gpt-economical"),
    ...overrides,
  };
}

const simpleNode: ResourceNode = {
  nodeId: "node-1",
  projectId: "project-1",
  required: ["coding", "backend"],
  complexity: "bounded",
  riskLevel: "GREEN",
  estimatedContextTokens: 8_000,
  deterministicHandlerAvailable: false,
};

describe("capability registry", () => {
  it("collects every reason a pair is ineligible rather than the first", () => {
    const result = checkCapability({
      required: ["coding", "security"],
      agent: { ...agent, available: false, allowedProjectIds: ["other-project"] },
      model: { ...cheapModel, available: false },
      projectId: "project-1",
      estimatedContextTokens: 999_999,
    });

    expect(result.eligible).toBe(false);
    expect(result.rejections).toContain("AGENT_UNAVAILABLE");
    expect(result.rejections).toContain("MODEL_UNAVAILABLE");
    expect(result.rejections).toContain("AGENT_NOT_ALLOWED_ON_PROJECT");
    expect(result.rejections).toContain("AGENT_LACKS_CAPABILITY");
    expect(result.rejections).toContain("MODEL_LACKS_CAPABILITY");
    expect(result.rejections).toContain("CONTEXT_TOO_SMALL");
  });

  it("treats the project list as an allowlist, so an unlisted project is denied", () => {
    const restricted = { ...agent, allowedProjectIds: ["project-a"] };
    expect(
      checkCapability({ required: ["coding"], agent: restricted, model: cheapModel, projectId: "project-a", estimatedContextTokens: 10 }).eligible,
    ).toBe(true);
    expect(
      checkCapability({ required: ["coding"], agent: restricted, model: cheapModel, projectId: "project-b", estimatedContextTokens: 10 }).rejections,
    ).toContain("AGENT_NOT_ALLOWED_ON_PROJECT");
  });

  it("scores fit over the pair, so a capability either side lacks is not met", () => {
    const result = checkCapability({
      required: ["coding", "security"],
      agent,
      model: strongModel,
      projectId: "project-1",
      estimatedContextTokens: 10,
    });
    // The model has security; the agent does not, so only one of two is met.
    expect(result.fit).toBe(0.5);
    expect(result.eligible).toBe(false);
  });
});

describe("observed history", () => {
  it("refuses to summarize below the minimum sample count", () => {
    expect(summarizePerformance(outcomes(MINIMUM_SAMPLES - 1))).toBeNull();
    expect(summarizePerformance(outcomes(MINIMUM_SAMPLES))).not.toBeNull();
  });

  it("reports a sub-population rate as null rather than as zero", () => {
    const performance = summarizePerformance(
      outcomes(6, { reviewRequestedChanges: null, costUsd: null }),
    );
    expect(performance?.reviewRejectionRate).toBeNull();
    expect(performance?.meanCostUsd).toBeNull();
    // "No review data" must never read as "no rejections".
    expect(performance?.reviewRejectionRate).not.toBe(0);
  });

  it("produces an unevidenced prediction when there is no history", () => {
    const prediction = predictFrom(null);
    expect(prediction.evidenced).toBe(false);
    expect(prediction.expectedSuccessRate).toBeNull();
  });

  it("does not score regret against a prediction that was a guess", () => {
    const regret = measureRegret(predictFrom(null), {
      succeeded: false, durationMs: 5_000, retries: 1,
      verificationPassed: false, reviewRequestedChanges: null, costUsd: null, failureType: "timeout",
    });
    expect(regret.comparable).toBe(false);
    expect(regret.successRegret).toBeNull();
  });

  it("measures regret once the prediction rested on evidence", () => {
    const prediction = predictFrom(summarizePerformance(outcomes(10)));
    const regret = measureRegret(prediction, {
      succeeded: false, durationMs: 3_000, retries: 2,
      verificationPassed: false, reviewRequestedChanges: true, costUsd: 0.05, failureType: "validation",
    });
    expect(regret.comparable).toBe(true);
    expect(regret.successRegret).toBe(1);
    expect(regret.durationRegretMs).toBe(2_000);
    expect(regret.costRegretUsd).toBeCloseTo(0.04);
  });

  it("holds a standing preference until both sides have enough evidence and a real margin", () => {
    const thin = summarizePerformance(outcomes(MINIMUM_SAMPLES));
    const plenty = summarizePerformance(outcomes(MINIMUM_SAMPLES_FOR_PREFERENCE_CHANGE));
    const weakerIncumbent = summarizePerformance(
      outcomes(MINIMUM_SAMPLES_FOR_PREFERENCE_CHANGE).map((outcome, index) => ({
        ...outcome,
        succeeded: index > 4,
      })),
    );

    expect(mayChangePreference(thin, plenty).allowed).toBe(false);
    expect(mayChangePreference(plenty, thin).allowed).toBe(false);
    // Equal performance is not a reason to switch.
    expect(mayChangePreference(plenty, plenty).allowed).toBe(false);
    expect(mayChangePreference(plenty, weakerIncumbent).allowed).toBe(true);
  });
});

describe("circuit breakers", () => {
  it("opens only after the fault threshold for that fault class", () => {
    let breaker = closedBreaker("openai");
    breaker = recordFault(breaker, "rate_limit", 0);
    expect(breaker.state).toBe("closed");
    breaker = recordFault(breaker, "rate_limit", 10);
    expect(breaker.state).toBe("open");
    expect(breaker.reason).toMatch(/rate limit/i);
  });

  it("restarts counting when the fault class changes", () => {
    let breaker = closedBreaker("openai");
    breaker = recordFault(breaker, "outage", 0);
    breaker = recordFault(breaker, "outage", 1);
    breaker = recordFault(breaker, "rate_limit", 2);
    // Two outages plus one rate limit is not three of anything.
    expect(breaker.state).toBe("closed");
    expect(breaker.consecutiveFaults).toBe(1);
  });

  it("suppresses work while open and says when it will retry", () => {
    let breaker = closedBreaker("openai");
    breaker = recordFault(breaker, "rate_limit", 0);
    breaker = recordFault(breaker, "rate_limit", 0);

    const during = evaluateBreaker(breaker, 1_000);
    expect(during.usable).toBe(false);
    expect(during.reason).toMatch(/retrying in \d+s/i);
  });

  it("half-opens automatically after the cooldown", () => {
    let breaker = closedBreaker("openai");
    breaker = recordFault(breaker, "rate_limit", 0);
    breaker = recordFault(breaker, "rate_limit", 0);

    const after = evaluateBreaker(breaker, COOLDOWN_MS.rate_limit);
    expect(after.usable).toBe(true);
    expect(after.state).toBe("half_open");
  });

  it("closes outright on a success", () => {
    let breaker = closedBreaker("openai");
    breaker = recordFault(breaker, "outage", 0);
    breaker = recordSuccess(breaker);
    expect(breaker.state).toBe("closed");
    expect(breaker.consecutiveFaults).toBe(0);
  });

  it("explains every fault class it can open on", () => {
    for (const fault of Object.keys(COOLDOWN_MS) as (keyof typeof COOLDOWN_MS)[]) {
      expect(BREAKER_FAULT_EXPLANATIONS[fault]).toBeTruthy();
    }
  });
});

describe("resource manager assignment", () => {
  it("spends no inference when a deterministic handler covers the node", () => {
    const result = assignWorker({
      node: { ...simpleNode, deterministicHandlerAvailable: true },
      candidates: [candidate()],
      objective: "BALANCED",
      mode: "AUTO",
      now: 0,
    });
    expect(result.decision).toBe("DETERMINISTIC_NO_MODEL_REQUIRED");
    expect(result.model).toBeNull();
  });

  it("routes a simple bounded node to the economical model", () => {
    const result = assignWorker({
      node: simpleNode,
      candidates: [
        candidate({ model: cheapModel, configuredAffinity: 0.6 }),
        candidate({ model: strongModel, configuredAffinity: 0.5, breaker: closedBreaker("anthropic") }),
      ],
      objective: "COST",
      mode: "AUTO",
      now: 0,
    });
    expect(result.decision).toBe("ASSIGNED");
    expect(result.model).toBe("gpt-economical");
  });

  it("refuses to send judgement or RED work to an economical model, whatever the objective", () => {
    for (const node of [
      { ...simpleNode, complexity: "judgement" as const },
      { ...simpleNode, riskLevel: "RED" as const },
      { ...simpleNode, required: ["security"] as const },
    ]) {
      const result = assignWorker({
        node: { ...simpleNode, ...node },
        candidates: [candidate({ model: cheapModel })],
        // Even asking explicitly for the cheapest option must not weaken this.
        objective: "COST",
        mode: "AUTO",
        now: 0,
      });
      expect(result.decision).toBe("NO_ELIGIBLE_WORKER");
      expect(result.candidates[0]?.rejections).toContain("RISK_TIER_TOO_WEAK");
    }
  });

  it("routes judgement work to the stronger model when one is eligible", () => {
    const architect: AgentCapabilityProfile = {
      ...agent, agentId: "agent-architect", capabilities: ["architecture", "synthesis", "coding"],
    };
    const result = assignWorker({
      node: { ...simpleNode, required: ["architecture"], complexity: "judgement" },
      candidates: [
        candidate({ agent: architect, model: cheapModel }),
        candidate({ agent: architect, model: strongModel, breaker: closedBreaker("anthropic") }),
      ],
      objective: "BALANCED",
      mode: "AUTO",
      now: 0,
    });
    expect(result.decision).toBe("ASSIGNED");
    expect(result.model).toBe("claude-strong");
  });

  it("marks an unmeasured candidate INSUFFICIENT_HISTORY and predicts nothing", () => {
    const result = assignWorker({
      node: simpleNode,
      candidates: [candidate()],
      objective: "QUALITY",
      mode: "AUTO",
      now: 0,
    });
    expect(result.decision).toBe("ASSIGNED");
    expect(result.candidates[0]?.notes).toContain("INSUFFICIENT_HISTORY");
    expect(result.prediction.evidenced).toBe(false);
    expect(result.reason).toMatch(/no recorded history yet/i);
  });

  it("prefers the candidate with a better observed record once both are measured", () => {
    const reliable = summarizePerformance(outcomes(10));
    const unreliable = summarizePerformance(
      outcomes(10).map((outcome, index) => ({ ...outcome, succeeded: index > 6 })),
    );
    const result = assignWorker({
      node: simpleNode,
      candidates: [
        candidate({ agent: { ...agent, agentId: "agent-weak" }, performance: unreliable, configuredAffinity: 0.9 }),
        candidate({ agent: { ...agent, agentId: "agent-strong" }, performance: reliable, configuredAffinity: 0.5 }),
      ],
      objective: "QUALITY",
      mode: "AUTO",
      now: 0,
    });
    expect(result.agentId).toBe("agent-strong");
    expect(result.prediction.evidenced).toBe(true);
  });

  it("excludes a candidate whose breaker is open, and reinstates it after cooldown", () => {
    let breaker = closedBreaker("openai/gpt-economical");
    breaker = recordFault(breaker, "rate_limit", 0);
    breaker = recordFault(breaker, "rate_limit", 0);

    const suppressed = assignWorker({
      node: simpleNode, candidates: [candidate({ breaker })], objective: "BALANCED", mode: "AUTO", now: 1_000,
    });
    expect(suppressed.decision).toBe("NO_ELIGIBLE_WORKER");
    expect(suppressed.candidates[0]?.notes).toContain("BREAKER_OPEN");

    const reinstated = assignWorker({
      node: simpleNode, candidates: [candidate({ breaker })], objective: "BALANCED", mode: "AUTO",
      now: COOLDOWN_MS.rate_limit,
    });
    expect(reinstated.decision).toBe("ASSIGNED");
  });

  it("honours an owner override among eligible workers", () => {
    const result = assignWorker({
      node: simpleNode,
      candidates: [
        candidate({ model: cheapModel, configuredAffinity: 0.9 }),
        candidate({ model: strongModel, configuredAffinity: 0.1, breaker: closedBreaker("anthropic") }),
      ],
      objective: "COST",
      mode: "CLAUDE",
      now: 0,
    });
    expect(result.decision).toBe("ASSIGNED");
    expect(result.provider).toBe("anthropic");
  });

  it("never lets an override make an ineligible worker eligible", () => {
    const result = assignWorker({
      node: { ...simpleNode, riskLevel: "RED" },
      candidates: [candidate({ model: cheapModel })],
      objective: "QUALITY",
      mode: "SPECIFIC_MODEL",
      requestedModel: "gpt-economical",
      now: 0,
    });
    expect(result.decision).toBe("REQUESTED_WORKER_INELIGIBLE");
    expect(result.model).toBeNull();
    expect(result.reason).toMatch(/not eligible/i);
  });

  it("records why every candidate lost, not only who won", () => {
    const result = assignWorker({
      node: simpleNode,
      candidates: [
        candidate({ agent: { ...agent, agentId: "agent-unavailable", available: false } }),
        candidate({ agent: { ...agent, agentId: "agent-ok" } }),
      ],
      objective: "BALANCED",
      mode: "AUTO",
      now: 0,
    });
    const loser = result.candidates.find((entry) => entry.agentId === "agent-unavailable");
    expect(loser?.eligible).toBe(false);
    expect(loser?.rejections).toContain("AGENT_UNAVAILABLE");
  });
});

describe("capacity as an assignment gate", () => {
  const busy = (count: number, overrides: Partial<Reservation> = {}): Reservation[] =>
    Array.from({ length: count }, () => ({
      agentId: "agent-backend",
      provider: "openai",
      model: "gpt-economical",
      projectId: "project-1",
      expiresAt: 10_000,
      ...overrides,
    }));

  it("leaves behaviour unchanged for a caller that tracks no reservations", () => {
    // The field is optional on purpose: absent must mean "not tracked", never
    // an implicit limit of zero, which would refuse everything and read as a
    // routing bug rather than a capacity one.
    const result = assignWorker({
      node: simpleNode,
      candidates: [candidate()],
      objective: "BALANCED",
      mode: "AUTO",
      now: 0,
    });
    expect(result.decision).toBe("ASSIGNED");
    expect(result.candidates[0]?.notes).not.toContain("AT_CAPACITY");
  });

  it("makes a worker at its own limit ineligible rather than merely lower-scoring", () => {
    const result = assignWorker({
      node: simpleNode,
      candidates: [candidate()],
      objective: "BALANCED",
      mode: "AUTO",
      reservations: busy(DEFAULT_CAPACITY_LIMITS.perWorker),
      now: 0,
    });
    expect(result.decision).toBe("NO_ELIGIBLE_WORKER");
    expect(result.candidates[0]?.eligible).toBe(false);
    expect(result.candidates[0]?.rejections).toContain("WORKER_AT_CAPACITY");
    expect(result.candidates[0]?.notes).toContain("AT_CAPACITY");
  });

  it("distinguishes waiting for capacity from being misconfigured", () => {
    const full = assignWorker({
      node: simpleNode,
      candidates: [candidate()],
      objective: "BALANCED",
      mode: "AUTO",
      reservations: busy(DEFAULT_CAPACITY_LIMITS.perWorker),
      now: 0,
    });
    // An operator told "no eligible worker" changes a declaration. Told the
    // fleet is full, they wait or raise a limit that has a name.
    expect(full.reason).toMatch(/at capacity/i);

    const misconfigured = assignWorker({
      node: simpleNode,
      candidates: [candidate({ agent: { ...agent, available: false } })],
      objective: "BALANCED",
      mode: "AUTO",
      reservations: [],
      now: 0,
    });
    expect(misconfigured.reason).not.toMatch(/at capacity/i);
  });

  it("does not blame capacity when a candidate is also ineligible for another reason", () => {
    const result = assignWorker({
      node: simpleNode,
      candidates: [candidate({ agent: { ...agent, available: false } })],
      objective: "BALANCED",
      mode: "AUTO",
      reservations: busy(DEFAULT_CAPACITY_LIMITS.perWorker),
      now: 0,
    });
    expect(result.decision).toBe("NO_ELIGIBLE_WORKER");
    expect(result.reason).not.toMatch(/at capacity/i);
  });

  it("frees the worker again once its reservations expire", () => {
    const reservations = busy(DEFAULT_CAPACITY_LIMITS.perWorker, { expiresAt: 5_000 });
    expect(
      assignWorker({ node: simpleNode, candidates: [candidate()], objective: "BALANCED", mode: "AUTO", reservations, now: 4_999 }).decision,
    ).toBe("NO_ELIGIBLE_WORKER");
    // A lease that only released on success would strand this capacity forever.
    expect(
      assignWorker({ node: simpleNode, candidates: [candidate()], objective: "BALANCED", mode: "AUTO", reservations, now: 5_001 }).decision,
    ).toBe("ASSIGNED");
  });

  it("routes around a saturated worker to an eligible one on another provider", () => {
    const architect: AgentCapabilityProfile = {
      ...agent, agentId: "agent-backend", capabilities: ["coding", "backend", "qa"],
    };
    const result = assignWorker({
      node: simpleNode,
      candidates: [
        candidate({ agent: architect, model: cheapModel, configuredAffinity: 0.9 }),
        candidate({ agent: architect, model: strongModel, configuredAffinity: 0.1, breaker: closedBreaker("anthropic") }),
      ],
      objective: "COST",
      mode: "AUTO",
      reservations: busy(DEFAULT_CAPACITY_LIMITS.perWorker),
      now: 0,
    });
    // The cheap model is both cheaper and more preferred; capacity still wins,
    // because it gates and preference only weights.
    expect(result.decision).toBe("ASSIGNED");
    expect(result.model).toBe("claude-strong");
  });

  it("refuses an explicit override for a worker at capacity instead of exceeding the limit", () => {
    const result = assignWorker({
      node: simpleNode,
      candidates: [candidate()],
      objective: "BALANCED",
      mode: "CODEX",
      reservations: busy(DEFAULT_CAPACITY_LIMITS.perWorker),
      now: 0,
    });
    expect(result.decision).toBe("REQUESTED_WORKER_INELIGIBLE");
    expect(result.reason).toMatch(/WORKER_AT_CAPACITY/);
  });

  it("honours a caller-supplied limit over the default", () => {
    const result = assignWorker({
      node: simpleNode,
      candidates: [candidate()],
      objective: "BALANCED",
      mode: "AUTO",
      reservations: busy(1),
      capacityLimits: { ...DEFAULT_CAPACITY_LIMITS, perWorker: 1 },
      now: 0,
    });
    expect(result.candidates[0]?.rejections).toContain("WORKER_AT_CAPACITY");
  });
});
