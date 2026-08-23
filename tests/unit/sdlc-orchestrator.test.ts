// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { GateState, NodeDisplayStatus, SdlcStage } from "@/lib/sdlc/lifecycle";
import {
  acceptanceReport,
  decideNextAction,
  repairTargets,
  type OrchestratorNode,
  type OrchestratorState,
} from "@/lib/sdlc/orchestrator";

/**
 * The orchestrator decides what a lifecycle does next, and it is the only place
 * the rule "generated output is not a completed task" is actually enforced
 * rather than asserted. It had no test.
 *
 * Three of the cases below are regressions for bugs the ten-stage template
 * exposed, and all three had the same shape: a rule written per node when the
 * thing it describes belongs to a stage. Each made acceptance *unreachable*,
 * which is the worst way for this function to be wrong — "not met" is also what
 * an in-progress run looks like, so nothing would have looked broken.
 */

function node(
  nodeKey: string,
  stage: SdlcStage | null,
  status: NodeDisplayStatus,
  extra: Partial<OrchestratorNode> = {},
): OrchestratorNode {
  return { nodeKey, stage, status, gate: null, ...extra };
}

function gate(state: GateState, kind: "AUTOMATIC" | "HUMAN" = "AUTOMATIC", anchorCount = 0) {
  return { id: `gate-${state}-${kind}`, kind, state, anchorCount };
}

/** A lifecycle that has finished honestly: every stage terminal, evidenced and decided. */
function completedLifecycle(): OrchestratorState {
  return {
    isLifecycle: true,
    iteration: 1,
    maxIterations: 3,
    nodes: [
      node("requirement", "REQUIREMENT", "passed", { gate: gate("APPROVED") }),
      node("discover_internal", "DISCOVER", "passed", { anchorCount: 3 }),
      node("discover_packages", "DISCOVER", "passed", { anchorCount: 4 }),
      node("discover_shortlist", "DISCOVER", "passed"),
      node("evaluate_fit", "EVALUATE", "passed"),
      node("evaluate_matrix", "EVALUATE", "passed", { gate: gate("APPROVED") }),
      node("decide", "DECIDE", "passed", { gate: gate("APPROVED") }),
      node("architect", "ARCHITECT", "passed", { gate: gate("APPROVED", "HUMAN") }),
      node("build_server", "BUILD", "passed"),
      node("build_integrate", "BUILD", "passed"),
      node("review", "REVIEW", "passed", { gate: gate("APPROVED") }),
      node("security_review", "REVIEW", "passed"),
      node("test", "TEST", "passed", { gate: gate("APPROVED", "AUTOMATIC", 1), anchorCount: 1 }),
      node("deploy", "DEPLOY", "deployed", { gate: gate("APPROVED", "HUMAN", 1), anchorCount: 1 }),
      node("monitor", "MONITOR", "passed", { anchorCount: 2 }),
    ],
  };
}

