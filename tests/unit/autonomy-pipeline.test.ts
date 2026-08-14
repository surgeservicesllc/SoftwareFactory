import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_ACTIONS,
  resolveEffectiveControls,
  type AutonomyControls,
} from "@/lib/autonomy/controls";
import { GREEN_GATES, type GateResult } from "@/lib/autonomy/gates";
import {
  PIPELINE_STAGES,
  UNEXECUTABLE_STAGES,
  describeRun,
  runPipeline,
  type PipelineInput,
} from "@/lib/autonomy/pipeline";

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

function outcome(run: ReturnType<typeof runPipeline>, stage: (typeof PIPELINE_STAGES)[number]) {
  return run.stages.find((entry) => entry.stage === stage);
}

describe("stage ordering", () => {
  it("advances stages in loop order and never skips one", () => {
    const run = runPipeline(input());
    const reached = run.stages.map((entry) => entry.stage);

    expect(reached).toEqual(PIPELINE_STAGES.slice(0, reached.length));
  });

  it("stops at the first blocked stage", () => {
    const run = runPipeline(input({ files: [] }));

    expect(run.stages).toHaveLength(1);
    expect(run.reachedStage).toBe("intake");
    expect(run.completed).toBe(false);
    expect(outcome(run, "intake")?.blocker).toBe("NO_WORK");
  });

  it("returns every stage it did evaluate, so progress is visible", () => {
    const run = runPipeline(input({ gateResults: [] }));

    expect(run.stages.map((s) => s.stage)).toContain("classify");
    expect(run.reachedStage).toBe("verify");
  });
});

describe("the blocked executors are named, not skipped", () => {
  it("satisfies implement for a human-authored change", () => {
    const run = runPipeline(input());

    expect(outcome(run, "implement")?.status).toBe("satisfied");
  });

  it("blocks implement when the loop is asked to write the code itself", () => {
    const run = runPipeline(input({ codeAuthoredBy: "worker" }));

    expect(outcome(run, "implement")?.blocker).toBe(UNEXECUTABLE_STAGES.implement);
    expect(run.reachedStage).toBe("implement");
  });

  it("reaches merge and blocks there by name", () => {
    const run = runPipeline(input());

    expect(outcome(run, "approval")?.status).toBe("satisfied");
    expect(outcome(run, "merge")?.status).toBe("blocked");
    expect(outcome(run, "merge")?.blocker).toBe("MERGE_EXECUTOR_NOT_CONNECTED");
    expect(run.reachedStage).toBe("merge");
  });

  it("names a deploy blocker that a future phase must update deliberately", () => {
    expect(UNEXECUTABLE_STAGES.deploy).toBe("DEPLOY_EXECUTOR_NOT_CONNECTED");
  });
});

describe("the validate stage", () => {
  it("is not reached in this tree, because merge blocks first", () => {
    // Stated as a test rather than a comment: `validate` fails closed on absent
    // evidence, and that branch is unreachable until merge and deploy have
    // executors. A future phase that connects them makes this assertion fail,
    // which is the point — it forces the validate path to be looked at.
    const run = runPipeline(input());

    expect(run.reachedStage).toBe("merge");
    expect(outcome(run, "validate")).toBeUndefined();
  });
});

describe("classification is done against the real diff", () => {
  it("blocks a change that escalated past its declaration", () => {
    const run = runPipeline(
      input({
        declaredRisk: "GREEN",
        files: [
          { path: "supabase/migrations/20260101000000_x.sql" },
          { path: "tests/unit/x.test.ts" },
        ],
      }),
    );

    expect(run.riskEscalated).toBe(true);
    expect(run.assessment.level).toBe("YELLOW");
    expect(outcome(run, "classify")?.blocker).toBe("RISK_ESCALATED");
    expect(run.reachedStage).toBe("classify");
  });

  it("carries the escalation into the approval decision", () => {
    const run = runPipeline(
      input({
        declaredRisk: "GREEN",
        files: [{ path: ".env" }, { path: "tests/unit/x.test.ts" }],
      }),
    );

    expect(run.approval.blockers).toContain("RISK_ESCALATED_SINCE_DECLARATION");
    expect(run.approval.decision).toBe("NOT_APPROVED");
  });

  it("does not block when the declaration was accurate", () => {
    const run = runPipeline(input({ declaredRisk: "GREEN" }));

    expect(run.riskEscalated).toBe(false);
    expect(outcome(run, "classify")?.status).toBe("satisfied");
  });
});

describe("gates and findings stop progression", () => {
  it("blocks verify when a required gate is missing", () => {
    const run = runPipeline(input({ gateResults: passingGates.slice(0, 2) }));

    expect(outcome(run, "verify")?.status).toBe("blocked");
    expect(outcome(run, "verify")?.blocker).toBe("GATES_NOT_SATISFIED");
    expect(run.reachedStage).toBe("verify");
  });

  it("blocks review on a blocking agent finding, after verify passed", () => {
    // Presentation-only, so it stays GREEN and clears the gates — the only
    // thing wrong with it is that it ships no test.
    const run = runPipeline(input({ files: [{ path: "components/thing.tsx" }] }));

    expect(run.assessment.level).toBe("GREEN");
    expect(outcome(run, "verify")?.status).toBe("satisfied");
    expect(outcome(run, "review")?.blocker).toBe("BLOCKING_FINDINGS");
    expect(run.agents.blockingFindings.map((f) => f.code)).toContain("NO_TEST_EVIDENCE");
  });
});

describe("the pull request stage", () => {
  it("requires a draft pull request to exist", () => {
    const run = runPipeline(input({ pullRequestOpen: false }));

    expect(outcome(run, "pull_request")?.blocker).toBe("NO_PULL_REQUEST");
    expect(run.reachedStage).toBe("pull_request");
  });

  it("passes once one is open", () => {
    expect(outcome(runPipeline(input()), "pull_request")?.status).toBe("satisfied");
  });
});

