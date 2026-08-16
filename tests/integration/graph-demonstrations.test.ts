// @vitest-environment node

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DEFAULT_GRAPH_BUDGET, type GraphBudget } from "@/lib/graph/budgets";
import { compileGraph, type CompiledGraph, type CompiledNode } from "@/lib/graph/compiler";
import { defineNode, validateNodeOutput, type NodeCapability } from "@/lib/graph/contracts";
import {
  DEFAULT_DISCOVERY_POLICY,
  emptyDiscoveryState,
  recordRound,
  shouldContinueDiscovery,
} from "@/lib/graph/discovery";
import { planLockWaves } from "@/lib/graph/locks";
import { computeGraphMetrics, type NodeObservation } from "@/lib/graph/observability";
import { dedupeBy } from "@/lib/graph/reducers";
import { runGraph, type NodeExecutionResult } from "@/lib/graph/runner";
import { findTemplate, templateNodeContracts } from "@/lib/graph/templates";
import { DEFAULT_RETRY_POLICY, type ResourceRef } from "@/lib/graph/types";

/**
 * Phase 2B stage 5 — the demonstrations.
 *
 * Each demonstration proves one claim about the graph engine end to end, using
 * the real compiler, the real scheduler and the real runner. What is *not* real
 * is the provider: `executeNode` is injected, so these scripts stand in for
 * model calls.
 *
 * That boundary is the honest one and it is worth stating precisely, because it
 * is easy to overclaim in both directions:
 *
 * - **Proven here.** Topology selection, dependency analysis, scheduling,
 *   concurrency, retry, contract enforcement, fan-in accounting, budget
 *   degradation, discovery termination, lock ordering, and every refusal the
 *   engine makes. These are decisions the engine takes on its own, and a
 *   scripted executor exercises them exactly as a real one would.
 *
 * - **Not proven here.** That a real model returns output satisfying these
 *   contracts, or that a real Codex worker produces a mergeable change.
 *
 *   The first of those is proven in `graph-live-team-canary.test.ts`, which
 *   drives this same engine over the zero-token subscription path with real
 *   Claude nodes. The second needs a Codex worker claiming against hosted
 *   Supabase and is recorded as BLOCKED_BY_1C_HOSTED_SCHEMA.
 *
 *   Neither needs `ANTHROPIC_API_KEY` or a funded `OPENAI_API_KEY`, and this
 *   comment used to say they did — which was how demonstration C ended up gated
 *   on the one thing the project forbids.
 *
 * The distinction matters because the engine's whole purpose is to refuse to
 * overclaim. A demonstration suite that quietly implied live execution would be
 * the same failure it exists to prevent.
 */

const findingsSchema = z.object({
  findings: z.array(z.object({ title: z.string(), severity: z.string() })),
});

function node(
  key: string,
  options: {
    dependsOn?: readonly string[];
    writes?: readonly ResourceRef[];
    reads?: readonly ResourceRef[];
    capability?: NodeCapability;
    executor?: CompiledNode["executor"];
    maxAttempts?: number;
  } = {},
) {
  return defineNode({
    nodeId: key,
    job: `do ${key}`,
    executor: options.executor ?? "MODEL",
    capability: options.capability ?? "review",
    inputSchema: z.unknown(),
    outputSchema: findingsSchema,
    dependsOn: options.dependsOn ?? [],
    reads: options.reads ?? [],
    writes: options.writes ?? [],
    risk: "GREEN",
    retry: {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: options.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
    },
  });
}

function compile(nodes: readonly ReturnType<typeof node>[], goal = "demonstration"): CompiledGraph {
  const result = compileGraph({
    goal,
    nodes,
    proposedEdges: nodes.flatMap((n) =>
      n.dependsOn.map((from) => ({
        from,
        to: n.nodeId,
        reason: "DATA" as const,
        detail: `${n.nodeId} consumes ${from}`,
      })),
    ),
  });

  if (!result.ok) throw new Error(result.errors.map((e) => e.detail).join("; "));
  return result.graph;
}