describe("acceptance", () => {
  it("is met by a lifecycle that finished, evidenced and decided every stage", () => {
    const report = acceptanceReport(completedLifecycle());
    expect(report.unmet).toEqual([]);
    expect(report.met).toBe(true);
    expect(report.satisfied.map((entry) => entry.stage)).toEqual([
      "REQUIREMENT", "DISCOVER", "EVALUATE", "DECIDE", "ARCHITECT",
      "BUILD", "REVIEW", "TEST", "DEPLOY", "MONITOR",
    ]);
    expect(report.satisfied.find((entry) => entry.stage === "DISCOVER")?.anchorCount).toBe(7);
  });

  it("counts a stage's evidence across the stage, not node by node", () => {
    // REGRESSION. DISCOVER fans out to three observers and then reduces them;
    // the reducer observes nothing itself. Asked per node, the reducer fails an
    // evidence rule it structurally cannot satisfy, and the only lifecycle that
    // could ever pass would be one with no parallelism in an anchored stage.
    const state = completedLifecycle();
    const report = acceptanceReport(state);
    expect(report.unmet).toEqual([]);

    const withoutAnyEvidence: OrchestratorState = {
      ...state,
      nodes: state.nodes.map((entry) =>
        entry.stage === "DISCOVER" ? { ...entry, anchorCount: 0 } : entry,
      ),
    };
    expect(acceptanceReport(withoutAnyEvidence).unmet).toEqual([
      "DISCOVER requires anchored evidence and none of its 3 node(s) recorded any, "
      + "so its claim is unverified.",
    ]);
  });

  it("does not demand a gate from a node the template never gated", () => {
    // REGRESSION. REVIEW gates `review` and lets `security_review` run beside
    // it. Asked per node, the ungated sibling reported a gate that "was never
    // opened" and no shipped lifecycle could reach acceptance.
    const state = completedLifecycle();
    expect(state.nodes.find((entry) => entry.nodeKey === "security_review")?.gate).toBeNull();
    expect(acceptanceReport(state).met).toBe(true);
  });

  it("counts anchors on a stage that has no gate to carry them", () => {
    // REGRESSION. MONITOR requires evidence and has no gate at all. While
    // anchors were read off the gate, its count was structurally zero.
    const monitorOnly: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("monitor", "MONITOR", "passed", { anchorCount: 2 })],
    };
    const report = acceptanceReport(monitorOnly);
    expect(report.met).toBe(true);
    expect(report.satisfied).toEqual([{ stage: "MONITOR", anchorCount: 2 }]);
  });

  it("still reads a gate's own anchor count when the caller measured nothing else", () => {
    const viaGate: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("test", "TEST", "passed", { gate: gate("APPROVED", "AUTOMATIC", 5) })],
    };
    expect(acceptanceReport(viaGate).satisfied).toEqual([{ stage: "TEST", anchorCount: 5 }]);
  });

  it("refuses a run whose evidence stage produced nothing but assurance", () => {
    const unevidenced: OrchestratorState = {
      ...completedLifecycle(),
      nodes: completedLifecycle().nodes.map((entry) =>
        entry.stage === "TEST" ? { ...entry, anchorCount: 0, gate: gate("APPROVED") } : entry,
      ),
    };
    const report = acceptanceReport(unevidenced);
    expect(report.met).toBe(false);
    expect(report.unmet.join(" ")).toContain("TEST requires anchored evidence");
  });

  it("names every unfinished node rather than reporting a count", () => {
    const midRun: OrchestratorState = {
      ...completedLifecycle(),
      nodes: [node("build_server", "BUILD", "running"), node("review", "REVIEW", "queued")],
    };
    const report = acceptanceReport(midRun);
    expect(report.met).toBe(false);
    expect(report.unmet).toContain("build_server is running.");
    expect(report.unmet).toContain("review is queued.");
  });

  it("says which of waiting, rejected and never-opened a gate is in", () => {
    const base = { isLifecycle: true, iteration: 1, maxIterations: 3 };
    expect(acceptanceReport({ ...base, nodes: [node("decide", "DECIDE", "passed")] }).unmet)
      .toContain("DECIDE has a automatic gate that was never opened.");
    expect(acceptanceReport({
      ...base,
      nodes: [node("decide", "DECIDE", "review", { gate: gate("OPEN") })],
    }).unmet).toContain("DECIDE is waiting at its gate.");
    expect(acceptanceReport({
      ...base,
      nodes: [node("decide", "DECIDE", "failed", { gate: gate("REJECTED") })],
    }).unmet).toContain("DECIDE was rejected at its gate.");
  });

  it("ignores nodes belonging to no stage, which is most graphs", () => {
    const audit: OrchestratorState = {
      isLifecycle: false,
      iteration: 1,
      maxIterations: 1,
      nodes: [node("authn", null, "passed"), node("reduce", null, "passed")],
    };
    expect(acceptanceReport(audit)).toEqual({ met: true, satisfied: [], unmet: [] });
  });
});

describe("repair targets", () => {
  it("sends a rejection to where the mistake was made, not where it was found", () => {
    const state: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("architect", "ARCHITECT", "failed", { gate: gate("REJECTED", "HUMAN") })],
    };
    expect(repairTargets(state)).toEqual([{
      nodeKey: "architect",
      stage: "ARCHITECT",
      // Not BUILD: re-implementing a rejected design reproduces it at full price.
      returnsTo: "DECIDE",
      why: "ARCHITECT was rejected at its gate.",
    }]);
  });

  it("returns a failed evaluation to discovery rather than re-scoring the same shortlist", () => {
    const state: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("evaluate_matrix", "EVALUATE", "failed")],
    };
    expect(repairTargets(state)[0]).toMatchObject({ returnsTo: "DISCOVER", why: "evaluate_matrix failed." });
  });

  it("does not retry a node blocked for want of evidence in place", () => {
    const state: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("test", "TEST", "blocked")],
    };
    expect(repairTargets(state)[0]).toMatchObject({
      returnsTo: "TEST",
      why: "TEST is blocked for want of anchored evidence, which no retry of the node will supply.",
    });
  });

  it("leaves a blocked node alone when its stage needs no evidence", () => {
    const state: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("build_server", "BUILD", "blocked"), node("reduce", null, "failed")],
    };
    expect(repairTargets(state)).toEqual([]);
  });
});

