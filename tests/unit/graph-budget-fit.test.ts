// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { compileGraph, minimumGraphDurationMs, type CompiledNode } from "@/lib/graph/compiler";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, GRAPH_TEMPLATES, templateNodeContracts } from "@/lib/graph/templates";

/**
 * A budget below what the work is allowed to take stops honest work and
 * calls it overspending. Node envelopes were raised to eight minutes while
 * the default graph budget stayed at the thirty minutes that suited
 * three-minute nodes; nothing caught it, because the two numbers lived in
 * different files and neither knew about the other.
 */
describe("the graph budget", () => {
  it("can accommodate every template it is asked to run", () => {
    // Each template against the budget it will actually run under: the default,
    // plus whatever it declared for itself. Holding a nine-stage lifecycle to
    // the number that suits a five-stage build would force one of the two
    // wrong answers — a shrunken model envelope, or a ceiling widened for
    // every graph that never needed it.
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
      const budget = budgetForTemplate(template);
      const needed = minimumGraphDurationMs(compiled.graph);
      if (needed > budget.maxDurationMs) {
        tooTight.push(
          `${template.key} needs ${Math.round(needed / 60_000)} min `
          + `but its budget allows ${Math.round(budget.maxDurationMs / 60_000)} min`,
        );
      }
    }
    expect(tooTight, tooTight.join("; ")).toEqual([]);
  });

  it("records the template's own budget, not the default, when a graph is planned", () => {
    /*
     * The guard above and the plan the database receives have to be the same
     * number. Passing the bare default at the launch site would let a template
     * declare a hundred and fifty minutes, pass this suite, and then be stopped
     * as overspending at ninety — a green test and a broken run.
     */
    const lifecycle = GRAPH_TEMPLATES.find((template) => template.key === "agentic_sdlc");
    expect(lifecycle, "the Agentic SDLC template is missing").toBeDefined();

    const built = buildLaunchPlan(lifecycle!, budgetForTemplate(lifecycle!));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.budget.max_duration_ms).toBe(budgetForTemplate(lifecycle!).maxDurationMs);
    expect(built.plan.budget.max_duration_ms).toBeGreaterThan(DEFAULT_GRAPH_BUDGET.maxDurationMs);
  });

  it("derives the requirement from the critical path, not the node count", () => {
    // Ten parallel nodes cost one node's time; three in a chain cost three.
    const node = { timeoutMs: 60_000, maxAttempts: 2, backoffMs: 0 };
    expect(minimumGraphDurationMs({ nodes: Array(10).fill(node), sequentialDepth: 1 })).toBe(120_000);
    expect(minimumGraphDurationMs({ nodes: Array(3).fill(node), sequentialDepth: 3 })).toBe(360_000);
  });

  it("counts the waits between attempts, not just the attempts", () => {
    // The runner waits `backoffMs` before a retry (ADR-146). A ceiling that
    // excluded that waiting would be one a healthy run could exceed with
    // nothing having gone wrong.
    // Only the three fields the estimator reads; the rest of the node is
    // irrelevant to a duration ceiling and inventing it would obscure that.
    const chain = (fields: Pick<CompiledNode, "timeoutMs" | "maxAttempts" | "backoffMs">) =>
      [fields] as unknown as CompiledNode[];

    const node = { timeoutMs: 60_000, maxAttempts: 2, backoffMs: 2_000 };
    expect(minimumGraphDurationMs({ nodes: chain(node), sequentialDepth: 1 })).toBe(122_000);
    expect(minimumGraphDurationMs({ nodes: chain(node), sequentialDepth: 3 })).toBe(366_000);

    // A single attempt waits for nothing: there is no retry to pace.
    const once = { timeoutMs: 60_000, maxAttempts: 1, backoffMs: 2_000 };
    expect(minimumGraphDurationMs({ nodes: chain(once), sequentialDepth: 1 })).toBe(60_000);
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
    // Against the largest budget any template runs under, not the default: the
    // workflow hosts whichever graph the worker claims, and a job that dies
    // before the deepest one does leaves a run the engine still considers live.
    const widest = GRAPH_TEMPLATES.reduce(
      (worst, template) => Math.max(worst, budgetForTemplate(template).maxDurationMs),
      DEFAULT_GRAPH_BUDGET.maxDurationMs,
    );
    expect(workflowMs).toBeGreaterThan(widest);
  });
});