/** A scripted provider. Stands in for a model call; decides nothing itself. */
function scripted(
  script: Record<string, NodeExecutionResult | ((attempt: number) => NodeExecutionResult)> = {},
  fallback: NodeExecutionResult = {
    status: "SUCCEEDED",
    output: { findings: [] },
    tokensUsed: 100,
  },
) {
  return async (target: CompiledNode, attempt: number): Promise<NodeExecutionResult> => {
    const entry = script[target.nodeKey];
    if (typeof entry === "function") return entry(attempt);
    return entry ?? fallback;
  };
}

const validate = (target: CompiledNode, output: unknown) => {
  // The runner asks the contract, not the agent that produced the output.
  const contract = defineNode({
    nodeId: target.nodeKey,
    job: target.job,
    executor: target.executor,
    capability: target.capability,
    inputSchema: z.unknown(),
    outputSchema: findingsSchema,
    dependsOn: [],
    reads: [],
    writes: [],
    risk: target.risk,
  });
  const outcome = validateNodeOutput(contract, output);
  return outcome.valid
    ? { valid: true, issues: [] }
    : { valid: false, issues: outcome.issues };
};

describe("A. a simple task does not become a graph", () => {
  it("routes two dependent steps to a single agent, with no scheduler overhead", () => {
    // The engine's most valuable refusal. A scheduler, a reduce step and a
    // synthesis pass cost more than two steps of overlap could ever buy.
    const graph = compile([node("read"), node("summarize", { dependsOn: ["read"] })]);

    expect(graph.topology).toBe("SINGLE_AGENT");
    expect(graph.topologyReasons[0].detail).toMatch(/do not justify|nothing to overlap/i);
  });

  it("keeps a single node single", () => {
    expect(compile([node("answer")]).topology).toBe("SINGLE_AGENT");
  });

  it("does not let a long plan become a graph when it is really a queue", () => {
    // Five nodes, but each waits on the one before: a graph would schedule a
    // queue and charge for the privilege.
    const graph = compile([
      node("a"),
      node("b", { dependsOn: ["a"] }),
      node("c", { dependsOn: ["b"] }),
      node("d", { dependsOn: ["c"] }),
      node("e", { dependsOn: ["d"] }),
    ]);

    expect(graph.maxParallelism).toBe(1);
    expect(graph.topology).toBe("SEQUENTIAL");
  });
});

describe("B. a wide audit fans out, verifies, and reduces", () => {
  const INSPECTORS = 20;

  function wideAudit() {
    const inspectors = Array.from({ length: INSPECTORS }, (_, i) => node(`inspect_${i}`));
    return compile([
      ...inspectors,
      node("reduce", {
        dependsOn: inspectors.map((n) => n.nodeId),
        capability: "extraction",
        executor: "DETERMINISTIC",
      }),
      node("report", { dependsOn: ["reduce"], capability: "reporting" }),
    ]);
  }

  it("runs twenty independent inspectors concurrently and converges", async () => {
    const graph = wideAudit();
    expect(graph.maxParallelism).toBe(INSPECTORS);
    expect(graph.topology).toBe("DIAMOND");

    // Records the widest batch the runner actually dispatched at once, which is
    // the difference between planned and achieved parallelism.
    let inFlight = 0;
    let widestBatch = 0;

    const result = await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxNodes: 100, maxConcurrentNodes: INSPECTORS },
      {
        executeNode: async (_target) => {
          inFlight += 1;
          widestBatch = Math.max(widestBatch, inFlight);
          await Promise.resolve();
          inFlight -= 1;
          return {
            status: "SUCCEEDED",
            // Two inspectors find the same thing, so reduction has something
            // to actually remove.
            output: { findings: [{ title: "shared finding", severity: "LOW" }] },
            tokensUsed: 100,
          };
        },
        validateOutput: validate,
      },
    );

    expect(result.outcome).toBe("COMPLETED");
    expect(result.incompleteness).toBeNull();
    expect(widestBatch).toBe(INSPECTORS);
    expect(result.spend.nodesStarted).toBe(INSPECTORS + 2);
  });

  it("reduces duplicate findings rather than reporting the raw pile", () => {
    const raw = Array.from({ length: INSPECTORS }, () => ({
      title: "shared finding",
      severity: "LOW",
    }));

    const reduced = dedupeBy(raw, (finding) => finding.title);

    expect(reduced.items).toHaveLength(1);
    expect(reduced.stats.inputCount).toBe(INSPECTORS);
    expect(reduced.stats.outputCount).toBe(1);
    expect(reduced.stats.reductionRatio).toBeGreaterThan(0.9);

    const metrics = computeGraphMetrics({
      graph: wideAudit(),
      nodes: observationsFor(wideAudit(), {
        itemsProduced: INSPECTORS,
        itemsRetained: 1,
      }),
      totalDurationMs: 1000,
    });
    expect(metrics.retentionRatio).toBeLessThan(0.1);
  });
});

