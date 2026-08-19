// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assessBudget, computeCostMicros, DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { defineNode } from "@/lib/graph/contracts";
import { analyzeDependencies } from "@/lib/graph/dependencies";
import {
  DEFAULT_DISCOVERY_POLICY,
  emptyDiscoveryState,
  recordRound,
  shouldContinueDiscovery,
} from "@/lib/graph/discovery";
import { collectFanIn, incompletenessNotice, planLayeredFanIn } from "@/lib/graph/fan-in";
import { assertPlanRespectsFrozenPolicies, type PlanIntent } from "@/lib/graph/frozen";
import { dedupeBy, sortByRank } from "@/lib/graph/reducers";
import { applyDecision, initialState, progress, tick, transition } from "@/lib/graph/scheduler";
import { checkIndependence, resolveQuorum, type Verification } from "@/lib/graph/verification";

function node(id: string, overrides: Partial<Parameters<typeof defineNode>[0]> = {}) {
  return defineNode({
    nodeId: id,
    job: id,
    executor: "MODEL",
    capability: "extraction",
    inputSchema: z.unknown(),
    outputSchema: z.array(z.string()),
    dependsOn: [],
    reads: [],
    writes: [],
    risk: "GREEN",
    ...overrides,
  });
}

describe("DAG scheduler", () => {
  it("starts only nodes whose real dependencies are satisfied", () => {
    const a = node("a");
    const b = node("b", { dependsOn: ["a"] });
    const { edges } = analyzeDependencies([a, b], [{ from: "a", to: "b" }]);

    const first = tick([a, b], edges, initialState([a, b]), { maxConcurrent: 4 });
    expect(first.start).toEqual(["a"]);

    let state = applyDecision(initialState([a, b]), first);
    state = transition(state, "a", "COMPLETED");

    expect(tick([a, b], edges, state, { maxConcurrent: 4 }).start).toEqual(["b"]);
  });

  it("runs independent nodes concurrently", () => {
    const nodes = ["a", "b", "c"].map((id) => node(id));
    const decision = tick(nodes, [], initialState(nodes), { maxConcurrent: 4 });

    expect(decision.start).toEqual(["a", "b", "c"]);
  });

  it("honours the concurrency limit and says why a node was held", () => {
    const nodes = ["a", "b", "c"].map((id) => node(id));
    const decision = tick(nodes, [], initialState(nodes), { maxConcurrent: 2 });

    expect(decision.start).toHaveLength(2);
    expect(decision.deferred).toHaveLength(1);
    expect(decision.deferred[0].reason).toBe("CONCURRENCY_LIMIT");
  });

  it("does not start two nodes writing the same resource in one tick", () => {
    // Without claiming writes during the tick, both would start together on the
    // very first pass and race.
    const write = [{ kind: "file" as const, id: "shared.ts" }];
    const nodes = [node("a", { writes: write }), node("b", { writes: write })];

    const decision = tick(nodes, [], initialState(nodes), { maxConcurrent: 4 });

    expect(decision.start).toEqual(["a"]);
    expect(decision.deferred[0]).toMatchObject({ nodeId: "b", reason: "RESOURCE_LOCKED" });
  });

  it("respects a lock held outside the graph", () => {
    const nodes = [node("a", { writes: [{ kind: "file", id: "locked.ts" }] })];
    const decision = tick(nodes, [], initialState(nodes), {
      maxConcurrent: 4,
      heldLocks: new Set(["file:locked.ts"]),
    });

    expect(decision.start).toHaveLength(0);
    expect(decision.deferred[0].reason).toBe("RESOURCE_LOCKED");
  });

  it("blocks dependents of a failed node but lets unrelated branches run", () => {
    const a = node("a");
    const b = node("b", { dependsOn: ["a"] });
    const unrelated = node("u");
    const { edges } = analyzeDependencies([a, b, unrelated], [{ from: "a", to: "b" }]);

    let state = initialState([a, b, unrelated]);
    state = transition(state, "a", "FAILED");

    const decision = tick([a, b, unrelated], edges, state, { maxConcurrent: 4 });

    expect(decision.blocked).toEqual([
      { nodeId: "b", because: "Dependency a is FAILED." },
    ]);
    // The whole point: an unrelated branch is not punished for a's failure.
    expect(decision.start).toEqual(["u"]);
  });

  it("lets a tolerant fan-in run once every input settles, with what completed", () => {
    const a = node("a");
    const b = node("b");
    const s = node("s", {
      dependsOn: ["a", "b"],
      capability: "synthesis",
      toleratesPartialInputs: true,
    });
    const { edges } = analyzeDependencies(
      [a, b, s],
      [{ from: "a", to: "s" }, { from: "b", to: "s" }],
    );

    let state = initialState([a, b, s]);
    state = transition(state, "a", "COMPLETED");
    state = transition(state, "b", "FAILED");

    const decision = tick([a, b, s], edges, state, { maxConcurrent: 4 });
    // The failed input does not cost the synthesis of the surviving one.
    expect(decision.start).toEqual(["s"]);
    expect(decision.blocked).toEqual([]);
  });

  it("holds a tolerant fan-in while any input is still in flight", () => {
    const a = node("a");
    const b = node("b");
    const s = node("s", { dependsOn: ["a", "b"], toleratesPartialInputs: true });
    const { edges } = analyzeDependencies(
      [a, b, s],
      [{ from: "a", to: "s" }, { from: "b", to: "s" }],
    );

    let state = initialState([a, b, s]);
    state = transition(state, "a", "COMPLETED");
    state = transition(state, "b", "RUNNING");

    const decision = tick([a, b, s], edges, state, { maxConcurrent: 4 });
    // Tolerance is for settled absence, not impatience: b may still answer.
    expect(decision.start).toEqual([]);
    expect(decision.blocked).toEqual([]);
  });

  it("still blocks a tolerant fan-in when nothing completed at all", () => {
    const a = node("a");
    const b = node("b");
    const s = node("s", { dependsOn: ["a", "b"], toleratesPartialInputs: true });
    const { edges } = analyzeDependencies(
      [a, b, s],
      [{ from: "a", to: "s" }, { from: "b", to: "s" }],
    );

    let state = initialState([a, b, s]);
    state = transition(state, "a", "FAILED");
    state = transition(state, "b", "FAILED");

    const decision = tick([a, b, s], edges, state, { maxConcurrent: 4 });
    // A synthesis with zero inputs would be invented, not synthesised.
    expect(decision.start).toEqual([]);
    expect(decision.blocked).toEqual([
      {
        nodeId: "s",
        because: "Every dependency failed or was cancelled; a tolerant fan-in still needs at least one completed input.",
      },
    ]);
  });

  it("reports completion only when every node reached a terminal or blocked state", () => {
    const nodes = [node("a"), node("b")];
    let state = initialState(nodes);
    state = transition(state, "a", "COMPLETED");

    expect(tick(nodes, [], state, { maxConcurrent: 4 }).complete).toBe(false);

    state = transition(state, "b", "COMPLETED");
    expect(tick(nodes, [], state, { maxConcurrent: 4 }).complete).toBe(true);
  });

  it("does not count failures toward percent complete", () => {
    const nodes = [node("a"), node("b")];
    let state = initialState(nodes);
    state = transition(state, "a", "COMPLETED");
    state = transition(state, "b", "FAILED");

    // A graph that failed half its work is not 100% done.
    expect(progress(nodes, state).percentComplete).toBe(50);
  });

  it("is a pure function of state, so a restart replays to the same decision", () => {
    const a = node("a");
    const b = node("b", { dependsOn: ["a"] });
    const { edges } = analyzeDependencies([a, b], [{ from: "a", to: "b" }]);

    let persisted = initialState([a, b]);
    persisted = transition(persisted, "a", "COMPLETED");

    const first = tick([a, b], edges, persisted, { maxConcurrent: 4 });
    const replayed = tick([a, b], edges, persisted, { maxConcurrent: 4 });

    expect(replayed).toEqual(first);
  });
});

