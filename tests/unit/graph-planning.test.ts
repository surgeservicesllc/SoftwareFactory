// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineNode, modelTierFor, validateHandoffInput, validateNodeOutput } from "@/lib/graph/contracts";
import { analyzeDependencies, criticalPath, findCycle } from "@/lib/graph/dependencies";
import { selectTopology } from "@/lib/graph/topology";

const findings = z.array(z.object({ route: z.string(), severity: z.string() }));

function node(
  id: string,
  overrides: Partial<Parameters<typeof defineNode>[0]> = {},
) {
  return defineNode({
    nodeId: id,
    job: `job ${id}`,
    executor: "MODEL",
    capability: "extraction",
    inputSchema: z.unknown(),
    outputSchema: findings,
    dependsOn: [],
    reads: [],
    writes: [],
    risk: "GREEN",
    ...overrides,
  });
}

describe("node contracts", () => {
  it("rejects prose where the contract requires structure", () => {
    // The failure this exists for: an agent narrating instead of answering.
    const outcome = validateNodeOutput(node("a"), "I checked the routes and they look fine.");

    expect(outcome.valid).toBe(false);
    if (!outcome.valid) expect(outcome.code).toBe("PROSE_WHERE_STRUCTURE_REQUIRED");
  });

  it("accepts prose when the contract asks for prose", () => {
    const proseNode = node("a", { outputSchema: z.string() });
    expect(validateNodeOutput(proseNode, "a summary").valid).toBe(true);
  });

  it("reports which field violated the schema rather than just failing", () => {
    const outcome = validateNodeOutput(node("a"), [{ route: "/x" }]);

    expect(outcome.valid).toBe(false);
    if (!outcome.valid) {
      expect(outcome.code).toBe("SCHEMA_VIOLATION");
      expect(outcome.issues.join(" ")).toContain("severity");
    }
  });

  it("validates a handoff against the receiving contract, not the sending one", () => {
    const receiver = node("b", { inputSchema: z.object({ routes: z.array(z.string()) }) });

    expect(validateHandoffInput(receiver, { routes: ["/a"] }).valid).toBe(true);
    expect(validateHandoffInput(receiver, { files: ["/a"] }).valid).toBe(false);
  });

  it("tiers models by capability so cheap work does not run on the strongest model", () => {
    expect(modelTierFor(node("a", { capability: "extraction" }))).toBe("ECONOMY");
    expect(modelTierFor(node("b", { capability: "architecture" }))).toBe("STRONG");
    // Deterministic nodes must never call a model at all.
    expect(modelTierFor(node("c", { executor: "DETERMINISTIC" }))).toBe("NONE");
  });
});

describe("fake edge removal", () => {
  it("removes an edge whose target consumes nothing from its source", () => {
    const a = node("a");
    const b = node("b");

    const analysis = analyzeDependencies([a, b], [{ from: "a", to: "b" }]);

    expect(analysis.edges).toHaveLength(0);
    expect(analysis.removed).toHaveLength(1);
    expect(analysis.removed[0].why).toContain("can run in parallel");
  });

  it("keeps an edge whose target declares the source as a dependency", () => {
    const a = node("a");
    const b = node("b", { dependsOn: ["a"] });

    const analysis = analyzeDependencies([a, b], [{ from: "a", to: "b" }]);

    expect(analysis.edges).toHaveLength(1);
    expect(analysis.edges[0].reason).toBe("DATA");
    expect(analysis.edges[0].detail).toContain("dependsOn");
  });

  it("keeps a read-after-write edge even when no data is declared", () => {
    const writer = node("w", { writes: [{ kind: "file", id: "src/a.ts" }] });
    const reader = node("r", { reads: [{ kind: "file", id: "src/a.ts" }] });

    const analysis = analyzeDependencies([writer, reader], [{ from: "w", to: "r" }]);

    expect(analysis.edges[0].reason).toBe("RESOURCE_READ_AFTER_WRITE");
  });

  it("accepts a policy edge on the planner's word, since data cannot justify it", () => {
    const analysis = analyzeDependencies(
      [node("a"), node("b")],
      [{ from: "a", to: "b", reason: "POLICY", detail: "Owner requires review first." }],
    );

    expect(analysis.edges).toHaveLength(1);
    expect(analysis.edges[0].reason).toBe("POLICY");
  });
});

describe("hidden dependency detection", () => {
  it("discovers a read-after-write edge nobody proposed", () => {
    const writer = node("w", { writes: [{ kind: "migration", id: "0001" }] });
    const reader = node("r", { reads: [{ kind: "migration", id: "0001" }] });

    const analysis = analyzeDependencies([writer, reader], []);

    expect(analysis.discovered).toHaveLength(1);
    expect(analysis.discovered[0].detail).toContain("Hidden dependency");
  });

  it("reports two nodes writing the same resource as a conflict, not an ordering", () => {
    const one = node("one", { writes: [{ kind: "file", id: "app/page.tsx" }] });
    const two = node("two", { writes: [{ kind: "file", id: "app/page.tsx" }] });

    const analysis = analyzeDependencies([one, two], []);

    expect(analysis.writeConflicts).toHaveLength(1);
    expect(analysis.writeConflicts[0].nodes).toEqual(["one", "two"]);
    // A conflict is not an edge: neither needs the other's output.
    expect(analysis.edges).toHaveLength(0);
  });

  it("reports each conflicting pair once", () => {
    const write = [{ kind: "file" as const, id: "shared.ts" }];
    const analysis = analyzeDependencies(
      [node("a", { writes: write }), node("b", { writes: write })],
      [],
    );

    expect(analysis.writeConflicts).toHaveLength(1);
  });
});

