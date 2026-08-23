import { describe, expect, it } from "vitest";

import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";
import { summariseRunByStage, type SummarisableNode } from "@/lib/sdlc/run-summary";

/**
 * The rollup's arithmetic, on the cases where a wrong answer would look
 * plausible: a stage reading complete while a node is still running, a
 * failure hidden behind a majority of successes, an open gate reported as
 * merely busy, and a stage value the application does not define.
 */

function node(overrides: Partial<SummarisableNode> = {}): SummarisableNode {
  return {
    node_key: overrides.node_key ?? Math.random().toString(36).slice(2),
    state: "SUCCEEDED",
    lifecycle_stage: "IMPLEMENTATION",
    ...overrides,
  };
}

describe("summariseRunByStage", () => {
  it("names every stage even when a run touched none of them", () => {
    const summary = summariseRunByStage([]);
    expect(summary.stages.map((entry) => entry.stage)).toEqual([...SDLC_STAGES]);
    expect(summary.stages.every((entry) => entry.status === "NOT_STARTED")).toBe(true);
    expect(summary.currentStage).toBeNull();
    expect(summary.stagesWithWork).toBe(0);
  });

  it("does not call a stage complete while one of its nodes is still running", () => {
    const summary = summariseRunByStage([
      node({ state: "SUCCEEDED" }),
      node({ state: "SUCCEEDED" }),
      node({ state: "RUNNING" }),
    ]);
    const implementation = summary.stages.find((entry) => entry.stage === "IMPLEMENTATION");
    expect(implementation?.status).toBe("RUNNING");
    expect(implementation?.succeeded).toBe(2);
  });

  it("lets one failure outrank a majority of successes", () => {
    // A stage that is four-fifths green is still a stage someone has to fix.
    const summary = summariseRunByStage([
      node({ state: "SUCCEEDED" }), node({ state: "SUCCEEDED" }),
      node({ state: "SUCCEEDED" }), node({ state: "SUCCEEDED" }),
      node({ state: "FAILED", error_message: "type check failed" }),
    ]);
    const implementation = summary.stages.find((entry) => entry.stage === "IMPLEMENTATION");
    expect(implementation?.status).toBe("FAILED");
    expect(implementation?.firstError).toBe("type check failed");
  });

  it("reports an open gate as waiting on a person, not as running", () => {
    const summary = summariseRunByStage([
      node({ stage: "ARCHITECTURE" } as Partial<SummarisableNode>),
      node({ lifecycle_stage: "ARCHITECTURE", state: "VERIFYING", gate_state: "OPEN" }),
    ]);
    const architecture = summary.stages.find((entry) => entry.stage === "ARCHITECTURE");
    expect(architecture?.status).toBe("AWAITING_DECISION");
    expect(architecture?.awaitingDecision).toBe(1);
  });

  it("points at the earliest stage needing attention, not the latest activity", () => {
    const summary = summariseRunByStage([
      node({ lifecycle_stage: "ARCHITECTURE", state: "FAILED", error_message: "x" }),
      node({ lifecycle_stage: "TEST", state: "RUNNING" }),
    ]);
    // ARCHITECTURE comes first in the lifecycle, and it is the one that is stuck.
    expect(summary.currentStage).toBe("ARCHITECTURE");
  });

  it("counts a node with no stage rather than dropping it", () => {
    const summary = summariseRunByStage([
      node({ lifecycle_stage: null }),
      node({ lifecycle_stage: undefined }),
      node({ lifecycle_stage: "IMPLEMENTATION" }),
    ]);
    // Graphs that predate the stage rule are a fact about the data, and a
    // rollup that silently omitted them would under-report the run.
    expect(summary.unstagedCount).toBe(2);
    expect(summary.stagesWithWork).toBe(1);
  });

  it("treats a stage value the application does not define as unstaged", () => {
    // The goal document names DISCOVER; the enum does not hold it. If one ever
    // arrives from an older or newer deployment it must not vanish.
    const summary = summariseRunByStage([node({ lifecycle_stage: "DISCOVER" })]);
    expect(summary.unstagedCount).toBe(1);
    expect(summary.stagesWithWork).toBe(0);
  });

  it("sums latency only where it was measured", () => {
    const summary = summariseRunByStage([
      node({ latency_ms: 1_500 }),
      node({ latency_ms: 2_500 }),
      node({ latency_ms: null }),
    ]);
    const implementation = summary.stages.find((entry) => entry.stage === "IMPLEMENTATION");
    expect(implementation?.elapsedMs).toBe(4_000);
    // A stage nothing ran in reports null rather than a confident zero.
    expect(summary.stages.find((entry) => entry.stage === "TEST")?.elapsedMs).toBeNull();
  });

  it("counts completed stages over the eight, not over the ones that ran", () => {
    const summary = summariseRunByStage([
      node({ lifecycle_stage: "GOAL" }),
      node({ lifecycle_stage: "PRD" }),
    ]);
    expect(summary.completedStages).toBe(2);
    expect(summary.stages).toHaveLength(8);
  });
});
