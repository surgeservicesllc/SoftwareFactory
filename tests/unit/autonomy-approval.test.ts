import { describe, expect, it } from "vitest";

import { runReviewAgents, type AgentReviewResult } from "@/lib/autonomy/agents";
import { evaluateApproval, type ApprovalRequest } from "@/lib/autonomy/approval";
import {
  AUTOMATIC_ACTIONS,
  resolveEffectiveControls,
  type AutonomyControls,
} from "@/lib/autonomy/controls";
import { assessDiffRisk } from "@/lib/autonomy/diff-risk";
import { GREEN_GATES, evaluateGates, type GateResult } from "@/lib/autonomy/gates";

const allOn: AutonomyControls = {
  autonomousMode: true,
  maximumAutonomousRisk: "YELLOW",
  actions: Object.fromEntries(AUTOMATIC_ACTIONS.map((a) => [a, true])) as AutonomyControls["actions"],
};

const permissive = resolveEffectiveControls(allOn, allOn, {
  killSwitchActive: false,
  emergencyStopActive: false,
  releaseFrozen: false,
  executorConnected: true,
});

const passingGates: GateResult[] = GREEN_GATES.map((gate) => ({ gate, outcome: "passed" as const }));

const clearAgents: AgentReviewResult = runReviewAgents({
  files: [{ path: "components/thing.tsx" }, { path: "tests/unit/thing.test.tsx" }],
  assessment: assessDiffRisk([{ path: "components/thing.tsx" }]),
  gateResults: passingGates,
});

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    action: "merge",
    risk: "GREEN",
    controls: permissive,
    gates: evaluateGates("GREEN", passingGates),
    agents: clearAgents,
    authorId: "author-1",
    approverId: "reviewer-2",
    ...overrides,
  };
}

describe("the happy path", () => {
  it("approves automatically when every condition holds", () => {
    const result = evaluateApproval(request());

    expect(result.decision).toBe("APPROVED_AUTOMATICALLY");
    expect(result.blockers).toEqual([]);
    expect(result.ownerApprovalRequired).toBe(false);
  });

  it("approves with no approver at all when none is required", () => {
    expect(evaluateApproval(request({ approverId: null })).decision).toBe("APPROVED_AUTOMATICALLY");
  });
});

describe("no self-approval", () => {
  it("refuses when the author is the approver", () => {
    const result = evaluateApproval(request({ approverId: "author-1" }));

    expect(result.decision).toBe("OWNER_APPROVAL_REQUIRED");
    expect(result.blockers).toContain("SELF_APPROVAL_REFUSED");
  });

  it("applies at RED too — being the owner does not exempt the author", () => {
    const result = evaluateApproval(
      request({
        risk: "RED",
        controls: resolveEffectiveControls(
          { ...allOn, maximumAutonomousRisk: "RED" },
          { ...allOn, maximumAutonomousRisk: "RED" },
          { killSwitchActive: false, emergencyStopActive: false, releaseFrozen: false, executorConnected: true },
        ),
        gates: evaluateGates("RED", [
          ...passingGates,
          { gate: "security_review", outcome: "passed" },
          { gate: "migration_review", outcome: "passed" },
          { gate: "e2e", outcome: "passed" },
          { gate: "rollback_validated", outcome: "passed" },
        ]),
        approverId: "author-1",
        ownerApproval: "APPROVED",
      }),
    );

    expect(result.decision).toBe("OWNER_APPROVAL_REQUIRED");
    expect(result.blockers).toContain("SELF_APPROVAL_REFUSED");
  });
});

describe("owner approval", () => {
  const redControls = resolveEffectiveControls(
    { ...allOn, maximumAutonomousRisk: "RED" },
    { ...allOn, maximumAutonomousRisk: "RED" },
    { killSwitchActive: false, emergencyStopActive: false, releaseFrozen: false, executorConnected: true },
  );
  const redGates = evaluateGates("RED", [
    ...passingGates,
    { gate: "security_review", outcome: "passed" as const },
    { gate: "migration_review", outcome: "passed" as const },
    { gate: "e2e", outcome: "passed" as const },
    { gate: "rollback_validated", outcome: "passed" as const },
  ]);

  it("requires an owner for RED even when everything else passed", () => {
    const result = evaluateApproval(
      request({ risk: "RED", controls: redControls, gates: redGates }),
    );

    expect(result.decision).toBe("OWNER_APPROVAL_REQUIRED");
    expect(result.ownerApprovalRequired).toBe(true);
  });

  it("approves RED once a different owner has approved", () => {
    const result = evaluateApproval(
      request({
        risk: "RED",
        controls: redControls,
        gates: redGates,
        ownerApproval: "APPROVED",
        approverId: "owner-9",
      }),
    );

    expect(result.decision).toBe("APPROVED_AUTOMATICALLY");
  });

  it("treats a rejection as a decision, not a missing one", () => {
    const result = evaluateApproval(
      request({
        risk: "RED",
        controls: redControls,
        gates: redGates,
        ownerApproval: "REJECTED",
        approverId: "owner-9",
      }),
    );

    expect(result.decision).toBe("NOT_APPROVED");
    expect(result.blockers).toContain("OWNER_APPROVAL_REJECTED");
  });

  it("never escalates an unsound change to an owner", () => {
    // A failing gate is not an owner's decision to make.
    const result = evaluateApproval(
      request({
        risk: "RED",
        controls: redControls,
        gates: evaluateGates("RED", passingGates),
      }),
    );

    expect(result.decision).toBe("NOT_APPROVED");
    expect(result.blockers).toContain("GATES_NOT_SATISFIED");
  });
});

