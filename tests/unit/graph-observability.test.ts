// @vitest-environment node

import { describe, expect, it } from "vitest";

import { compileGraph, type CompiledGraph } from "@/lib/graph/compiler";
import { defineNode } from "@/lib/graph/contracts";
import {
  computeGraphMetrics,
  describeMetrics,
  weightedCriticalPath,
  type NodeObservation,
} from "@/lib/graph/observability";
import { abstentionReason, recommend } from "@/lib/graph/optimizer";
import { z } from "zod";

function graphOf(keys: readonly string[], edges: readonly [string, string][]): CompiledGraph {
  const result = compileGraph({
    goal: "test",
    nodes: keys.map((key) =>
      defineNode({
        nodeId: key,
        job: key,
        executor: "MODEL",
        capability: "review",
        inputSchema: z.unknown(),
        outputSchema: z.object({ ok: z.boolean() }),
        dependsOn: edges.filter(([, to]) => to === key).map(([from]) => from),
        reads: [],
        writes: [],
        risk: "GREEN",
      }),
    ),
    proposedEdges: edges.map(([from, to]) => ({
      from,
      to,
      reason: "DATA" as const,
      detail: `${to} consumes ${from}`,
    })),
  });

  if (!result.ok) throw new Error(result.errors.map((e) => e.detail).join("; "));
  return result.graph;
}

function obs(key: string, overrides: Partial<NodeObservation> = {}): NodeObservation {
  return {
    nodeKey: key,
    state: "COMPLETED",
    attempts: 1,
    durationMs: 100,
    verifierAccepted: null,
    missingInputs: [],
    itemsProduced: null,
    itemsRetained: null,
    ...overrides,
  };
}

describe("critical path", () => {
  it("weights the path by what each node actually took", () => {
    // a → b → d is structurally longer, but c is the slow node. The weighted
    // path is what tells you where to spend effort.
    const graph = graphOf(["a", "b", "c", "d"], [
      ["a", "b"],
      ["b", "d"],
      ["a", "c"],
      ["c", "d"],
    ]);

    const result = weightedCriticalPath(graph, [
      obs("a", { durationMs: 10 }),
      obs("b", { durationMs: 10 }),
      obs("c", { durationMs: 500 }),
      obs("d", { durationMs: 10 }),
    ]);

    expect(result.path).toEqual(["a", "c", "d"]);
    expect(result.durationMs).toBe(520);
  });

  it("reports no duration when nothing has run", () => {
    const graph = graphOf(["a", "b"], [["a", "b"]]);
    const result = weightedCriticalPath(graph, [
      obs("a", { durationMs: null, state: "PENDING" }),
      obs("b", { durationMs: null, state: "PENDING" }),
    ]);

    // Zero would read as "instant", which is the opposite of "never ran".
    expect(result.durationMs).toBeNull();
  });
});

describe("efficiency metrics", () => {
  it("measures achieved parallelism against the planned width", () => {
    const graph = graphOf(["a", "b", "c", "reduce"], [
      ["a", "reduce"],
      ["b", "reduce"],
      ["c", "reduce"],
    ]);

    const metrics = computeGraphMetrics({
      graph,
      nodes: [obs("a"), obs("b"), obs("c"), obs("reduce")],
      totalDurationMs: 200,
    });

    // 400ms of node time in 200ms of wall time is 2× overlap.
    expect(metrics.achievedParallelism).toBe(2);
    expect(metrics.plannedParallelism).toBe(3);
  });

  it("counts retries as extra attempts rather than as nodes", () => {
    const graph = graphOf(["a", "b"], [["a", "b"]]);
    const metrics = computeGraphMetrics({
      graph,
      nodes: [obs("a", { attempts: 3 }), obs("b")],
      totalDurationMs: 200,
    });

    expect(metrics.retryCount).toBe(2);
    expect(metrics.retryRate).toBe(0.5);
  });

  it("returns null rather than zero for a rate with no observations", () => {
    const graph = graphOf(["a"], []);
    const metrics = computeGraphMetrics({
      graph,
      nodes: [obs("a", { durationMs: null, state: "PENDING" })],
      totalDurationMs: 0,
    });

    // "Nothing was rejected" and "nothing was checked" must not look the same.
    expect(metrics.verifierRejectionRate).toBeNull();
    expect(metrics.retryRate).toBeNull();
    expect(metrics.achievedParallelism).toBeNull();
    expect(metrics.reductionRatio).toBeNull();
  });
});