describe("fan-in completeness", () => {
  it("refuses to call a fan-in complete when a node never reported", () => {
    // 20 dispatched, 19 returned: the failure this guard exists for.
    const expected = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const outcomes = expected.slice(0, 19).map((nodeId) => ({
      nodeId,
      status: "COMPLETED" as const,
      items: [`finding-${nodeId}`],
    }));

    const result = collectFanIn(expected, outcomes);

    expect(result.status).toBe("PARTIAL_INPUT");
    expect(result.isWhole).toBe(false);
    expect(result.missingNodes).toEqual(["n19"]);
    expect(incompletenessNotice(result)).toContain("must not be presented as a complete answer");
  });

  it("separates a node that returned nothing from a node that never returned", () => {
    const result = collectFanIn(
      ["a", "b"],
      [
        { nodeId: "a", status: "COMPLETED", items: [] },
        { nodeId: "b", status: "COMPLETED", items: [] },
      ],
    );

    // Both ran and found nothing. That is a real, whole answer.
    expect(result.status).toBe("EMPTY");
    expect(result.isWhole).toBe(true);
    expect(incompletenessNotice(result)).toBeNull();
  });

  it("counts a failed node as incomplete input", () => {
    const result = collectFanIn(
      ["a", "b"],
      [
        { nodeId: "a", status: "COMPLETED", items: ["x"] },
        { nodeId: "b", status: "FAILED" },
      ],
    );

    expect(result.status).toBe("PARTIAL_INPUT");
    expect(result.failedNodes).toEqual(["b"]);
  });

  it("layers a large result set instead of truncating it", () => {
    const items = Array.from({ length: 120 }, (_, i) => `item-${i}`);
    const plan = planLayeredFanIn(items);

    expect(plan.direct).toBe(false);
    expect(plan.batches.flat()).toHaveLength(120);
    expect(plan.detail).toContain("Nothing is discarded");
  });

  it("synthesises directly when the set is small enough", () => {
    const plan = planLayeredFanIn(["a", "b", "c"]);
    expect(plan.direct).toBe(true);
    expect(plan.layers).toBe(1);
  });
});