describe("gates and findings cannot be approved past", () => {
  it("refuses when a required gate is not satisfied", () => {
    const result = evaluateApproval(
      request({ gates: evaluateGates("GREEN", passingGates.slice(0, 2)) }),
    );

    expect(result.decision).toBe("NOT_APPROVED");
    expect(result.blockers).toContain("GATES_NOT_SATISFIED");
  });

  it("refuses on a blocking agent finding", () => {
    const blocked = runReviewAgents({
      files: [{ path: "lib/thing.ts" }],
      assessment: assessDiffRisk([{ path: "lib/thing.ts" }]),
      gateResults: passingGates,
      hasTestChanges: false,
    });

    const result = evaluateApproval(request({ agents: blocked }));

    expect(result.decision).toBe("NOT_APPROVED");
    expect(result.blockers).toContain("BLOCKING_FINDINGS");
  });

  it("refuses when the diff escalated past its declaration", () => {
    const result = evaluateApproval(request({ riskEscalated: true }));

    expect(result.decision).toBe("NOT_APPROVED");
    expect(result.blockers).toContain("RISK_ESCALATED_SINCE_DECLARATION");
  });
});

describe("controls cannot be approved past", () => {
  const held = resolveEffectiveControls(allOn, allOn, {
    killSwitchActive: true,
    emergencyStopActive: false,
    releaseFrozen: false,
    executorConnected: false,
  });

  it("refuses when the envelope holds every action off", () => {
    const result = evaluateApproval(request({ controls: held }));

    expect(result.decision).toBe("NOT_APPROVED");
    expect(result.blockers).toContain("ACTION_NOT_ENABLED");
    expect(result.blockers).toContain("EXECUTOR_NOT_CONNECTED");
  });

  it("refuses when autonomous mode is off", () => {
    const off = resolveEffectiveControls({ ...allOn, autonomousMode: false }, allOn, {
      killSwitchActive: false, emergencyStopActive: false, releaseFrozen: false, executorConnected: true,
    });

    expect(evaluateApproval(request({ controls: off })).blockers).toContain("AUTONOMOUS_MODE_OFF");
  });

  it("distinguishes above-the-ceiling from not-enabled", () => {
    const greenCeiling = resolveEffectiveControls(
      { ...allOn, maximumAutonomousRisk: "GREEN" },
      { ...allOn, maximumAutonomousRisk: "GREEN" },
      { killSwitchActive: false, emergencyStopActive: false, releaseFrozen: false, executorConnected: true },
    );

    const result = evaluateApproval(
      request({
        risk: "YELLOW",
        controls: greenCeiling,
        gates: evaluateGates("YELLOW", [
          ...passingGates,
          { gate: "security_review", outcome: "passed" },
          { gate: "migration_review", outcome: "passed" },
          { gate: "e2e", outcome: "passed" },
          { gate: "rollback_validated", outcome: "passed" },
        ]),
      }),
    );

    expect(result.blockers).toContain("ABOVE_RISK_CEILING");
    expect(result.blockers).not.toContain("ACTION_NOT_ENABLED");
  });
});

describe("the reported reason", () => {
  it("explains every blocker it found", () => {
    const result = evaluateApproval(
      request({ gates: evaluateGates("GREEN", []), riskEscalated: true }),
    );

    expect(result.reason).toMatch(/riskier than declared/i);
    expect(result.reason).toMatch(/verification has not passed/i);
  });

  it("records the risk the decision was made against", () => {
    expect(evaluateApproval(request({ risk: "GREEN" })).evaluatedRisk).toBe("GREEN");
  });
});
