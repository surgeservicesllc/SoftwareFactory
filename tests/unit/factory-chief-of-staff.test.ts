// @vitest-environment node

import { describe, expect, it } from "vitest";

import { composeLaunchProposal, composePlan } from "@/lib/factory/chief-of-staff";

/**
 * The Chief of Staff composes, it never invents: layers come from the
 * stored edges by Kahn's algorithm, assignments from the specialist rules,
 * gates from the declared gate kinds, and percent from counted states.
 */

const diamond = {
  goal: "Build me a bakery site",
  nodes: [
    { node_key: "goal", capability: "planning", lifecycle_stage: "PRD", state: "COMPLETED" },
    { node_key: "build-ui-page", capability: "implementation", lifecycle_stage: "IMPLEMENTATION", state: "RUNNING" },
    { node_key: "api-endpoint", capability: "implementation", lifecycle_stage: "IMPLEMENTATION", state: "PLANNED" },
    { node_key: "review", capability: "review", lifecycle_stage: "REVIEW", state: "PLANNED", gate_kind: "HUMAN" },
  ],
  edges: [
    { from: "goal", to: "build-ui-page" },
    { from: "goal", to: "api-endpoint" },
    { from: "build-ui-page", to: "review" },
    { from: "api-endpoint", to: "review" },
  ],
};

describe("composePlan", () => {
  it("layers the diamond by its stored dependencies, parallelism counted not claimed", () => {
    const plan = composePlan(diamond);
    expect(plan.layers).toEqual([
      ["goal"],
      ["build-ui-page", "api-endpoint"],
      ["review"],
    ]);
    expect(plan.maxParallelism).toBe(2);
  });

  it("carries the intent verbatim, the assignments, the gates and the counted percent", () => {
    const plan = composePlan(diamond);
    expect(plan.requirements).toBe("Build me a bakery site");
    expect(plan.tasks.find((t) => t.key === "build-ui-page")?.specialist?.key).toBe("frontend");
    expect(plan.tasks.find((t) => t.key === "goal")?.specialist?.key).toBe("product");
    expect(plan.gatedTasks).toEqual(["review"]);
    // 1 of 4 done → 25%.
    expect(plan.progressPercent).toBe(25);
  });

  it("ignores edges naming nodes the run does not carry — the run is the truth", () => {
    const plan = composePlan({
      ...diamond,
      edges: [...diamond.edges, { from: "ghost", to: "review" }, { from: "goal", to: "phantom" }],
    });
    expect(plan.layers[0]).toEqual(["goal"]);
    expect(plan.layers[2]).toEqual(["review"]);
  });

  it("dumps a cycle into one honest final layer instead of losing nodes", () => {
    const plan = composePlan({
      goal: "x",
      nodes: [
        { node_key: "a", state: "PLANNED" },
        { node_key: "b", state: "PLANNED" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }],
    });
    expect(plan.layers.flat().sort()).toEqual(["a", "b"]);
  });

  it("answers null percent for an empty plan, never a fake zero of nothing", () => {
    expect(composePlan({ goal: "x", nodes: [], edges: [] }).progressPercent).toBeNull();
  });
});

describe("composeLaunchProposal", () => {
  it("reads the real full_lifecycle template back — nothing invented, nothing launched", () => {
    const proposal = composeLaunchProposal("Build me a bakery site");
    expect(proposal).not.toBeNull();
    if (proposal === null) return;
    expect(proposal.templateName).toBe("Full Lifecycle");
    expect(proposal.plan.requirements).toBe("Build me a bakery site");
    // The template's own shape: fourteen steps, the three parallel scans as
    // the widest layer, the goal first, three human gates.
    expect(proposal.plan.tasks).toHaveLength(14);
    expect(proposal.plan.layers[0]).toEqual(["goal"]);
    expect(proposal.plan.maxParallelism).toBe(3);
    expect(proposal.plan.gatedTasks).toEqual(["architecture", "test", "deploy"]);
    // Everything is still PLANNED — a proposal has honestly done nothing.
    expect(proposal.plan.progressPercent).toBe(0);
    // The jobs are the template's own words, acceptance criteria first.
    expect(proposal.jobs.get("goal")).toMatch(/acceptance criteria/);
  });
});
