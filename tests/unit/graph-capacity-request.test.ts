// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { z } from "zod";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { compileGraph } from "@/lib/graph/compiler";
import { defineNode } from "@/lib/graph/contracts";
import { runGraph } from "@/lib/graph/runner";
import type { CapacityGrant } from "@/lib/graph/runner";

/**
 * Goal 11: the graph engine must *request* capacity rather than assume it.
 *
 * The defect this covers is invisible with one graph and obvious with two. The
 * runner took its concurrency straight from its own budget, which is a claim
 * about the whole factory dressed up as a per-graph setting: two graphs in two
 * projects would each start eight nodes because each was told it could have
 * eight, and the portfolio's ceilings would never see either of them.
 */

/** N nodes with no dependencies between them: everything could start at once. */
function parallelGraph(nodeCount: number) {
  const result = compileGraph({
    goal: "Independent work that could all start at once.",
    nodes: Array.from({ length: nodeCount }, (_unused, index) =>
      defineNode({
        nodeId: `node-${index}`,
        job: `Job ${index}`,
        executor: "MODEL",
        capability: "extraction",
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        dependsOn: [],
        reads: [],
        // Distinct writes, so the scheduler's resource locks are not what
        // limits concurrency here — capacity is.
        writes: [{ kind: "file" as const, id: `file-${index}.ts` }],
        risk: "GREEN",
      })),
    proposedEdges: [],
  });
  if (!result.ok) throw new Error(`fixture graph did not compile: ${JSON.stringify(result.errors)}`);
  return result.graph;
}

const succeed = async () => ({ status: "SUCCEEDED" as const, output: {} });

describe("graph capacity requests", () => {
  it("starts no more nodes than the portfolio granted", async () => {
    const graph = parallelGraph(6);
    const started: string[][] = [];
    let round = 0;

    const result = await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxConcurrentNodes: 6, maxNodes: 100 },
      {
        executeNode: async (node) => {
          started[round] = [...(started[round] ?? []), node.nodeKey];
          return succeed();
        },
        requestCapacity: () => {
          round += 1;
          return { granted: 2, reason: "Portfolio ceiling reached." };
        },
      },
    );

    expect(result.outcome).toBe("COMPLETED");
    // Six independent nodes, two at a time: the budget would have started all
    // six in one round.
    expect(started.every((batch) => batch.length <= 2)).toBe(true);
    expect(started.flat()).toHaveLength(6);
  });

  it("says the portfolio withheld capacity, in the words the portfolio used", async () => {
    const graph = parallelGraph(2);
    const events: string[] = [];

    const result = await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxConcurrentNodes: 4, maxNodes: 100 },
      {
        executeNode: succeed,
        onEvent: (event) => {
          if (event.type === "capacity_withheld") events.push(event.detail);
        },
        requestCapacity: (): CapacityGrant => ({
          granted: 1,
          reason: "Project is at its concurrency ceiling.",
        }),
      },
    );

    expect(result.outcome).toBe("COMPLETED");
    expect(events[0]).toContain("Portfolio granted 1 of 4");
    expect(events[0]).toContain("Project is at its concurrency ceiling.");
  });

  it("ends as CAPACITY_WITHHELD rather than STALLED when nothing is granted", async () => {
    const graph = parallelGraph(3);
    const executeNode = vi.fn(succeed);

    const result = await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxConcurrentNodes: 4, maxNodes: 100 },
      {
        executeNode,
        requestCapacity: () => ({ granted: 0, reason: "Portfolio ceiling reached." }),
      },
    );

    // The distinction matters to whoever reads this: a stalled graph is broken
    // and needs a person, while this one is merely behind other work and needs
    // to be tried again.
    expect(result.outcome).toBe("CAPACITY_WITHHELD");
    expect(executeNode).not.toHaveBeenCalled();
    expect(result.percentComplete).toBe(0);
  });

  it("still runs without a portfolio, on its own budget", async () => {
    const graph = parallelGraph(3);
    const result = await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxConcurrentNodes: 4, maxNodes: 100 },
      { executeNode: succeed },
    );

    // The dependency is optional so the engine core can be exercised without a
    // database anywhere near it — which is how every other graph test runs.
    expect(result.outcome).toBe("COMPLETED");
  });

  it("never exceeds the budget even when the portfolio offers more", async () => {
    const graph = parallelGraph(4);
    const batches: number[] = [];

    await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxConcurrentNodes: 1, maxNodes: 100 },
      {
        executeNode: succeed,
        onEvent: (event) => {
          if (event.type === "node_started") batches.push(1);
        },
        // A generous portfolio does not override a graph's own limit: the
        // smaller of the two wins, in both directions.
        requestCapacity: () => ({ granted: 99, reason: "Plenty free." }),
      },
    );

    expect(batches).toHaveLength(4);
  });
});
