// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { GraphRunSummary, RunNode } from "@/lib/sdlc/stage-view";
import { lifecycleStatuses, stagePageView, stageRunView } from "@/lib/sdlc/stage-view";

/**
 * The stage view is where a wrong answer would be least visible.
 *
 * A stage reported green while a node in it failed, a "waiting" that is really
 * "never started", a parallel count that counts nodes rather than nodes that
 * can run at once — none of those look wrong in a screenshot, and all of them
 * change what a person believes about a run.
 */

function node(partial: Partial<RunNode> & { node_key: string; state: string }): RunNode {
  return { lifecycle_stage: null, ...partial };
}

function run(nodes: RunNode[], overrides: Partial<GraphRunSummary> = {}): GraphRunSummary {
  return {
    graphRunId: "run-1",
    graphId: "graph-1",
    goal: "Add world-class backtesting to the trading platform.",
    topology: "DAG",
    riskLevel: "yellow",
    projectId: "project-1",
    state: "RUNNING",
    startedAt: "2026-08-23T10:00:00Z",
    completedAt: null,
    nodes,
    edges: [],
    artifactCounts: {},
    isLifecycle: true,
    iteration: 1,
    maxIterations: 3,
    ...overrides,
  };
}

const discoverFanOut = [
  node({ node_key: "requirement", state: "COMPLETED", lifecycle_stage: "REQUIREMENT" }),
  node({
    node_key: "discover_internal",
    state: "COMPLETED",
    lifecycle_stage: "DISCOVER",
    anchor_count: 2,
    artifact_count: 2,
    depends_on: ["requirement"],
  }),
  node({
    node_key: "discover_packages",
    state: "COMPLETED",
    lifecycle_stage: "DISCOVER",
    anchor_count: 3,
    artifact_count: 3,
    depends_on: ["requirement"],
  }),
  node({
    node_key: "discover_services",
    state: "RUNNING",
    lifecycle_stage: "DISCOVER",
    depends_on: ["requirement"],
  }),
  node({
    node_key: "discover_shortlist",
    state: "PENDING",
    lifecycle_stage: "DISCOVER",
    depends_on: ["discover_internal", "discover_packages", "discover_services"],
  }),
];