describe("describeRun", () => {
  it("renders one readable line per evaluated stage", () => {
    const run = runPipeline(input());
    const lines = describeRun(run);

    expect(lines).toHaveLength(run.stages.length);
    expect(lines[0]).toMatch(/^Intake: satisfied — /);
    expect(lines.at(-1)).toMatch(/blocked \(MERGE_EXECUTOR_NOT_CONNECTED\)/);
  });
});

describe("the GREEN end-to-end demonstration", () => {
  /**
   * The loop's decision layer is exercised in full on a well-formed GREEN
   * change. Every decision that can be made in this tree is made; the two
   * stages that need an executor are asserted as blocked by name rather than
   * simulated, so connecting one later fails this test on purpose.
   */
  it("decides every stage it can, and blocks exactly the ones it cannot", () => {
    const run = runPipeline(input());

    expect(run.assessment.level).toBe("GREEN");
    expect(run.gates.satisfied).toBe(true);
    expect(run.agents.clear).toBe(true);
    expect(run.approval.decision).toBe("APPROVED_AUTOMATICALLY");

    // The change is approved, and still cannot proceed: there is no merge executor.
    expect(run.completed).toBe(false);
    expect(run.reachedStage).toBe("merge");
    expect(outcome(run, "merge")?.blocker).toBe("MERGE_EXECUTOR_NOT_CONNECTED");
  });

  it("holds every action off when the kill switch is engaged, whatever the change", () => {
    const locked = resolveEffectiveControls(allOn, allOn, {
      killSwitchActive: true,
      emergencyStopActive: false,
      releaseFrozen: false,
      executorConnected: true,
    });

    const run = runPipeline(input({ controls: locked }));

    expect(run.approval.decision).toBe("NOT_APPROVED");
    expect(run.approval.blockers).toContain("ACTION_NOT_ENABLED");
  });

  it("holds every action off under an emergency stop", () => {
    const stopped = resolveEffectiveControls(allOn, allOn, {
      killSwitchActive: false,
      emergencyStopActive: true,
      releaseFrozen: false,
      executorConnected: true,
    });

    expect(runPipeline(input({ controls: stopped })).approval.decision).toBe("NOT_APPROVED");
  });

  it("holds every action off while a release freeze is active", () => {
    const frozen = resolveEffectiveControls(allOn, allOn, {
      killSwitchActive: false,
      emergencyStopActive: false,
      releaseFrozen: true,
      executorConnected: true,
    });

    expect(runPipeline(input({ controls: frozen })).approval.decision).toBe("NOT_APPROVED");
  });
});

describe("a RED change never reaches an automatic approval", () => {
  it("requires an owner and reports it as such", () => {
    const redControls = resolveEffectiveControls(
      { ...allOn, maximumAutonomousRisk: "RED" },
      { ...allOn, maximumAutonomousRisk: "RED" },
      { killSwitchActive: false, emergencyStopActive: false, releaseFrozen: false, executorConnected: true },
    );

    const run = runPipeline(
      input({
        declaredRisk: "RED",
        controls: redControls,
        files: [{ path: ".env.production" }, { path: "tests/unit/x.test.ts" }],
        gateResults: [
          ...passingGates,
          { gate: "security_review", outcome: "passed" },
          { gate: "migration_review", outcome: "passed" },
          { gate: "e2e", outcome: "passed" },
          { gate: "rollback_validated", outcome: "passed" },
        ],
      }),
    );

    expect(run.assessment.level).toBe("RED");
    // The security agent blocks a credential-class change outright, so this is
    // NOT_APPROVED rather than merely awaiting a signature.
    expect(run.approval.decision).toBe("NOT_APPROVED");
    expect(run.approval.ownerApprovalRequired).toBe(true);
  });
});

describe("the merge stage revalidates against the current head", () => {
  const readiness = {
    currentHeadSha: "current",
    gatedHeadSha: "current",
    approvedHeadSha: "current",
    mergeability: "clean" as const,
    pullRequestOpen: true,
    requiredChecks: ["CI"],
    checks: [{ name: "CI", status: "passed" as const }],
  };

  it("reports a stale approval ahead of the missing executor", () => {
    // The executor is missing either way; a signature that describes an older
    // commit is the thing an operator has to fix first.
    const run = runPipeline(
      input({ mergeReadiness: { ...readiness, approvedHeadSha: "older" } }),
    );

    expect(outcome(run, "merge")?.blocker).toBe("APPROVAL_STALE");
  });

  it("reports a conflict ahead of the missing executor", () => {
    const run = runPipeline(input({ mergeReadiness: { ...readiness, mergeability: "dirty" } }));

    expect(outcome(run, "merge")?.blocker).toBe("MERGE_CONFLICT");
  });

  it("reports a failing required check ahead of the missing executor", () => {
    const run = runPipeline(
      input({
        mergeReadiness: { ...readiness, checks: [{ name: "CI", status: "failed" as const }] },
      }),
    );

    expect(outcome(run, "merge")?.blocker).toBe("REQUIRED_CHECK_FAILING");
  });

  it("falls back to the executor blocker once everything else is clean", () => {
    const run = runPipeline(input({ mergeReadiness: readiness }));

    expect(outcome(run, "merge")?.blocker).toBe("MERGE_EXECUTOR_NOT_CONNECTED");
  });

  it("still blocks on the executor when no revalidation input is supplied", () => {
    expect(outcome(runPipeline(input()), "merge")?.blocker).toBe("MERGE_EXECUTOR_NOT_CONNECTED");
  });
});
