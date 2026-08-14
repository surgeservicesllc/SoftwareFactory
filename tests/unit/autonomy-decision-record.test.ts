import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_ACTIONS,
  resolveEffectiveControls,
  type AutonomyControls,
} from "@/lib/autonomy/controls";
import {
  AUTONOMY_POLICY_VERSION,
  buildDecisionRecord,
  isRecordableDecision,
} from "@/lib/autonomy/decision-record";
import { GREEN_GATES, type GateResult } from "@/lib/autonomy/gates";
import { runPipeline, type PipelineInput } from "@/lib/autonomy/pipeline";

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

function input(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    action: "merge",
    declaredRisk: "GREEN",
    files: [{ path: "components/thing.tsx" }, { path: "tests/unit/thing.test.tsx" }],
    gateResults: passingGates,
    controls: permissive,
    authorId: "author-1",
    approverId: "reviewer-2",
    pullRequestOpen: true,
    ...overrides,
  };
}

const context = {
  projectId: "project-1",
  action: "merge" as const,
  authorId: "author-1",
  approverId: "reviewer-2",
  headSha: "abc1234",
};

describe("what gets recorded", () => {
  it("captures the decision, risk, stage and identities", () => {
    const record = buildDecisionRecord(runPipeline(input()), context);

    expect(record).toMatchObject({
      projectId: "project-1",
      action: "merge",
      decision: "APPROVED_AUTOMATICALLY",
      risk: "GREEN",
      riskEscalated: false,
      headSha: "abc1234",
      authorId: "author-1",
      approverId: "reviewer-2",
      policyVersion: AUTONOMY_POLICY_VERSION,
    });
  });

  it("records the stage the run reached", () => {
    const record = buildDecisionRecord(runPipeline(input()), context);
    expect(record.reachedStage).toBe("merge");
  });

  it("leaves the head null when the caller does not state one", () => {
    const record = buildDecisionRecord(runPipeline(input()), { ...context, headSha: undefined });
    expect(record.headSha).toBeNull();
  });
});

describe("blockers explain the decision", () => {
  it("records none for an automatic approval", () => {
    const record = buildDecisionRecord(runPipeline(input()), context);

    expect(record.decision).toBe("APPROVED_AUTOMATICALLY");
    expect(record.blockers).toEqual([]);
  });

  it("does not fold a halt into an approval's blockers", () => {
    // This run is approved and then halts at merge for want of an executor.
    // That says nothing about whether approving it was right, so recording it
    // as a blocker would describe a refusal that never happened.
    const run = runPipeline(input());
    const record = buildDecisionRecord(run, context);

    expect(run.completed).toBe(false);
    expect(run.reachedStage).toBe("merge");
    expect(record.decision).toBe("APPROVED_AUTOMATICALLY");
    expect(record.blockers).toEqual([]);
    // Where it stopped is still recorded — just in the field that means it.
    expect(record.reachedStage).toBe("merge");
  });

  it("records the approval's own blockers for a refusal", () => {
    const run = runPipeline(input({ gateResults: [] }));
    const record = buildDecisionRecord(run, context);

    expect(record.decision).toBe("NOT_APPROVED");
    expect(record.blockers).toContain("GATES_NOT_SATISFIED");
  });

  it("adds the halting stage when approval alone would not explain it", () => {
    // The run stops at intake, long before approval is meaningful.
    const record = buildDecisionRecord(runPipeline(input({ files: [] })), context);

    expect(record.blockers).toContain("NO_WORK");
    expect(record.blockers.length).toBeGreaterThan(0);
  });

  it("never records an empty blocker list for a refusal", () => {
    for (const overrides of [
      { files: [] },
      { gateResults: [] },
      { pullRequestOpen: false },
      { declaredRisk: "RED" as const },
    ]) {
      const record = buildDecisionRecord(runPipeline(input(overrides)), context);
      if (record.decision !== "APPROVED_AUTOMATICALLY") {
        expect(record.blockers.length, JSON.stringify(overrides)).toBeGreaterThan(0);
      }
    }
  });

  it("does not repeat a code that appears in both places", () => {
    const record = buildDecisionRecord(runPipeline(input({ gateResults: [] })), context);
    expect(new Set(record.blockers).size).toBe(record.blockers.length);
  });

  it("records codes only, never prose", () => {
    const record = buildDecisionRecord(runPipeline(input({ gateResults: [] })), context);

    for (const blocker of record.blockers) {
      expect(blocker).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});

describe("a self-approval is never recorded as one", () => {
  it("drops an approver who is also the author", () => {
    const record = buildDecisionRecord(runPipeline(input({ approverId: "author-1" })), {
      ...context,
      approverId: "author-1",
    });

    // Writing it would misrepresent who signed off.
    expect(record.approverId).toBeNull();
  });

  it("keeps an independent approver", () => {
    const record = buildDecisionRecord(runPipeline(input()), context);
    expect(record.approverId).toBe("reviewer-2");
  });
});

describe("isRecordableDecision", () => {
  it("accepts a well-formed approval and a well-formed refusal", () => {
    expect(isRecordableDecision(buildDecisionRecord(runPipeline(input()), context))).toBe(true);
    expect(
      isRecordableDecision(buildDecisionRecord(runPipeline(input({ gateResults: [] })), context)),
    ).toBe(true);
  });

  it("refuses an approval that claims a blocker", () => {
    const base = buildDecisionRecord(runPipeline(input()), context);
    expect(isRecordableDecision({ ...base, blockers: ["SOMETHING"] })).toBe(false);
  });

  it("refuses a refusal with no named blocker", () => {
    const base = buildDecisionRecord(runPipeline(input({ gateResults: [] })), context);
    expect(isRecordableDecision({ ...base, blockers: [] })).toBe(false);
  });

  it("refuses an approval whose approver is its author", () => {
    const base = buildDecisionRecord(runPipeline(input()), context);
    expect(isRecordableDecision({ ...base, approverId: "author-1", authorId: "author-1" })).toBe(
      false,
    );
  });
});