describe("the next action", () => {
  it("waits for a person before anything else, because otherwise it never really asked", () => {
    const state = completedLifecycle();
    const waiting: OrchestratorState = {
      ...state,
      nodes: state.nodes.map((entry) =>
        entry.nodeKey === "architect"
          ? { ...entry, status: "review", gate: gate("OPEN", "HUMAN") }
          : entry,
      ),
    };
    const decision = decideNextAction(waiting);
    expect(decision.action).toBe("AWAIT_HUMAN_GATE");
    expect(decision.detail).toBe("ARCHITECT is waiting on an owner or admin decision.");
    expect(decision.awaitingGates).toHaveLength(1);
  });

  it("counts the human gates when more than one stage is waiting", () => {
    const state = completedLifecycle();
    const waiting: OrchestratorState = {
      ...state,
      nodes: state.nodes.map((entry) =>
        entry.stage === "ARCHITECT" || entry.stage === "DEPLOY"
          ? { ...entry, status: "review", gate: gate("OPEN", "HUMAN") }
          : entry,
      ),
    };
    expect(decideNextAction(waiting).detail)
      .toBe("2 stages are waiting on an owner or admin decision.");
  });

  it("decides the automatic gates once no person is being waited on", () => {
    const state = completedLifecycle();
    const waiting: OrchestratorState = {
      ...state,
      nodes: state.nodes.map((entry) =>
        entry.nodeKey === "test" ? { ...entry, status: "review", gate: gate("OPEN") } : entry,
      ),
    };
    expect(decideNextAction(waiting).action).toBe("DECIDE_AUTOMATIC_GATE");
  });

  it("repairs before it iterates, because iterating past a failure reproduces it", () => {
    const state: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("review", "REVIEW", "failed", { gate: gate("REJECTED") })],
    };
    const decision = decideNextAction(state);
    expect(decision.action).toBe("REPAIR");
    expect(decision.detail).toContain("Returns to BUILD.");
  });

  it("completes only when acceptance is met", () => {
    const decision = decideNextAction(completedLifecycle());
    expect(decision.action).toBe("COMPLETE");
    expect(decision.detail).toContain("10 recorded");
  });

  it("advances while there is ready work", () => {
    const state: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("build_server", "BUILD", "running"), node("build_client", "BUILD", "queued")],
    };
    expect(decideNextAction(state).action).toBe("ADVANCE");
  });

  it("halts a stuck graph that has no lifecycle to iterate", () => {
    const state: OrchestratorState = {
      isLifecycle: false,
      iteration: 1,
      maxIterations: 1,
      nodes: [node("authn", null, "skipped"), node("reduce", null, "skipped")],
    };
    // Everything terminal and acceptance vacuously met is COMPLETE; make one
    // node non-terminal in a way nothing can start from.
    expect(decideNextAction({ ...state, nodes: [node("authn", null, "review")] }).action)
      .toBe("HALTED");
  });

  it("stops rather than looping once the iteration budget is spent", () => {
    const state: OrchestratorState = {
      isLifecycle: true,
      iteration: 3,
      maxIterations: 3,
      nodes: [node("monitor", "MONITOR", "review")],
    };
    const decision = decideNextAction(state);
    expect(decision.action).toBe("EXHAUSTED");
    expect(decision.detail).toContain("all 3 iterations");
  });

  it("iterates while the budget still allows another pass", () => {
    const state: OrchestratorState = {
      isLifecycle: true,
      iteration: 1,
      maxIterations: 3,
      nodes: [node("monitor", "MONITOR", "review")],
    };
    const decision = decideNextAction(state);
    expect(decision.action).toBe("ITERATE");
    expect(decision.detail).toContain("Iteration 1 of 3");
  });
});
