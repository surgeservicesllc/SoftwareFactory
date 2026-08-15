// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { compileGraph } from "@/lib/graph/compiler";
import { defineNode } from "@/lib/graph/contracts";
import { layerNodes, previewGraph, previewTemplate } from "@/lib/graph/preview";
import { findTemplate, GRAPH_TEMPLATES } from "@/lib/graph/templates";

function compiled(keys: readonly string[], edges: readonly [string, string][]) {
  const result = compileGraph({
    goal: "test",
    nodes: keys.map((key) =>
      defineNode({
        nodeId: key,
        job: `do ${key}`,
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

describe("layering", () => {
  it("puts independent nodes on the same layer", () => {
    const layers = layerNodes(compiled(["a", "b", "c", "reduce"], [
      ["a", "reduce"],
      ["b", "reduce"],
      ["c", "reduce"],
    ]));

    expect(layers).toHaveLength(2);
    expect([...layers[0]].sort()).toEqual(["a", "b", "c"]);
    expect(layers[1]).toEqual(["reduce"]);
  });

  it("places a node after its deepest dependency, not its first", () => {
    // b depends on a; c depends on both. c belongs on layer 2, not layer 1.
    const layers = layerNodes(compiled(["a", "b", "c"], [
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]));

    expect(layers).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("the execution summary", () => {
  it("states what will happen without claiming a cost", () => {
    const preview = previewGraph(compiled(["a", "b", "reduce"], [
      ["a", "reduce"],
      ["b", "reduce"],
    ]));

    expect(preview.modelNodeCount).toBe(3);
    // A confident wrong number gets budgeted against, so there is none.
    expect(preview.costNote).toContain("cannot be stated before the run");
    expect(preview).not.toHaveProperty("estimatedCostMicros");
  });

  it("says a graph with no model nodes costs nothing", () => {
    const result = compileGraph({
      goal: "test",
      nodes: [
        defineNode({
          nodeId: "only",
          job: "reduce",
          executor: "DETERMINISTIC",
          capability: "extraction",
          inputSchema: z.unknown(),
          outputSchema: z.object({ ok: z.boolean() }),
          dependsOn: [],
          reads: [],
          writes: [],
          risk: "GREEN",
        }),
      ],
      proposedEdges: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(previewGraph(result.graph).costNote).toContain("costs nothing");
  });

  it("reports the budget ceiling rather than a prediction of usage", () => {
    const preview = previewGraph(
      compiled(["a", "b", "reduce"], [
        ["a", "reduce"],
        ["b", "reduce"],
      ]),
      DEFAULT_GRAPH_BUDGET,
    );

    expect(preview.budgetNote).toContain("capped at");
    expect(preview.budgetNote).toContain(String(DEFAULT_GRAPH_BUDGET.maxNodes));
  });

  it("omits the budget note when no budget was supplied", () => {
    expect(previewGraph(compiled(["a"], [])).budgetNote).toBeNull();
  });

  it("surfaces the dependencies that were removed", () => {
    const result = compileGraph({
      goal: "test",
      nodes: ["a", "b"].map((key) =>
        defineNode({
          nodeId: key,
          job: key,
          executor: "MODEL",
          capability: "review",
          inputSchema: z.string(),
          outputSchema: z.object({ ok: z.boolean() }),
          dependsOn: [],
          reads: [],
          writes: [],
          risk: "GREEN",
        }),
      ),
      // Proposed, but b consumes nothing a produces and shares no resource.
      proposedEdges: [{ from: "a", to: "b", detail: "felt sequential" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preview = previewGraph(result.graph);
    expect(preview.removedEdges).toHaveLength(1);
    expect(preview.removedEdges[0].why).not.toBe("");
  });

  it("flags a graph needing owner approval", () => {
    const template = findTemplate("feature_build")!;
    const preview = previewTemplate({ ...template, risk: "RED" });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.requiresOwnerApproval).toBe(true);
  });

  it("previews every declared template without throwing", () => {
    for (const template of GRAPH_TEMPLATES) {
      const preview = previewTemplate(template, DEFAULT_GRAPH_BUDGET);
      expect(preview.ok, template.key).toBe(true);
      if (!preview.ok) continue;
      expect(preview.layers.length, template.key).toBeGreaterThan(0);
      // Every node lands on exactly one layer.
      expect(preview.layers.flat().length).toBe(preview.nodes.length);
    }
  });

  it("groups lock waves so nodes writing the same resource are separated", () => {
    const template = findTemplate("feature_build")!;
    const preview = previewTemplate(template);

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // The three implementation branches write different paths, so they share a
    // wave rather than queueing behind one another.
    expect(preview.lockWaves[0].length).toBeGreaterThan(1);
  });
});
