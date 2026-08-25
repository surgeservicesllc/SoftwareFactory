// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { compileGraph, type CompiledGraph } from "@/lib/graph/compiler";
import { defineNode } from "@/lib/graph/contracts";
import { contendedResources, runGraph, type NodeExecutionResult } from "@/lib/graph/runner";

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

function compile(
  nodes: ReturnType<typeof node>[],
  edges: { from: string; to: string }[] = [],
): CompiledGraph {
  const result = compileGraph({ goal: "test", nodes, proposedEdges: edges });
  if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result.errors)}`);
  return result.graph;
}

const succeed = (output: unknown = ["finding"]): NodeExecutionResult => ({
  status: "SUCCEEDED",
  output,
});

describe("node runner", () => {
  it("runs a whole graph and reports it complete", async () => {
    const graph = compile([node("a"), node("b", { dependsOn: ["a"] })], [{ from: "a", to: "b" }]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async () => succeed(),
    });

    expect(result.outcome).toBe("COMPLETED");
    expect(result.percentComplete).toBe(100);
    expect(result.incompleteness).toBeNull();
  });

  it("runs independent nodes concurrently", async () => {
    const graph = compile([node("a"), node("b"), node("c"), node("d")]);

    let peak = 0;
    let inFlight = 0;
    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return succeed();
      },
    });

    expect(result.outcome).toBe("COMPLETED");
    // The concurrency is the entire point of having removed fake edges.
    expect(peak).toBeGreaterThan(1);
  });

  it("honours dependency order", async () => {
    const graph = compile(
      [node("first"), node("second", { dependsOn: ["first"] })],
      [{ from: "first", to: "second" }],
    );

    const order: string[] = [];
    await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async (n) => {
        order.push(n.nodeKey);
        return succeed();
      },
    });

    expect(order).toEqual(["first", "second"]);
  });

  it("retries a retryable failure up to the node's limit, then fails", async () => {
    const graph = compile([node("flaky", { retry: { maxAttempts: 3, backoffMs: 0, allowProviderFallback: true } })]);

    const execute = vi.fn(
      async (): Promise<NodeExecutionResult> => ({
        status: "FAILED",
        error: "rate limited",
        retryable: true,
      }),
    );

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, { executeNode: execute });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.states.get("flaky")).toBe("FAILED");
    expect(result.spend.retriesUsed).toBe(2);
  });

  it("waits the node's declared backoff before a retry is dispatched", async () => {
    // `RetryPolicy.backoffMs` shipped declared, defaulted to two seconds, and
    // read by nothing: the compiler dropped it and the runner re-queued the
    // node into the very next tick. Every graph retry fired into the same
    // instant that had just refused it, which is the worst moment to ask.
    const graph = compile([
      node("flaky", { retry: { maxAttempts: 3, backoffMs: 2_000, allowProviderFallback: true } }),
    ]);

    const waits: number[] = [];
    const execute = vi.fn(
      async (): Promise<NodeExecutionResult> => ({
        status: "FAILED",
        error: "API Error: 529 Overloaded",
        retryable: true,
      }),
    );

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: execute,
      delay: async (ms) => { waits.push(ms); },
    });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2_000, 2_000]);
    expect(result.events.filter((event) => event.type === "retry_backoff")).toHaveLength(2);
  });

  it("waits once for a whole round of retries, not once per node", async () => {
    // An overloaded provider refuses everything in flight, so the batch comes
    // back asking for the same pause. Serving it per node would multiply one
    // outage into a wait proportional to the graph's width.
    const graph = compile([
      node("a", { retry: { maxAttempts: 2, backoffMs: 2_000, allowProviderFallback: true } }),
      node("b", { retry: { maxAttempts: 2, backoffMs: 2_000, allowProviderFallback: true } }),
      node("c", { retry: { maxAttempts: 2, backoffMs: 2_000, allowProviderFallback: true } }),
    ]);

    const waits: number[] = [];
    await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async (): Promise<NodeExecutionResult> => ({
        status: "FAILED",
        error: "API Error: 529 Overloaded",
        retryable: true,
      }),
      delay: async (ms) => { waits.push(ms); },
    });

    expect(waits).toEqual([2_000]);
  });

  it("does not wait when nothing was retried", async () => {
    const graph = compile([
      node("clean", { retry: { maxAttempts: 3, backoffMs: 2_000, allowProviderFallback: true } }),
    ]);

    const waits: number[] = [];
    await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async () => succeed(),
      delay: async (ms) => { waits.push(ms); },
    });

    expect(waits).toEqual([]);
  });

  it("does not retry a failure declared non-retryable", async () => {
    const graph = compile([node("blocked")]);

    const execute = vi.fn(
      async (): Promise<NodeExecutionResult> => ({
        status: "FAILED",
        error: "invalid credential",
        retryable: false,
      }),
    );

    await runGraph(graph, DEFAULT_GRAPH_BUDGET, { executeNode: execute });

    // Retrying a credential failure just spends money to fail again.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects output that violates the contract and retries", async () => {
    const graph = compile([node("shaky", { retry: { maxAttempts: 2, backoffMs: 0, allowProviderFallback: false } })]);

    let call = 0;
    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async () => {
        call += 1;
        return succeed(call === 1 ? "prose instead of findings" : ["real finding"]);
      },
      validateOutput: (_n, output) =>
        Array.isArray(output)
          ? { valid: true, issues: [] }
          : { valid: false, issues: ["expected an array"] },
    });

    expect(result.states.get("shaky")).toBe("COMPLETED");
    expect(result.outputs.get("shaky")).toEqual(["real finding"]);
    expect(result.events.some((e) => e.type === "node_output_rejected")).toBe(true);
  });

  it("fails a node whose output never satisfies its contract", async () => {
    const graph = compile([node("bad", { retry: { maxAttempts: 2, backoffMs: 0, allowProviderFallback: false } })]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async () => succeed("always prose"),
      validateOutput: () => ({ valid: false, issues: ["expected an array"] }),
    });

    expect(result.states.get("bad")).toBe("FAILED");
    expect(result.outputs.has("bad")).toBe(false);
  });

  it("blocks dependents of a failed node but finishes unrelated branches", async () => {
    const graph = compile(
      [node("doomed"), node("downstream", { dependsOn: ["doomed"] }), node("unrelated")],
      [{ from: "doomed", to: "downstream" }],
    );

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async (n) =>
        n.nodeKey === "doomed"
          ? { status: "FAILED", error: "boom", retryable: false }
          : succeed(),
    });

    expect(result.states.get("doomed")).toBe("FAILED");
    expect(result.states.get("downstream")).toBe("BLOCKED");
    // Unrelated work is not punished for another branch's failure.
    expect(result.states.get("unrelated")).toBe("COMPLETED");
  });

  it("refuses to call a run complete when a node failed", async () => {
    const graph = compile([node("ok"), node("bad")]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async (n) =>
        n.nodeKey === "bad"
          ? { status: "FAILED", error: "boom", retryable: false }
          : succeed(),
    });

    expect(result.outcome).toBe("PARTIAL");
    expect(result.percentComplete).toBe(50);
    // The caveat travels in words, so it cannot be dropped on the way to a report.
    expect(result.incompleteness).toContain("must not be presented as a complete answer");
  });

  it("stops gracefully at the budget and keeps completed work", async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`));
    const graph = compile(nodes);

    const result = await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxNodes: 2, maxConcurrentNodes: 1 },
      { executeNode: async () => succeed() },
    );

    expect(result.outcome).toBe("BUDGET_STOPPED");
    expect(result.events.some((e) => e.type === "budget_stopped")).toBe(true);
    // Graceful means the finished nodes are still finished.
    expect([...result.states.values()].filter((s) => s === "COMPLETED").length).toBeGreaterThan(0);
  });

  it("degrades concurrency before exhausting the budget", async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => node(`n${i}`));
    const graph = compile(nodes);

    const result = await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxNodes: 10, maxConcurrentNodes: 8 },
      { executeNode: async () => succeed() },
    );

    expect(result.events.some((e) => e.type === "budget_degraded")).toBe(true);
  });

  it("accumulates real usage and leaves cost absent when nothing reported it", async () => {
    const graph = compile([node("a"), node("b")]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async () => ({ status: "SUCCEEDED", output: [], tokensUsed: 100 }),
    });

    expect(result.spend.tokensUsed).toBe(200);
    // No provider reported cost, so there is none — not zero.
    expect(result.spend.costMicros).toBeUndefined();
  });

  it("counts spend from failed attempts, not just successful ones", async () => {
    // A failed provider call still costs money. If failures did not count,
    // retries would spend the budget invisibly — the exact direction a graph
    // engine overspends in.
    const graph = compile([
      node("flaky", { retry: { maxAttempts: 3, backoffMs: 0, allowProviderFallback: false } }),
    ]);

    const result = await runGraph(graph, DEFAULT_GRAPH_BUDGET, {
      executeNode: async () => ({
        status: "FAILED",
        error: "timeout",
        retryable: true,
        tokensUsed: 500,
      }),
    });

    expect(result.states.get("flaky")).toBe("FAILED");
    expect(result.spend.tokensUsed).toBe(1500);
  });

  it("names the resources two nodes would fight over", () => {
    const shared = { kind: "file" as const, id: "app/page.tsx" };
    const nodes = [
      { nodeKey: "a", writes: [shared] },
      { nodeKey: "b", writes: [shared] },
      { nodeKey: "c", writes: [{ kind: "file" as const, id: "other.ts" }] },
    ];

    expect(contendedResources(nodes as never)).toEqual(["file:app/page.tsx"]);
  });
});
