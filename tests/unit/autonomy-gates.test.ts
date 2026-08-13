import { describe, expect, it } from "vitest";

import {
  ENHANCED_GATES,
  GREEN_GATES,
  describeGateBlockers,
  evaluateGates,
  requiredGates,
  type Gate,
  type GateResult,
} from "@/lib/autonomy/gates";

const passing = (gates: readonly Gate[]): GateResult[] =>
  gates.map((gate) => ({ gate, outcome: "passed" as const }));

describe("requiredGates", () => {
  it("requires the base set at GREEN", () => {
    expect(requiredGates("GREEN")).toEqual(GREEN_GATES);
  });

  it("adds to the base set rather than replacing it at YELLOW and RED", () => {
    for (const risk of ["YELLOW", "RED"] as const) {
      const required = requiredGates(risk);
      for (const gate of GREEN_GATES) expect(required).toContain(gate);
      for (const gate of ENHANCED_GATES) expect(required).toContain(gate);
    }
  });

  it("never requires fewer gates as risk rises", () => {
    expect(requiredGates("YELLOW").length).toBeGreaterThan(requiredGates("GREEN").length);
    expect(requiredGates("RED").length).toBeGreaterThanOrEqual(requiredGates("YELLOW").length);
  });
});

describe("evaluateGates", () => {
  it("is satisfied when every required gate passed", () => {
    const evaluation = evaluateGates("GREEN", passing(GREEN_GATES));

    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.blockers).toEqual([]);
    expect(evaluation.passed).toEqual(GREEN_GATES);
  });

  it("treats a missing result as a blocker, never as a pass", () => {
    const evaluation = evaluateGates("GREEN", passing(GREEN_GATES.slice(0, 3)));

    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.blockers.map((b) => b.gate)).toEqual(GREEN_GATES.slice(3));
    for (const blocker of evaluation.blockers) expect(blocker.kind).toBe("NOT_RUN");
  });

  it("keeps not_connected distinct from not_run", () => {
    const evaluation = evaluateGates("GREEN", [
      ...passing(GREEN_GATES.filter((gate) => gate !== "preview_smoke")),
      { gate: "preview_smoke", outcome: "not_connected", detail: "No Vercel connection." },
    ]);

    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.blockers).toHaveLength(1);
    expect(evaluation.blockers[0].kind).toBe("NOT_CONNECTED");
    expect(evaluation.blockers[0].detail).toBe("No Vercel connection.");
  });

  it("blocks on a failure and carries its detail through", () => {
    const evaluation = evaluateGates("GREEN", [
      ...passing(GREEN_GATES.filter((gate) => gate !== "tests")),
      { gate: "tests", outcome: "failed", detail: "3 tests failed." },
    ]);

    expect(evaluation.blockers[0]).toMatchObject({
      gate: "tests",
      kind: "FAILED",
      detail: "3 tests failed.",
    });
  });

  it("requires the enhanced gates once the change is not GREEN", () => {
    const greenOnly = passing(GREEN_GATES);

    expect(evaluateGates("GREEN", greenOnly).satisfied).toBe(true);
    expect(evaluateGates("YELLOW", greenOnly).satisfied).toBe(false);
    expect(evaluateGates("YELLOW", greenOnly).blockers.map((b) => b.gate)).toEqual(ENHANCED_GATES);
  });

  it("is satisfied at YELLOW when the full set passed", () => {
    const evaluation = evaluateGates("YELLOW", passing([...GREEN_GATES, ...ENHANCED_GATES]));
    expect(evaluation.satisfied).toBe(true);
  });

  it("ignores results for gates that are not required at this level", () => {
    const evaluation = evaluateGates("GREEN", [
      ...passing(GREEN_GATES),
      { gate: "e2e", outcome: "failed", detail: "irrelevant here" },
    ]);

    // Running extra verification must never block a change that does not need it.
    expect(evaluation.satisfied).toBe(true);
  });

  it("uses the last result when a gate is reported more than once", () => {
    const evaluation = evaluateGates("GREEN", [
      ...passing(GREEN_GATES),
      { gate: "tests", outcome: "failed", detail: "a later re-run failed" },
    ]);

    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.blockers[0].detail).toBe("a later re-run failed");
  });
});

describe("describeGateBlockers", () => {
  it("renders one readable line per blocker", () => {
    const evaluation = evaluateGates("GREEN", [
      ...passing(GREEN_GATES.filter((gate) => gate !== "build")),
      { gate: "build", outcome: "failed", detail: "reported a failure" },
    ]);

    expect(describeGateBlockers(evaluation)).toEqual(["Production build reported a failure"]);
  });

  it("is empty when nothing is blocking", () => {
    expect(describeGateBlockers(evaluateGates("GREEN", passing(GREEN_GATES)))).toEqual([]);
  });
});