describe("one stage of one run", () => {
  it("is null when the run's plan never included the stage", () => {
    // Not "Not Started": a run that never planned DEPLOY is not evidence that
    // DEPLOY has not started, it is silence about DEPLOY.
    expect(stageRunView("DEPLOY", run(discoverFanOut))).toBeNull();
  });

  it("counts parallelism as nodes that can run at once, not nodes in the stage", () => {
    const view = stageRunView("DISCOVER", run(discoverFanOut));
    expect(view).not.toBeNull();
    expect(view!.nodes).toHaveLength(4);
    // Three observers in one band, then the shortlist that waits on all three.
    expect(view!.parallelism).toBe(3);
    expect(view!.nodes.find((n) => n.nodeKey === "discover_shortlist")!.depth).toBe(1);
    expect(view!.nodes.find((n) => n.nodeKey === "discover_internal")!.depth).toBe(0);
  });

  it("ignores dependencies on other stages when measuring depth", () => {
    // All three observers depend on `requirement`, which is in another stage.
    // Counting that edge would put them at different depths and report a
    // parallelism of one for a stage that fans out three ways.
    const view = stageRunView("DISCOVER", run(discoverFanOut));
    expect(view!.nodes.find((n) => n.nodeKey === "discover_packages")!.depth).toBe(0);
  });

  it("reports progress as a count, never as a percentage of nothing", () => {
    const view = stageRunView("DISCOVER", run(discoverFanOut));
    expect(view!.progress).toEqual({ done: 2, total: 4 });
  });

  it("sums the stage's evidence across its nodes", () => {
    const view = stageRunView("DISCOVER", run(discoverFanOut));
    expect(view!.anchorCount).toBe(5);
    expect(view!.artifactCount).toBe(5);
  });

  it("takes the worst node status, not the most common", () => {
    const failing = stageRunView("DISCOVER", run([
      ...discoverFanOut.slice(0, 2),
      node({ node_key: "discover_services", state: "FAILED", lifecycle_stage: "DISCOVER" }),
    ]));
    expect(failing!.status).toBe("Failed");
  });

  it("lets an open gate outrank a node that finished its work", () => {
    const view = stageRunView("ARCHITECT", run([
      node({
        node_key: "architect",
        state: "COMPLETED",
        lifecycle_stage: "ARCHITECT",
        gate_id: "gate-1",
        gate_kind: "HUMAN",
        gate_state: "OPEN",
        gate_anchor_count: 0,
      }),
    ]));
    expect(view!.status).toBe("Reviewing");
    expect(view!.nodes[0].status).toBe("review");
    expect(view!.gates).toEqual([{
      id: "gate-1",
      nodeKey: "architect",
      kind: "HUMAN",
      state: "OPEN",
      anchorCount: 0,
      reason: null,
    }]);
  });

  it("marks a stage as repairing when a later rejection routes work back to it", () => {
    // BUILD is where a rejected REVIEW sends the work. Asked of the return
    // table rather than of a flag, because a rejection is not always followed
    // by a write that says where the work went.
    const rejected = run([
      node({ node_key: "build_server", state: "COMPLETED", lifecycle_stage: "BUILD" }),
      node({
        node_key: "review",
        state: "FAILED",
        lifecycle_stage: "REVIEW",
        gate_id: "gate-2",
        gate_kind: "AUTOMATIC",
        gate_state: "REJECTED",
        gate_reason: "The change does not match the architecture.",
      }),
    ]);
    const build = stageRunView("BUILD", rejected);
    expect(build!.repairing).toBe(true);
    expect(build!.status).toBe("Repairing");

    // And REVIEW itself is not repairing — it is where the rejection happened.
    expect(stageRunView("REVIEW", rejected)!.repairing).toBe(false);
  });

  it("says a stage has no agents rather than inventing one", () => {
    const view = stageRunView("DISCOVER", run(discoverFanOut));
    expect(view!.agents).toEqual([]);
  });

  it("lists each provider and model once, however many nodes used it", () => {
    const view = stageRunView("BUILD", run([
      node({ node_key: "a", state: "COMPLETED", lifecycle_stage: "BUILD", provider: "anthropic", model: "m" }),
      node({ node_key: "b", state: "COMPLETED", lifecycle_stage: "BUILD", provider: "anthropic", model: "m" }),
      node({ node_key: "c", state: "COMPLETED", lifecycle_stage: "BUILD", provider: "openai", model: "n" }),
    ]));
    expect(view!.agents).toEqual([
      { provider: "anthropic", model: "m" },
      { provider: "openai", model: "n" },
    ]);
  });

  it("carries a node's own words for a failure rather than a paraphrase", () => {
    const view = stageRunView("TEST", run([
      node({
        node_key: "test",
        state: "FAILED",
        lifecycle_stage: "TEST",
        error_message: "vitest exited 1: 3 failed",
      }),
    ]));
    expect(view!.issues).toEqual([{ nodeKey: "test", detail: "vitest exited 1: 3 failed" }]);
  });

  it("explains a rejection with where the work goes when the gate gave no reason", () => {
    const view = stageRunView("ARCHITECT", run([
      node({
        node_key: "architect",
        state: "FAILED",
        lifecycle_stage: "ARCHITECT",
        gate_id: "g",
        gate_kind: "HUMAN",
        gate_state: "REJECTED",
      }),
    ]));
    expect(view!.issues.at(-1)!.detail).toContain("returns the work to Decide");
  });

  it("names the stage on each side, with the package that crosses the boundary", () => {
    const view = stageRunView("DISCOVER", run(discoverFanOut));
    expect(view!.input).toMatchObject({
      stage: "REQUIREMENT",
      number: 1,
      title: "Requirement",
      slug: "requirement",
      artifact: "requirement package",
    });
    expect(view!.input!.nodes).toEqual([{ nodeKey: "requirement", status: "passed" }]);
    expect(view!.output).toMatchObject({ stage: "EVALUATE", number: 3 });
    // EVALUATE has no node in this run, so the handoff exists and is empty —
    // which is a different statement from there being no next stage.
    expect(view!.output!.nodes).toEqual([]);
  });

  it("has no input at the first stage and no output at the last", () => {
    const first = stageRunView("REQUIREMENT", run(discoverFanOut));
    expect(first!.input).toBeNull();
    expect(first!.output).not.toBeNull();

    const last = stageRunView("MONITOR", run([
      node({ node_key: "monitor", state: "COMPLETED", lifecycle_stage: "MONITOR", anchor_count: 1 }),
    ]));
    expect(last!.output).toBeNull();
    expect(last!.status).toBe("Complete");
  });

  it("keeps every edge that touches the stage, in either direction", () => {
    const withEdges = run(discoverFanOut, {
      edges: [
        { from_node_key: "requirement", to_node_key: "discover_internal", reason: "DATA", detail: "d", is_feedback: false },
        { from_node_key: "evaluate_matrix", to_node_key: "discover_shortlist", reason: "POLICY", detail: "back", is_feedback: true },
        { from_node_key: "review", to_node_key: "test", reason: "VERIFICATION", detail: "elsewhere", is_feedback: false },
      ],
    });
    const view = stageRunView("DISCOVER", withEdges);
    expect(view!.dependencies.map((edge) => edge.to_node_key))
      .toEqual(["discover_internal", "discover_shortlist"]);
  });

  it("collapses to the latest attempt while saying how many there were", () => {
    const view = stageRunView("BUILD", run([
      node({
        node_key: "build_server",
        state: "COMPLETED",
        lifecycle_stage: "BUILD",
        attempt: 2,
        attempts: 3,
        max_attempts: 4,
      }),
    ]));
    expect(view!.nodes[0]).toMatchObject({ attempt: 2, attempts: 3, maxAttempts: 4 });
  });

  it("does not fall over on a stage whose nodes depend on each other in a cycle", () => {
    // Impossible through the compiler, which rejects cycles. Reachable through
    // rows a future template could write, and stopping beats recursing forever.
    const view = stageRunView("BUILD", run([
      node({ node_key: "a", state: "PENDING", lifecycle_stage: "BUILD", depends_on: ["b"] }),
      node({ node_key: "b", state: "PENDING", lifecycle_stage: "BUILD", depends_on: ["a"] }),
    ]));
    expect(view!.nodes).toHaveLength(2);
    expect(view!.parallelism).toBeGreaterThan(0);
  });
});