describe("trust metrics", () => {
  it("separates a node that failed from one that never reported", () => {
    const graph = graphOf(["a", "b", "c"], []);
    const metrics = computeGraphMetrics({
      graph,
      nodes: [
        obs("a"),
        obs("b", { state: "FAILED" }),
        obs("c", { state: "RUNNING", durationMs: null }),
      ],
      totalDurationMs: 100,
    });

    expect(metrics.failedCount).toBe(1);
    expect(metrics.neverReportedCount).toBe(1);
    expect(metrics.completedCount).toBe(1);
    // Conflating these is how a graph convinces itself it is finished.
    expect(metrics.wholeResult).toBe(false);
  });

  it("refuses to call a run whole when a node ran without its declared input", () => {
    const graph = graphOf(["a", "b"], [["a", "b"]]);
    const metrics = computeGraphMetrics({
      graph,
      nodes: [obs("a"), obs("b", { missingInputs: ["a"] })],
      totalDurationMs: 200,
    });

    expect(metrics.completionRate).toBe(1);
    // Every node completed, and the answer is still not whole.
    expect(metrics.wholeResult).toBe(false);
    expect(metrics.nodesWithMissingInputs).toEqual(["b"]);
  });

  it("computes a verifier rejection rate only over verified nodes", () => {
    const graph = graphOf(["a", "b", "c"], []);
    const metrics = computeGraphMetrics({
      graph,
      nodes: [
        obs("a", { verifierAccepted: true }),
        obs("b", { verifierAccepted: false }),
        obs("c"),
      ],
      totalDurationMs: 100,
    });

    expect(metrics.verifiedNodeCount).toBe(2);
    expect(metrics.verifierRejectionRate).toBe(0.5);
  });

  it("leads its description with what is wrong rather than with the latency", () => {
    const graph = graphOf(["a", "b"], []);
    const lines = describeMetrics(
      computeGraphMetrics({
        graph,
        nodes: [obs("a"), obs("b", { state: "FAILED" })],
        totalDurationMs: 100,
      }),
    );

    expect(lines[0]).toContain("not whole");
    expect(lines[0]).toContain("must not be presented as a complete answer");
  });

  it("says plainly when nothing was verified", () => {
    const graph = graphOf(["a"], []);
    const lines = describeMetrics(
      computeGraphMetrics({ graph, nodes: [obs("a")], totalDurationMs: 50 }),
    );

    expect(lines.some((line) => line.includes("nothing here is confirmed"))).toBe(true);
  });
});

describe("the optimizer", () => {
  const wide = () =>
    graphOf(["a", "b", "c", "reduce"], [
      ["a", "reduce"],
      ["b", "reduce"],
      ["c", "reduce"],
    ]);

  it("abstains entirely before it has seen enough runs", () => {
    const graph = wide();
    const metrics = computeGraphMetrics({
      graph,
      nodes: [obs("a"), obs("b"), obs("c"), obs("reduce")],
      totalDurationMs: 400,
    });

    expect(abstentionReason({ graph, metrics, observedRuns: 0 })).toContain("never completed");
    expect(abstentionReason({ graph, metrics, observedRuns: 1 })).toContain("Only 1 run");
    expect(abstentionReason({ graph, metrics, observedRuns: 3 })).toBeNull();

    // One run is an anecdote; no structural recommendation may come from it.
    const structural = recommend({ graph, metrics, observedRuns: 1 }).filter(
      (r) => r.kind !== "ADD_VERIFICATION",
    );
    expect(structural).toEqual([]);
  });

  it("flags an unverified graph on the first run, without waiting", () => {
    const graph = wide();
    const metrics = computeGraphMetrics({
      graph,
      nodes: [obs("a"), obs("b"), obs("c"), obs("reduce")],
      totalDurationMs: 400,
    });

    const kinds = recommend({ graph, metrics, observedRuns: 1 }).map((r) => r.kind);
    // Trust is not a structural change; delaying it serves nobody.
    expect(kinds).toContain("ADD_VERIFICATION");
  });

  it("recommends collapsing a graph that ran sequentially", () => {
    const graph = wide();
    const metrics = computeGraphMetrics({
      graph,
      nodes: [obs("a"), obs("b"), obs("c"), obs("reduce")],
      totalDurationMs: 400,
    });

    const collapse = recommend({ graph, metrics, observedRuns: 5 }).find(
      (r) => r.kind === "COLLAPSE_TO_SINGLE_AGENT",
    );

    expect(collapse).toBeDefined();
    expect(collapse?.detail).toContain("essentially sequentially");
  });

  it("never recommends removing verification", () => {
    const graph = wide();
    const metrics = computeGraphMetrics({
      graph,
      nodes: [
        obs("a", { verifierAccepted: true }),
        obs("b", { verifierAccepted: true }),
        obs("c", { verifierAccepted: true }),
        obs("reduce", { verifierAccepted: true }),
      ],
      totalDurationMs: 100,
    });

    const kinds = recommend({ graph, metrics, observedRuns: 50 }).map((r) => r.kind);
    // The speedup an optimizer would most often be thanked for, and the one
    // that turns a checked result back into an assertion.
    expect(kinds).not.toContain("ADD_VERIFICATION");
    expect(kinds.some((kind) => kind.includes("REMOVE"))).toBe(false);
  });

  it("states a tradeoff and evidence on every recommendation", () => {
    const graph = wide();
    const metrics = computeGraphMetrics({
      graph,
      nodes: [obs("a"), obs("b"), obs("c"), obs("reduce", { attempts: 4 })],
      totalDurationMs: 400,
    });

    const all = recommend({ graph, metrics, observedRuns: 10 });
    expect(all.length).toBeGreaterThan(0);
    for (const recommendation of all) {
      expect(recommendation.tradeoff, recommendation.kind).not.toBe("");
      expect(recommendation.evidence.length, recommendation.kind).toBeGreaterThan(0);
    }
  });

  it("recommends raising the tier when verifiers reject often", () => {
    const graph = wide();
    const metrics = computeGraphMetrics({
      graph,
      nodes: [
        obs("a", { verifierAccepted: false }),
        obs("b", { verifierAccepted: false }),
        obs("c", { verifierAccepted: true }),
        obs("reduce", { verifierAccepted: true }),
      ],
      totalDurationMs: 400,
    });

    const kinds = recommend({ graph, metrics, observedRuns: 5 }).map((r) => r.kind);
    expect(kinds).toContain("RAISE_MODEL_TIER");
  });
});