describe("deterministic reducers", () => {
  it("dedupes keeping the first occurrence", () => {
    const reduction = dedupeBy(
      [
        { id: "a", note: "first" },
        { id: "a", note: "second" },
        { id: "b", note: "only" },
      ],
      (item) => item.id,
    );

    expect(reduction.items.map((i) => i.note)).toEqual(["first", "only"]);
    expect(reduction.stats.reductionRatio).toBeCloseTo(1 / 3);
  });

  it("sorts by rank stably", () => {
    const sorted = sortByRank(
      [
        { id: "a", rank: 1 },
        { id: "b", rank: 2 },
        { id: "c", rank: 2 },
      ],
      (item) => item.rank,
    );

    expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
});

describe("verification", () => {
  const implementer = { agentId: "impl", provider: "anthropic" };

  it("refuses a verifier that is the implementer", () => {
    const check = checkIndependence(implementer, {
      verifier: implementer,
      sharedWorkerContext: false,
    });

    expect(check.independent).toBe(false);
    expect(check.violation).toBe("VERIFIER_IS_IMPLEMENTER");
  });

  it("refuses a verifier that was handed the worker's context", () => {
    const check = checkIndependence(implementer, {
      verifier: { agentId: "reviewer", provider: "openai" },
      sharedWorkerContext: true,
    });

    expect(check.independent).toBe(false);
    expect(check.violation).toBe("VERIFIER_SHARED_CONTEXT");
  });

  it("enforces a distinct provider only where the step requires it", () => {
    const sameProvider = { verifier: { agentId: "reviewer", provider: "anthropic" }, sharedWorkerContext: false };

    expect(checkIndependence(implementer, sameProvider).independent).toBe(true);
    expect(
      checkIndependence(implementer, sameProvider, { requireDistinctProvider: true }).independent,
    ).toBe(false);
  });

  it("lets a security BLOCK override any quorum", () => {
    const verifications: Verification[] = [
      { verifier: { agentId: "v1", provider: "a" }, lens: "correctness", verdict: "PASS", evidence: [] },
      { verifier: { agentId: "v2", provider: "b" }, lens: "correctness", verdict: "PASS", evidence: [] },
      { verifier: { agentId: "v3", provider: "c" }, lens: "security", verdict: "BLOCK", evidence: ["secret in diff"] },
    ];

    const outcome = resolveQuorum(verifications, { strategy: "MAJORITY" });

    expect(outcome.verdict).toBe("BLOCK");
    expect(outcome.satisfied).toBe(false);
    expect(outcome.reasons[0]).toContain("no quorum overrides it");
  });

  it("passes an ordinary finding on a 2-of-3 majority", () => {
    const verifications: Verification[] = [
      { verifier: { agentId: "v1", provider: "a" }, lens: "correctness", verdict: "PASS", evidence: [] },
      { verifier: { agentId: "v2", provider: "b" }, lens: "evidence", verdict: "PASS", evidence: [] },
      { verifier: { agentId: "v3", provider: "c" }, lens: "freshness", verdict: "REJECT", evidence: [] },
    ];

    expect(resolveQuorum(verifications, { strategy: "MAJORITY" }).satisfied).toBe(true);
  });

  it("treats no verification as a rejection rather than a pass", () => {
    const outcome = resolveQuorum([], { strategy: "SINGLE" });

    expect(outcome.satisfied).toBe(false);
    expect(outcome.reasons[0]).toContain("not the same as passing");
  });

  it("requires every declared lens under SPECIALIZED_LENSES", () => {
    const outcome = resolveQuorum(
      [{ verifier: { agentId: "v1", provider: "a" }, lens: "correctness", verdict: "PASS", evidence: [] }],
      { strategy: "SPECIALIZED_LENSES", requiredLenses: ["correctness", "security"] },
    );

    expect(outcome.satisfied).toBe(false);
    expect(outcome.reasons[0]).toContain("security");
  });
});

describe("budgets", () => {
  it("continues while well within limits", () => {
    const assessment = assessBudget(DEFAULT_GRAPH_BUDGET, {
      nodesStarted: 5,
      elapsedMs: 1_000,
      retriesUsed: 0,
      discoveryRounds: 0,
    });

    expect(assessment.action).toBe("CONTINUE");
  });

  it("reduces concurrency as node count approaches the ceiling", () => {
    const assessment = assessBudget(DEFAULT_GRAPH_BUDGET, {
      nodesStarted: 45,
      elapsedMs: 1_000,
      retriesUsed: 0,
      discoveryRounds: 0,
    });

    expect(assessment.action).toBe("REDUCE_CONCURRENCY");
    expect(assessment.allowedConcurrency).toBeLessThan(DEFAULT_GRAPH_BUDGET.maxConcurrentNodes);
  });

  it("prefers a cheaper model when spend rather than time is the pressure", () => {
    const assessment = assessBudget(
      { ...DEFAULT_GRAPH_BUDGET, maxTokens: 100_000 },
      { nodesStarted: 1, elapsedMs: 10, retriesUsed: 0, discoveryRounds: 0, tokensUsed: 85_000 },
    );

    expect(assessment.action).toBe("PREFER_CHEAPER_MODEL");
  });

  it("stops gracefully once a limit is exhausted", () => {
    const assessment = assessBudget(DEFAULT_GRAPH_BUDGET, {
      nodesStarted: 50,
      elapsedMs: 1_000,
      retriesUsed: 0,
      discoveryRounds: 0,
    });

    expect(assessment.action).toBe("STOP_GRACEFULLY");
    expect(assessment.allowedConcurrency).toBe(0);
    expect(assessment.reasons.join(" ")).toContain("completed work is kept");
  });

  it("returns no cost at all when any model lacks declared pricing", () => {
    const pricing = { known: { inputPerMillionMicros: 1000, outputPerMillionMicros: 2000 } };

    expect(
      computeCostMicros([{ model: "known", inputTokens: 1_000_000, outputTokens: 0 }], pricing),
    ).toBe(1000);
    // A partial total presented as a total is a fabrication.
    expect(
      computeCostMicros(
        [
          { model: "known", inputTokens: 1_000_000, outputTokens: 0 },
          { model: "unpriced", inputTokens: 1_000_000, outputTokens: 0 },
        ],
        pricing,
      ),
    ).toBeNull();
  });
});

describe("discovery graphs", () => {
  it("stops after the configured quiet rounds", () => {
    let state = emptyDiscoveryState();
    state = recordRound(state, ["a", "b"]);
    expect(shouldContinueDiscovery(state).shouldContinue).toBe(true);

    state = recordRound(state, ["a"]); // already known: quiet
    state = recordRound(state, []); // quiet again

    const decision = shouldContinueDiscovery(state);
    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe("NO_NEW_VERIFIED_ITEMS");
  });

  it("resets the quiet counter when a round finds something new", () => {
    let state = emptyDiscoveryState();
    state = recordRound(state, ["a"]);
    state = recordRound(state, []);
    state = recordRound(state, ["b"]);

    expect(state.consecutiveQuietRounds).toBe(0);
    expect(shouldContinueDiscovery(state).shouldContinue).toBe(true);
  });

  it("never exceeds the round ceiling", () => {
    let state = emptyDiscoveryState();
    for (let i = 0; i < DEFAULT_DISCOVERY_POLICY.maxRounds; i += 1) {
      state = recordRound(state, [`item-${i}`]);
    }

    const decision = shouldContinueDiscovery(state);
    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe("MAX_ROUNDS_REACHED");
  });

  it("stops on budget exhaustion before spending another round", () => {
    const decision = shouldContinueDiscovery(emptyDiscoveryState(), DEFAULT_DISCOVERY_POLICY, {
      budgetExhausted: true,
    });

    expect(decision.stopReason).toBe("BUDGET_EXHAUSTED");
  });

  it("stops when the owner cancels, ahead of every other condition", () => {
    const decision = shouldContinueDiscovery(emptyDiscoveryState(), DEFAULT_DISCOVERY_POLICY, {
      ownerCancelled: true,
      budgetExhausted: true,
    });

    expect(decision.stopReason).toBe("OWNER_CANCELLED");
  });
});

describe("frozen policies", () => {
  const compliant: PlanIntent = {
    declaredRisk: "GREEN",
    classifiedRisk: "GREEN",
    requestedBudget: { maxNodes: 10 },
    ownerBudget: { maxNodes: 50 },
    skipsOwnerApproval: true,
    writesOutsideDraftPr: false,
    disablesRls: false,
    verifierIsImplementer: false,
    emergencyStopActive: false,
  };

  it("allows an ordinary compliant plan", () => {
    expect(assertPlanRespectsFrozenPolicies(compliant).allowed).toBe(true);
  });

  it("refuses a plan that declares lower risk than the classifier found", () => {
    // The specific move that would let a plan slip past approval.
    const check = assertPlanRespectsFrozenPolicies({
      ...compliant,
      declaredRisk: "GREEN",
      classifiedRisk: "RED",
    });

    expect(check.allowed).toBe(false);
    expect(check.violations.map((v) => v.policy)).toContain("RED_REQUIRES_OWNER_APPROVAL");
  });

  it("refuses a plan that raises its own budget above the owner's", () => {
    const check = assertPlanRespectsFrozenPolicies({
      ...compliant,
      requestedBudget: { maxNodes: 500 },
    });

    expect(check.violations.map((v) => v.policy)).toContain("MAX_BUDGET");
  });

  it("refuses every plan while the emergency stop is active", () => {
    const check = assertPlanRespectsFrozenPolicies({ ...compliant, emergencyStopActive: true });

    expect(check.allowed).toBe(false);
    expect(check.violations[0].policy).toBe("EMERGENCY_STOP");
  });

  it("refuses self-approval, RLS removal, and writes outside the draft-PR path", () => {
    const check = assertPlanRespectsFrozenPolicies({
      ...compliant,
      verifierIsImplementer: true,
      disablesRls: true,
      writesOutsideDraftPr: true,
    });

    const policies = check.violations.map((v) => v.policy);
    expect(policies).toContain("NO_SELF_APPROVAL");
    expect(policies).toContain("RLS_REQUIRED");
    expect(policies).toContain("DRAFT_PR_ONLY");
  });
});