describe("the stage page", () => {
  it("is Not Started when no run has reached the stage", () => {
    const view = stagePageView("DEPLOY", [run(discoverFanOut)]);
    expect(view.current).toBeNull();
    expect(view.earlier).toEqual([]);
    expect(view.status).toBe("Not Started");
    expect(view.definition.title).toBe("Deploy");
  });

  it("takes the newest run that includes the stage, and keeps the rest as history", () => {
    const older = run(discoverFanOut, { graphRunId: "run-0", goal: "An earlier goal." });
    const unrelated = run(
      [node({ node_key: "authn", state: "COMPLETED" })],
      { graphRunId: "run-audit", goal: "A security audit." },
    );
    const newest = run(discoverFanOut, { graphRunId: "run-2", goal: "The newest goal." });

    const view = stagePageView("DISCOVER", [newest, unrelated, older]);
    expect(view.current!.graphRunId).toBe("run-2");
    // The audit run planned no stages at all, so it is not history for this
    // stage — it is silence, and listing it would imply it tried and stopped.
    expect(view.earlier.map((entry) => entry.graphRunId)).toEqual(["run-0"]);
  });

  it("gives every stage a status in one pass, agreeing with the page", () => {
    const statuses = lifecycleStatuses([run(discoverFanOut)]);
    expect(statuses.REQUIREMENT).toBe("Passed");
    expect(statuses.DISCOVER).toBe("Running");
    expect(statuses.EVALUATE).toBe("Not Started");
    expect(statuses.MONITOR).toBe("Not Started");
    expect(statuses.DISCOVER).toBe(stagePageView("DISCOVER", [run(discoverFanOut)]).status);
  });

  it("survives a projection with none of the fields the widening added", () => {
    // A browser can be holding this page while the hosted database still has
    // the narrower list_graph_runs. Missing keys must render a stage, not blank
    // the view.
    const legacy = run([
      { node_key: "build_server", state: "RUNNING", lifecycle_stage: "BUILD" },
    ], { edges: undefined, artifactCounts: undefined });
    const view = stagePageView("BUILD", [legacy]);
    expect(view.status).toBe("Running");
    expect(view.current!.nodes[0]).toMatchObject({
      dependsOn: [],
      anchorCount: 0,
      artifactCount: 0,
      attempts: 1,
    });
    expect(view.current!.dependencies).toEqual([]);
  });
});
