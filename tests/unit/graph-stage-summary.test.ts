import { describe, expect, it } from "vitest";

import { summariseRunStages } from "@/lib/graph/stage-summary";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

const node = (lifecycle_stage: string | null, state: string) => ({ lifecycle_stage, state });

describe("summarising a run by stage", () => {
  it("counts each state against the stage its node sits in", () => {
    const { stages } = summariseRunStages([
      node("REVIEW", "COMPLETED"),
      node("REVIEW", "COMPLETED"),
      node("REVIEW", "FAILED"),
      node("REVIEW", "SKIPPED"),
      node("TEST", "RUNNING"),
    ]);

    expect(stages).toEqual([
      { stage: "REVIEW", total: 4, completed: 2, failed: 1, active: 0, skipped: 1 },
      { stage: "TEST", total: 1, completed: 0, failed: 0, active: 1, skipped: 0 },
    ]);
  });

  it("returns stages in lifecycle order, not the order nodes arrived", () => {
    // The panel reads this straight out; sorting at the render site would be a
    // second place the lifecycle's order is written down.
    const { stages } = summariseRunStages([
      node("MONITORING", "COMPLETED"),
      node("GOAL", "COMPLETED"),
      node("TEST", "COMPLETED"),
    ]);

    expect(stages.map((entry) => entry.stage)).toEqual(["GOAL", "TEST", "MONITORING"]);
  });

  it("omits a stage the run never contained rather than zeroing it", () => {
    /*
     * An audit graph is REVIEW work and nothing else. A row reading
     * "DEPLOYMENT 0/0" would invent a stage the graph was never going to enter,
     * which is the fake-progress the goal forbids.
     */
    const { stages } = summariseRunStages([node("REVIEW", "COMPLETED")]);

    expect(stages).toHaveLength(1);
    expect(stages.map((entry) => entry.stage)).not.toContain("DEPLOYMENT");
  });

  it("counts a node with no stage rather than dropping it", () => {
    // `lifecycle_stage` is nullable and the column is text: a row can predate
    // the vocabulary. Saying how many is honest; silently omitting them makes
    // the totals lie.
    const { stages, unstaged } = summariseRunStages([
      node("REVIEW", "COMPLETED"),
      node(null, "COMPLETED"),
      node("NOT_A_STAGE", "COMPLETED"),
    ]);

    expect(unstaged).toBe(2);
    expect(stages).toEqual([
      { stage: "REVIEW", total: 1, completed: 1, failed: 0, active: 0, skipped: 0 },
    ]);
  });

  it("says nothing about an empty run", () => {
    expect(summariseRunStages([])).toEqual({ stages: [], unstaged: 0 });
  });

  it("knows every stage the lifecycle defines", () => {
    // A stage added to SDLC_STAGES that this cannot bucket would be counted as
    // unstaged — visible as a shortfall rather than as the new stage.
    const { stages, unstaged } = summariseRunStages(
      SDLC_STAGES.map((stage) => node(stage, "COMPLETED")),
    );

    expect(unstaged).toBe(0);
    expect(stages.map((entry) => entry.stage)).toEqual([...SDLC_STAGES]);
  });
});