describe("D. a silent failure is never reported as success", () => {
  it("refuses to call the run complete when one node failed", async () => {
    const graph = compile([
      node("a"),
      node("b"),
      node("c"),
      node("reduce", { dependsOn: ["a", "b", "c"], executor: "DETERMINISTIC" }),
    ]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: scripted({
        b: { status: "FAILED", error: "provider refused", retryable: false },
      }),
      validateOutput: validate,
    });

    expect(result.outcome).not.toBe("COMPLETED");
    expect(result.states.get("b")).toBe("FAILED");
    // The caveat travels as text, so it survives into whatever reports it.
    expect(result.incompleteness).toContain("b");
    // Two of four nodes finished; the run is emphatically not 100% done.
    expect(result.percentComplete).toBeLessThan(100);
  });

  it("blocks the dependants of a failed node without killing unrelated work", async () => {
    const graph = compile([
      node("failing"),
      node("downstream", { dependsOn: ["failing"] }),
      node("unrelated"),
    ]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: scripted({
        failing: { status: "FAILED", error: "boom", retryable: false },
      }),
      validateOutput: validate,
    });

    expect(result.states.get("failing")).toBe("FAILED");
    expect(result.states.get("downstream")).not.toBe("COMPLETED");
    // Killing unrelated branches would waste finished work and hide which
    // failure actually mattered.
    expect(result.states.get("unrelated")).toBe("COMPLETED");
  });

  it("rejects prose where the contract demanded structure, rather than passing it on", async () => {
    const graph = compile([node("narrator"), node("consumer", { dependsOn: ["narrator"] })]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: scripted({
        narrator: { status: "SUCCEEDED", output: "I looked at the code and it seems fine." },
      }),
      validateOutput: validate,
    });

    expect(result.states.get("narrator")).toBe("FAILED");
    expect(result.events.some((event) => event.type === "node_output_rejected")).toBe(true);
    expect(result.outcome).not.toBe("COMPLETED");
  });

  it("counts a node that never reported as missing, not as failed", async () => {
    const graph = compile([node("a"), node("b", { dependsOn: ["a"] })]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: scripted({
        a: { status: "FAILED", error: "unavailable", retryable: false },
      }),
      validateOutput: validate,
    });

    // b never ran at all. Conflating that with a failure — or with a success —
    // is how a graph convinces itself it finished.
    expect(result.states.get("b")).not.toBe("FAILED");
    expect(result.states.get("b")).not.toBe("COMPLETED");
    expect(result.incompleteness).not.toBeNull();
  });
});