describe("graph shape", () => {
  it("finds a cycle and names the path", () => {
    const a = node("a", { dependsOn: ["c"] });
    const b = node("b", { dependsOn: ["a"] });
    const c = node("c", { dependsOn: ["b"] });

    const analysis = analyzeDependencies(
      [a, b, c],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    );

    expect(findCycle([a, b, c], analysis.edges)).not.toBeNull();
  });

  it("returns null when there is no cycle", () => {
    const a = node("a");
    const b = node("b", { dependsOn: ["a"] });
    const analysis = analyzeDependencies([a, b], [{ from: "a", to: "b" }]);

    expect(findCycle([a, b], analysis.edges)).toBeNull();
  });

  it("measures the critical path as the longest dependent chain", () => {
    const a = node("a");
    const b = node("b", { dependsOn: ["a"] });
    const c = node("c", { dependsOn: ["b"] });
    const parallel = node("p");

    const analysis = analyzeDependencies(
      [a, b, c, parallel],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    );

    expect(criticalPath([a, b, c, parallel], analysis.edges)).toEqual(["a", "b", "c"]);
  });
});

describe("topology selection", () => {
  it("uses a single agent for one node", () => {
    const decision = selectTopology({ nodes: [node("a")], proposedEdges: [] });

    expect(decision.topology).toBe("SINGLE_AGENT");
    expect(decision.reasons[0].code).toBe("SINGLE_NODE");
  });

  it("refuses to build a graph for small work even when it could parallelise", () => {
    // The bias that matters: two independent nodes are cheaper as one job than
    // as a scheduled graph with a reduce step.
    const decision = selectTopology({
      nodes: [node("a"), node("b")],
      proposedEdges: [],
    });

    expect(decision.topology).toBe("SINGLE_AGENT");
    expect(decision.reasons.map((r) => r.code)).toContain("OVERHEAD_NOT_JUSTIFIED");
  });

  it("chooses a diamond for a wide fan-out that converges", () => {
    const workers = ["w1", "w2", "w3", "w4", "w5"].map((id) => node(id));
    const reduce = node("reduce", {
      executor: "DETERMINISTIC",
      capability: "synthesis",
      dependsOn: workers.map((w) => w.nodeId),
    });

    const decision = selectTopology({
      nodes: [...workers, reduce],
      proposedEdges: workers.map((w) => ({ from: w.nodeId, to: "reduce" })),
    });

    expect(decision.topology).toBe("DIAMOND");
    expect(decision.maxParallelism).toBe(5);
    expect(decision.sequentialDepth).toBe(2);
  });

  it("chooses SEQUENTIAL when a long chain has nothing to overlap", () => {
    const nodes = ["a", "b", "c", "d"].map((id, index, all) =>
      node(id, { dependsOn: index === 0 ? [] : [all[index - 1]] }),
    );
    const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].nodeId, to: n.nodeId }));

    const decision = selectTopology({ nodes, proposedEdges: edges });

    expect(decision.topology).toBe("SEQUENTIAL");
    expect(decision.maxParallelism).toBe(1);
  });

  it("chooses a discovery graph when the size is unknown", () => {
    const decision = selectTopology({
      nodes: [node("a"), node("b"), node("c")],
      proposedEdges: [],
      discovery: true,
    });

    expect(decision.topology).toBe("DISCOVERY_GRAPH");
  });

  it("chooses a loop for iterative refinement", () => {
    const decision = selectTopology({
      nodes: [node("a"), node("b"), node("c")],
      proposedEdges: [],
      iterative: true,
    });

    expect(decision.topology).toBe("LOOP");
    expect(decision.maxParallelism).toBe(1);
  });

  it("flags RED work as needing owner approval", () => {
    const decision = selectTopology({
      nodes: [node("a")],
      proposedEdges: [],
      risk: "RED",
    });

    expect(decision.requiresOwnerApproval).toBe(true);
  });

  it("becomes parallel only because fake edges were removed", () => {
    const workers = ["w1", "w2", "w3", "w4"].map((id) => node(id));
    const reduce = node("r", {
      executor: "DETERMINISTIC",
      capability: "synthesis",
      dependsOn: workers.map((w) => w.nodeId),
    });

    // A planner that described the work as a sentence chained the workers.
    const decision = selectTopology({
      nodes: [...workers, reduce],
      proposedEdges: [
        { from: "w1", to: "w2" },
        { from: "w2", to: "w3" },
        { from: "w3", to: "w4" },
        ...workers.map((w) => ({ from: w.nodeId, to: "r" })),
      ],
    });

    expect(decision.analysis.removed).toHaveLength(3);
    expect(decision.maxParallelism).toBe(4);
    expect(decision.sequentialDepth).toBe(2);
  });
});
