// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { compileGraph, describeCompiledGraph } from "@/lib/graph/compiler";
import { defineNode } from "@/lib/graph/contracts";
import {
  buildNodeContext,
  buildVerifierContext,
  prepareHandoff,
  verifierContextIsClean,
} from "@/lib/graph/handoffs";

function node(id: string, overrides: Partial<Parameters<typeof defineNode>[0]> = {}) {
  return defineNode({
    nodeId: id,
    job: `job ${id}`,
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

describe("graph compiler", () => {
  it("compiles a plan into a durable definition", () => {
    const result = compileGraph({
      goal: "Audit routes",
      nodes: [node("a"), node("b", { dependsOn: ["a"] })],
      proposedEdges: [{ from: "a", to: "b" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.goal).toBe("Audit routes");
  });

  it("rejects an empty graph", () => {
    const result = compileGraph({ goal: "nothing", nodes: [], proposedEdges: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe("EMPTY_GRAPH");
  });

  it("rejects a dependency on a node that is not in the graph", () => {
    const result = compileGraph({
      goal: "dangling",
      nodes: [node("a", { dependsOn: ["ghost"] })],
      proposedEdges: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe("UNKNOWN_DEPENDENCY");
    expect(result.errors[0].detail).toContain("ghost");
  });

  it("rejects a duplicate node key", () => {
    const result = compileGraph({
      goal: "dupes",
      nodes: [node("a"), node("a")],
      proposedEdges: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe("DUPLICATE_NODE_KEY");
  });

  it("rejects a cycle before anything is spent, naming the path", () => {
    const result = compileGraph({
      goal: "cycle",
      nodes: [
        node("a", { dependsOn: ["c"] }),
        node("b", { dependsOn: ["a"] }),
        node("c", { dependsOn: ["b"] }),
      ],
      proposedEdges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const cycle = result.errors.find((error) => error.code === "CYCLE");
    expect(cycle?.detail).toContain("→");
  });

  it("refuses to compile an unresolved write conflict", () => {
    // Silently letting two nodes write one file is exactly what conflict
    // detection exists to prevent, so it fails compilation rather than running.
    const write = [{ kind: "file" as const, id: "app/page.tsx" }];
    const result = compileGraph({
      goal: "conflict",
      nodes: [node("a", { writes: write }), node("b", { writes: write }), node("c")],
      proposedEdges: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe("WRITE_CONFLICT_UNRESOLVED");
    expect(result.errors[0].detail).toContain("Serialize them");
  });

  it("accepts a write conflict the caller has arranged to serialize", () => {
    const write = [{ kind: "file" as const, id: "app/page.tsx" }];
    const result = compileGraph({
      goal: "conflict resolved",
      nodes: [node("a", { writes: write }), node("b", { writes: write }), node("c")],
      proposedEdges: [],
      resolvedWriteConflicts: ["file:app/page.tsx"],
    });

    expect(result.ok).toBe(true);
  });

  it("summarises what running the graph would involve", () => {
    const workers = ["w1", "w2", "w3", "w4"].map((id) => node(id));
    const reduce = node("r", {
      executor: "DETERMINISTIC",
      capability: "synthesis",
      dependsOn: workers.map((w) => w.nodeId),
    });

    const result = compileGraph({
      goal: "Audit every route",
      nodes: [...workers, reduce],
      // A planner that wrote the work as a sentence chained the workers.
      proposedEdges: [
        { from: "w1", to: "w2" },
        { from: "w2", to: "w3" },
        ...workers.map((w) => ({ from: w.nodeId, to: "r" })),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summary = describeCompiledGraph(result.graph);
    expect(summary).toContain("Topology: DIAMOND");
    expect(summary).toContain("Parallel workers: 4");
    // The number that explains why it is fast.
    expect(summary).toContain("Removed 2 unjustified dependencies");
    expect(summary).toContain("Model calls: 4 of 5");
  });

  it("says when a graph needs owner approval", () => {
    const result = compileGraph({
      goal: "risky",
      nodes: [node("a")],
      proposedEdges: [],
      risk: "RED",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(describeCompiledGraph(result.graph)).toContain("Owner approval required");
  });
});

describe("handoffs", () => {
  const receiver = node("consumer", {
    job: "Summarise the findings",
    inputSchema: z.object({ findings: z.array(z.string()) }),
  });

  it("marks a handoff valid when it satisfies the receiving contract", () => {
    const handoff = prepareHandoff(receiver, {
      fromNodeKey: "producer",
      toNodeKey: "consumer",
      payload: { findings: ["/a missing auth"] },
    });

    expect(handoff.contractValid).toBe(true);
    expect(handoff.validationIssues).toEqual([]);
  });

  it("stores an invalid handoff rather than dropping it", () => {
    // A rejected handoff is evidence about why a node is blocked; deleting it
    // would leave the graph unable to explain itself.
    const handoff = prepareHandoff(receiver, {
      fromNodeKey: "producer",
      toNodeKey: "consumer",
      payload: { wrong: true },
    });

    expect(handoff.contractValid).toBe(false);
    expect(handoff.validationIssues.length).toBeGreaterThan(0);
    expect(handoff.payload).toEqual({ wrong: true });
  });

  it("gives a node only valid inputs, but reports that something was invalid", () => {
    const good = prepareHandoff(receiver, {
      fromNodeKey: "a",
      toNodeKey: "consumer",
      payload: { findings: ["one"] },
      decisions: ["Treated redirects as routes."],
      assumptions: ["The route list is complete."],
    });
    const bad = prepareHandoff(receiver, {
      fromNodeKey: "b",
      toNodeKey: "consumer",
      payload: "just some prose",
      blockers: ["Could not read the manifest."],
    });

    const context = buildNodeContext(receiver, [good, bad]);

    expect(context.inputs).toHaveLength(1);
    expect(context.hasInvalidInput).toBe(true);
    // Assumptions travel: an unexamined one upstream becomes a defect here.
    expect(context.inheritedAssumptions).toEqual(["The route list is complete."]);
    expect(context.unresolvedBlockers).toEqual(["Could not read the manifest."]);
  });

  it("keeps worker reasoning out of a verifier's context", () => {
    const workerContext = buildNodeContext(receiver, [
      prepareHandoff(receiver, {
        fromNodeKey: "a",
        toNodeKey: "consumer",
        payload: { findings: ["one"] },
        decisions: ["Assumed every /api route needs auth."],
      }),
    ]);

    const clean = buildVerifierContext({
      claim: { findings: ["one"] },
      sourceMaterial: ["app/api/health/route.ts"],
      instructions: "Confirm each finding against the source.",
    });
    expect(verifierContextIsClean(clean, workerContext)).toBe(true);

    // A verifier shown the worker's reasoning checks coherence, not truth.
    const leaky = buildVerifierContext({
      claim: { findings: ["one"] },
      sourceMaterial: ["The worker noted: Assumed every /api route needs auth."],
      instructions: "Confirm each finding against the source.",
    });
    expect(verifierContextIsClean(leaky, workerContext)).toBe(false);
  });

  it("carries no decisions or assumptions by construction", () => {
    const context = buildVerifierContext({
      claim: { findings: [] },
      instructions: "Check it.",
    });

    expect(Object.keys(context)).toEqual([
      "claim",
      "evidence",
      "acceptanceCriteria",
      "sourceMaterial",
      "instructions",
    ]);
  });
});