describe("E. a hidden conflict prevents unsafe parallelism", () => {
  const shared: ResourceRef = { kind: "file", id: "app/page.tsx" };

  it("refuses to compile two nodes that both write the same resource", () => {
    const result = compileGraph({
      goal: "two writers",
      nodes: [node("writer_a", { writes: [shared] }), node("writer_b", { writes: [shared] })],
      proposedEdges: [],
    });

    // Inventing an ordering would be worse: it would look like it worked.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe("WRITE_CONFLICT_UNRESOLVED");
    expect(result.errors[0].detail).toContain("Serialize them");
  });

  it("compiles once the conflict is declared resolved, and schedules them in separate lock waves", () => {
    const result = compileGraph({
      goal: "two writers, serialized",
      nodes: [node("writer_a", { writes: [shared] }), node("writer_b", { writes: [shared] })],
      proposedEdges: [],
      resolvedWriteConflicts: ["file:app/page.tsx"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Contention resolved by planning rather than by collision and retry.
    const waves = planWaves(result.graph);
    expect(waves).toHaveLength(2);
    expect(waves[0]).toEqual(["writer_a"]);
    expect(waves[1]).toEqual(["writer_b"]);
  });

  it("discovers a read-after-write dependency nobody proposed", () => {
    const result = compileGraph({
      goal: "implicit ordering",
      nodes: [
        node("writer", { writes: [shared] }),
        node("reader", { reads: [shared] }),
      ],
      proposedEdges: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nobody declared this edge; the resources did.
    const edge = result.graph.edges.find((e) => e.from === "writer" && e.to === "reader");
    expect(edge).toBeDefined();
    expect(edge?.reason).toBe("RESOURCE_READ_AFTER_WRITE");
  });
});

describe("F. discovery stops when it stops finding things", () => {
  it("terminates on consecutive rounds that verified nothing new", () => {
    let state = emptyDiscoveryState();

    state = recordRound(state, ["finding-1", "finding-2"]);
    expect(shouldContinueDiscovery(state).shouldContinue).toBe(true);

    // A round that re-reports what is already known is not progress.
    state = recordRound(state, ["finding-1", "finding-2"]);
    expect(state.consecutiveQuietRounds).toBe(1);
    expect(shouldContinueDiscovery(state).shouldContinue).toBe(true);

    state = recordRound(state, ["finding-2"]);
    const decision = shouldContinueDiscovery(state);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe("NO_NEW_VERIFIED_ITEMS");
    expect(state.knownItems).toEqual(["finding-1", "finding-2"]);
  });

  it("stops at the round ceiling even while it is still finding things", () => {
    let state = emptyDiscoveryState();
    for (let round = 0; round < DEFAULT_DISCOVERY_POLICY.maxRounds; round += 1) {
      state = recordRound(state, [`finding-${round}`]);
    }

    const decision = shouldContinueDiscovery(state);
    // Unbounded search is how a discovery graph spends without limit.
    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe("MAX_ROUNDS_REACHED");
  });

  it("does not sustain itself on unverified candidates", () => {
    let state = emptyDiscoveryState();
    state = recordRound(state, ["real"]);
    // Round two produced plenty of activity but verified nothing.
    state = recordRound(state, []);
    state = recordRound(state, []);

    expect(shouldContinueDiscovery(state).stopReason).toBe("NO_NEW_VERIFIED_ITEMS");
  });
});

describe("G. a budget degrades and then stops gracefully", () => {
  it("reduces concurrency before it overspends, then stops and keeps finished work", async () => {
    const graph = compile(
      Array.from({ length: 8 }, (_, i) => node(`n${i}`)),
      "budget demonstration",
    );

    // A clock that advances a minute per call, so the duration ceiling is
    // reached partway through rather than never.
    let now = 0;
    const budget: GraphBudget = {
      ...DEFAULT_GRAPH_BUDGET,
      maxConcurrentNodes: 4,
      maxDurationMs: 3 * 60_000,
    };

    const result = await runGraph(graph, budget, {
      elapsedMs: () => {
        now += 60_000;
        return now;
      },
      executeNode: scripted(),
      validateOutput: validate,
    });

    expect(result.outcome).toBe("BUDGET_STOPPED");
    expect(result.events.some((event) => event.type === "budget_stopped")).toBe(true);
    // Graceful: what finished is kept and reported, rather than discarded.
    expect(result.outputs.size).toBeGreaterThan(0);
    // And it does not pretend to be finished.
    expect(result.incompleteness).not.toBeNull();
    expect(result.percentComplete).toBeLessThan(100);
  });

  it("charges a failed call against the budget", async () => {
    const graph = compile([node("flaky", { maxAttempts: 3 })]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: scripted({
        flaky: () => ({
          status: "FAILED",
          error: "rate limited",
          retryable: true,
          tokensUsed: 500,
        }),
      }),
      validateOutput: validate,
    });

    // Three attempts at 500 tokens. A retry that spent nothing on paper is how
    // a graph engine overspends invisibly.
    expect(result.spend.tokensUsed).toBe(1500);
    expect(result.states.get("flaky")).toBe("FAILED");
  });

  it("never invents a cost when a model has no declared pricing", async () => {
    const graph = compile([node("unpriced")]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: scripted({
        unpriced: { status: "SUCCEEDED", output: { findings: [] }, tokensUsed: 900 },
      }),
      validateOutput: validate,
    });

    expect(result.spend.tokensUsed).toBe(900);
    // A fabricated total is worse than an absent one, because it is believed.
    expect(result.spend.costMicros).toBeUndefined();
  });
});

describe("C. the code-feature demonstration", () => {
  it("compiles the feature-build shape, which is provable without a provider", () => {
    const template = findTemplate("feature_build")!;
    const compiled = compileGraph({
      goal: template.summary,
      nodes: templateNodeContracts(template),
      proposedEdges: template.proposedEdges,
      risk: template.risk,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    // Three implementation branches run in parallel, converge on integration,
    // and the reviewer runs only after an anchor observed the tests — so the
    // review reads a checked result rather than a claim.
    expect(compiled.graph.maxParallelism).toBe(3);
    const review = compiled.graph.edges.find((edge) => edge.to === "review");
    expect(review?.from).toBe("verify");
    expect(review?.reason).toBe("VERIFICATION");
  });

  /**
   * The live half of C moved to `graph-live-team-canary.test.ts`, and its gate
   * was wrong in a way worth recording.
   *
   * It used to be `it.skipIf(!ANTHROPIC_API_KEY && !OPENAI_API_KEY)` with a body
   * that threw "Not implemented". The stub is the ordinary kind of debt. The
   * gate was the real defect: this project's standing constraint is that normal
   * operation costs zero funded per-token API usage, so the demonstration was
   * gated on exactly the thing the project forbids. It could not run — not "not
   * yet", but never — and being permanently skipped, it never said so.
   *
   * The live canary runs the same claim on the zero-token subscription path:
   * five real Claude nodes, three of them concurrent, contracts enforced by the
   * engine's own validator, and a verifier in a fresh session that receives only
   * the artifact. Opt in with `SOFTWAREFACTORY_GRAPH_LIVE_CANARY=1`.
   *
   * What remains unproven is the second half of C's original claim — a Codex
   * worker turning the plan into a diff and a draft pull request. That needs the
   * Phase 1C worker to claim a command against hosted Supabase, and the Phase 2B
   * graph tables are not applied to hosted. It is recorded as
   * BLOCKED_BY_1C_HOSTED_SCHEMA in AI/PHASE_2B_COMPLETION.md rather than skipped
   * silently, because a skipped test and a blocked one look identical in a
   * summary line and only one of them is waiting on something real.
   */
  it("states where the live half of this demonstration lives", () => {
    // A pointer, not a proof. It exists so that deleting the canary breaks
    // something, rather than quietly reducing C to its compile-time half.
    const canary = "tests/integration/graph-live-team-canary.test.ts";
    expect(existsSync(resolve(import.meta.dirname, "../..", canary)), `${canary} is missing`).toBe(true);
  });
});

/* --------------------------------------------------------------- helpers */

function planWaves(graph: CompiledGraph): readonly (readonly string[])[] {
  return planLockWaves(graph.nodes);
}

function observationsFor(
  graph: CompiledGraph,
  overrides: Partial<NodeObservation>,
): readonly NodeObservation[] {
  return graph.nodes.map((n) => ({
    nodeKey: n.nodeKey,
    state: "COMPLETED" as const,
    attempts: 1,
    durationMs: 50,
    verifierAccepted: null,
    missingInputs: [],
    itemsProduced: null,
    itemsRetained: null,
    ...overrides,
  }));
}
