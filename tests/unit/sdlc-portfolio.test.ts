import { describe, expect, it } from "vitest";

import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";
import { buildStagePortfolio, type SummarisableRun } from "@/lib/sdlc/portfolio";

/**
 * The cross-run rollup. The interesting cases are the ones where a plausible
 * shortcut would mislead: a stage that never ran reported as never failing, a
 * run counted against a stage it never reached, and an unstaged run inflating
 * the denominator of every rate on the page.
 */

function run(id: string, nodes: Array<Record<string, unknown>>): SummarisableRun {
  return {
    graphRunId: id,
    nodes: nodes.map((node, index) => ({
      node_key: `${id}-${index}`,
      state: "COMPLETED",
      ...node,
    })) as SummarisableRun["nodes"],
  };
}

describe("buildStagePortfolio", () => {
  it("names every defined stage even with no runs at all", () => {
    const portfolio = buildStagePortfolio([]);
    // Derived from the vocabulary, so a stage added to it — as DISCOVERY,
    // EVALUATION and DECISION were — appears here without editing this test.
    expect(portfolio.entries.map((entry) => entry.stage)).toEqual([...SDLC_STAGES]);
    expect(portfolio.entries.length).toBe(SDLC_STAGES.length);
    expect(portfolio.runsConsidered).toBe(0);
    expect(portfolio.weakestStage).toBeNull();
  });

  it("separates 'never ran' from 'never failed'", () => {
    const portfolio = buildStagePortfolio([
      run("r1", [{ lifecycle_stage: "GOAL" }]),
    ]);
    const goal = portfolio.entries.find((entry) => entry.stage === "GOAL");
    const deployment = portfolio.entries.find((entry) => entry.stage === "DEPLOYMENT");
    // GOAL ran and never failed: a real 0%.
    expect(goal?.failureRatePercent).toBe(0);
    // DEPLOYMENT never ran: null, because 0% would claim a clean record it
    // has not earned.
    expect(deployment?.failureRatePercent).toBeNull();
    expect(deployment?.runsTouched).toBe(0);
  });

  it("counts a run against a stage only when it reached that stage", () => {
    const portfolio = buildStagePortfolio([
      run("r1", [{ lifecycle_stage: "GOAL" }, { lifecycle_stage: "PRD" }]),
      run("r2", [{ lifecycle_stage: "GOAL" }]),
    ]);
    expect(portfolio.entries.find((entry) => entry.stage === "GOAL")?.runsTouched).toBe(2);
    expect(portfolio.entries.find((entry) => entry.stage === "PRD")?.runsTouched).toBe(1);
  });

  it("finds the stage failing in the most runs", () => {
    const portfolio = buildStagePortfolio([
      run("r1", [{ lifecycle_stage: "TEST", state: "FAILED", error_message: "flaky" }]),
      run("r2", [{ lifecycle_stage: "TEST", state: "FAILED", error_message: "timeout" }]),
      run("r3", [{ lifecycle_stage: "REVIEW", state: "FAILED", error_message: "rejected" }]),
    ]);
    expect(portfolio.weakestStage).toBe("TEST");
    const test = portfolio.entries.find((entry) => entry.stage === "TEST");
    expect(test?.runsFailed).toBe(2);
    expect(test?.failureRatePercent).toBe(100);
  });

  it("keeps a run with no staged node out of every stage's denominator", () => {
    // Otherwise a pre-stage-rule run would drag every rate on the page down
    // while contributing nothing a reader could act on.
    const portfolio = buildStagePortfolio([
      run("old", [{ lifecycle_stage: null }, { lifecycle_stage: null }]),
      run("new", [{ lifecycle_stage: "BUILD_ISH" }]),
      run("real", [{ lifecycle_stage: "TEST", state: "FAILED", error_message: "x" }]),
    ]);
    expect(portfolio.runsUnstaged).toBe(2);
    expect(portfolio.runsConsidered).toBe(3);
    expect(portfolio.entries.find((entry) => entry.stage === "TEST")?.runsTouched).toBe(1);
    expect(portfolio.entries.find((entry) => entry.stage === "TEST")?.failureRatePercent).toBe(100);
  });

  it("counts a stage still working separately from one that failed", () => {
    const portfolio = buildStagePortfolio([
      run("r1", [{ lifecycle_stage: "ARCHITECTURE", state: "VERIFYING" }]),
    ]);
    const architecture = portfolio.entries.find((entry) => entry.stage === "ARCHITECTURE");
    expect(architecture?.runsActive).toBe(1);
    expect(architecture?.runsFailed).toBe(0);
    expect(architecture?.runsComplete).toBe(0);
  });

  it("reports the latest error, taking runs in the order given", () => {
    // The API returns newest-first, so the first error encountered is the
    // most recent one — which is the one worth showing.
    const portfolio = buildStagePortfolio([
      run("newest", [{ lifecycle_stage: "TEST", state: "FAILED", error_message: "newest" }]),
      run("older", [{ lifecycle_stage: "TEST", state: "FAILED", error_message: "older" }]),
    ]);
    expect(portfolio.entries.find((entry) => entry.stage === "TEST")?.latestError).toBe("newest");
  });
});
