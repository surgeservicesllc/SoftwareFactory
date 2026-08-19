// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { compileGraph, minimumGraphDurationMs } from "@/lib/graph/compiler";
import { GRAPH_TEMPLATES, templateNodeContracts } from "@/lib/graph/templates";

/**
 * A budget below what the work is allowed to take stops honest work and
 * calls it overspending. Node envelopes were raised to eight minutes while
 * the default graph budget stayed at the thirty minutes that suited
 * three-minute nodes; nothing caught it, because the two numbers lived in
 * different files and neither knew about the other.
 */
describe("the default graph budget", () => {
  it("can accommodate every template it is asked to run", () => {
    const tooTight: string[] = [];
    for (const template of GRAPH_TEMPLATES) {
      const compiled = compileGraph({
        goal: template.summary,
        nodes: templateNodeContracts(template),
        proposedEdges: template.proposedEdges,
        risk: template.risk,
        resolvedWriteConflicts: template.resolvedWriteConflicts,
      });
      if (!compiled.ok) continue; // compilation is a different test's subject
      const needed = minimumGraphDurationMs(compiled.graph);
      if (needed > DEFAULT_GRAPH_BUDGET.maxDurationMs) {
        tooTight.push(
          `${template.key} needs ${Math.round(needed / 60_000)} min `
          + `but the budget allows ${Math.round(DEFAULT_GRAPH_BUDGET.maxDurationMs / 60_000)} min`,
        );
      }
    }
    expect(tooTight, tooTight.join("; ")).toEqual([]);
  });

  it("derives the requirement from the critical path, not the node count", () => {
    // Ten parallel nodes cost one node's time; three in a chain cost three.
    const node = { timeoutMs: 60_000, maxAttempts: 2 };
    expect(minimumGraphDurationMs({ nodes: Array(10).fill(node), sequentialDepth: 1 })).toBe(120_000);
    expect(minimumGraphDurationMs({ nodes: Array(3).fill(node), sequentialDepth: 3 })).toBe(360_000);
  });
});

describe("the worker's workflow timeout", () => {
  it("outlives the graph budget it is asked to host", () => {
    // A workflow that dies before the budget does kills a run the engine
    // still considers live, and the run then sits RUNNING until the
    // two-hour reclaim sweep notices. The chain has to hold end to end:
    // node envelope → graph budget → workflow timeout.
    const workflow = readFileSync(
      resolve(import.meta.dirname, "../../.github/workflows/graph-worker.yml"),
      "utf8",
    );
    const declared = /timeout-minutes:\s*(\d+)/.exec(workflow);
    expect(declared, "graph-worker.yml no longer declares a job timeout").not.toBeNull();
    const workflowMs = Number(declared?.[1]) * 60_000;
    expect(workflowMs).toBeGreaterThan(DEFAULT_GRAPH_BUDGET.maxDurationMs);
  });
});
