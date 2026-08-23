import { describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import {
  type GraphTemplate,
  GRAPH_TEMPLATES,
  stageForCapability,
  templateStageFor,
} from "@/lib/graph/templates";

/**
 * A node's stage and a graph's iteration are two different things.
 *
 * They used to be one: `isLifecycle` was inferred from "any node declares a
 * lifecycleStage", so an audit could not say which stage its nodes sit in
 * without also becoming a lifecycle the orchestrator re-runs on unmet
 * acceptance. The Stage column in the graph-runs panel was the visible cost —
 * empty for every audit run, which is every run the analysis button produces.
 */
describe("template lifecycle stages", () => {
  it("gives every node in every template a stage", () => {
    // The Stage column reads this. A node without one renders "—", and a
    // column that is blank for real runs is a column nobody can trust.
    // Asserted through the function that decides, not the raw field: a
    // declared stage and one resolved from capability are equally real to
    // everything downstream, and only this function knows which applied.
    const unlabelled = GRAPH_TEMPLATES.flatMap((template) =>
      template.nodes
        .filter((node) => templateStageFor(template, node.nodeId).stage === null)
        .map((node) => `${template.key}/${node.nodeId}`),
    );

    expect(unlabelled, `nodes with no lifecycle stage: ${unlabelled.join(", ")}`).toEqual([]);
  });

  it("iterates only the template that declares itself a lifecycle", () => {
    /*
     * The guard on the decoupling. Every audit template now carries stages;
     * none of them may become iterating lifecycles because of it — a read-only
     * analysis that re-runs itself would spend subscription turns on repeat
     * passes nobody asked for.
     */
    const iterating = GRAPH_TEMPLATES.filter((template) => template.isLifecycle === true);

    expect(iterating.map((template) => template.key)).toEqual(["agentic_sdlc"]);
  });

  it("places a node's stage by the work it does, not by its template", () => {
    // One rule, so a lifecycle template and an audit describe the same
    // capability the same way.
    expect(stageForCapability("qa")).toBe("TEST");
    expect(stageForCapability("implementation")).toBe("IMPLEMENTATION");
    expect(stageForCapability("architecture")).toBe("ARCHITECTURE");
    expect(stageForCapability("planning")).toBe("PRD");
    for (const capability of ["review", "security_review", "extraction", "synthesis", "reporting"] as const) {
      expect(stageForCapability(capability), capability).toBe("REVIEW");
    }
  });

  it("stages the analysis templates the Step 9 button launches", () => {
    // Named explicitly: these are the graphs the owner's runs actually use,
    // and the ones whose Stage column was empty.
    for (const key of ["production_readiness", "bug_sweep", "security_audit"]) {
      const template = GRAPH_TEMPLATES.find((candidate) => candidate.key === key);
      expect(template, key).toBeTruthy();
      expect(
        template!.nodes.every((node) => templateStageFor(template!, node.nodeId).stage !== null),
        key,
      ).toBe(true);
      expect(template!.isLifecycle === true, `${key} must not iterate`).toBe(false);
    }
  });

  it("does not turn a stage override into an iterating lifecycle", () => {
    /*
     * The guard that actually holds the decoupling.
     *
     * Asserting over the shipped templates proves nothing here: none of them
     * declares a stage override today, so inferring `isLifecycle` from stage
     * presence and reading the explicit flag give the same answer. This builds
     * the case that separates them — an audit-shaped template with one
     * explicitly staged node and no lifecycle claim. Under the old inference
     * it came back as a lifecycle the orchestrator may re-run; it must not.
     */
    const template: GraphTemplate = {
      key: "stage_override_probe",
      name: "Stage override probe",
      category: "AUDIT",
      summary: "One node names its own stage, and the graph is still not a lifecycle.",
      version: 1,
      risk: "GREEN",
      nodes: [
        {
          nodeId: "inspect",
          job: "Inspect one thing and report what it found.",
          capability: "review",
          executor: "MODEL",
          lifecycleStage: "REVIEW",
        },
      ],
      proposedEdges: [],
    };

    const built = buildLaunchPlan(template, DEFAULT_GRAPH_BUDGET);

    expect(built.ok, built.ok ? "" : built.errors.join(" ")).toBe(true);
    expect(built.ok && built.plan.isLifecycle).toBe(false);
  });
});
