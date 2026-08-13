import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_ACTIONS,
  resolveEffectiveControls,
  type AutonomyControls,
} from "@/lib/autonomy/controls";
import {
  RECOVERY_STEPS,
  describeRecovery,
  planRecovery,
  type FailedRelease,
} from "@/lib/autonomy/recovery";
import { MAX_ATTEMPTS } from "@/lib/autonomy/retries";

const allOn: AutonomyControls = {
  autonomousMode: true,
  maximumAutonomousRisk: "YELLOW",
  actions: Object.fromEntries(AUTOMATIC_ACTIONS.map((a) => [a, true])) as AutonomyControls["actions"],
};

/** Controls with an executor, so the recovery judgements are reachable. */
const permissive = resolveEffectiveControls(allOn, allOn, {
  killSwitchActive: false,
  emergencyStopActive: false,
  releaseFrozen: false,
  executorConnected: true,
});

/** The shipped reality: no executor exists. */
const asShipped = resolveEffectiveControls(allOn, allOn, {
  killSwitchActive: true,
  emergencyStopActive: false,
  releaseFrozen: false,
  executorConnected: false,
});

function failure(overrides: Partial<FailedRelease> = {}): FailedRelease {
  return {
    risk: "GREEN",
    containsDestructiveMigration: false,
    lastKnownGoodValidated: true,
    repairAttemptsUsed: 0,
    ...overrides,
  };
}

function stepOf(plan: ReturnType<typeof planRecovery>, step: (typeof RECOVERY_STEPS)[number]) {
  return plan.steps.find((entry) => entry.step === step);
}

describe("ordering", () => {
  it("plans every step, in the fixed recovery order", () => {
    const plan = planRecovery(failure(), permissive);
    expect(plan.steps.map((step) => step.step)).toEqual([...RECOVERY_STEPS]);
  });

  it("freezes first, because freezing only removes authority", () => {
    const plan = planRecovery(failure(), asShipped);

    expect(plan.steps[0].step).toBe("freeze");
    expect(plan.steps[0].decision).toBe("DO");
  });

  it("records the incident whether or not anything can be done", () => {
    for (const controls of [permissive, asShipped]) {
      expect(stepOf(planRecovery(failure(), controls), "incident")?.decision).toBe("DO");
    }
  });
});

describe("never auto-reverse a destructive migration", () => {
  it("refuses rollback to the owner when the release dropped something", () => {
    const plan = planRecovery(failure({ containsDestructiveMigration: true }), permissive);
    const rollback = stepOf(plan, "rollback");

    expect(rollback?.decision).toBe("OWNER_ONLY");
    expect(rollback?.refusal).toBe("DESTRUCTIVE_MIGRATION_IN_RELEASE");
    expect(rollback?.detail).toMatch(/not an undo/i);
  });

  it("holds even when everything else would have allowed it", () => {
    // Enabled, within ceiling, validated last known good, executor connected.
    const plan = planRecovery(
      failure({ containsDestructiveMigration: true, risk: "GREEN" }),
      permissive,
    );

    expect(stepOf(plan, "rollback")?.decision).not.toBe("DO");
    expect(plan.ownerAttentionRequired).toBe(true);
  });

  it("outranks the other refusals, so the reported reason is the real one", () => {
    // No validated last known good *and* destructive: the destructive fact is
    // the one an owner needs to see.
    const plan = planRecovery(
      failure({ containsDestructiveMigration: true, lastKnownGoodValidated: false }),
      permissive,
    );

    expect(stepOf(plan, "rollback")?.refusal).toBe("DESTRUCTIVE_MIGRATION_IN_RELEASE");
  });
});

describe("rollback fails closed", () => {
  it("refuses without a validated last known good", () => {
    const plan = planRecovery(failure({ lastKnownGoodValidated: false }), permissive);

    expect(stepOf(plan, "rollback")?.refusal).toBe("NO_VALIDATED_LAST_KNOWN_GOOD");
  });

  it("refuses when no executor is connected", () => {
    expect(stepOf(planRecovery(failure(), asShipped), "rollback")?.refusal).toBe(
      "EXECUTOR_NOT_CONNECTED",
    );
  });

  it("refuses when automatic rollback is not enabled", () => {
    const noRollback = resolveEffectiveControls(
      { ...allOn, actions: { ...allOn.actions, rollback: false } },
      allOn,
      { killSwitchActive: false, emergencyStopActive: false, releaseFrozen: false, executorConnected: true },
    );

    expect(stepOf(planRecovery(failure(), noRollback), "rollback")?.refusal).toBe(
      "ACTION_NOT_ENABLED",
    );
  });

  it("refuses a failure riskier than the ceiling", () => {
    const greenCeiling = resolveEffectiveControls(
      { ...allOn, maximumAutonomousRisk: "GREEN" },
      { ...allOn, maximumAutonomousRisk: "GREEN" },
      { killSwitchActive: false, emergencyStopActive: false, releaseFrozen: false, executorConnected: true },
    );

    expect(stepOf(planRecovery(failure({ risk: "RED" }), greenCeiling), "rollback")?.refusal).toBe(
      "ABOVE_RISK_CEILING",
    );
  });

  it("allows it only when every condition holds", () => {
    expect(stepOf(planRecovery(failure(), permissive), "rollback")?.decision).toBe("DO");
  });
});

describe("repair is bounded", () => {
  it("allows repair while budget remains", () => {
    const step = stepOf(planRecovery(failure({ repairAttemptsUsed: 1 }), permissive), "repair");

    expect(step?.decision).toBe("DO");
    expect(step?.detail).toMatch(/attempt\(s\) remain/);
  });

  it("refuses once the budget is spent, rather than trying again", () => {
    const step = stepOf(
      planRecovery(failure({ repairAttemptsUsed: MAX_ATTEMPTS.repair }), permissive),
      "repair",
    );

    expect(step?.refusal).toBe("RETRY_BUDGET_EXHAUSTED");
  });

  it("reports the missing worker rather than pretending repair can run", () => {
    expect(stepOf(planRecovery(failure(), asShipped), "repair")?.refusal).toBe(
      "EXECUTOR_NOT_CONNECTED",
    );
  });
});

describe("escalation", () => {
  it("escalates whenever any step could not be taken", () => {
    const plan = planRecovery(failure(), asShipped);

    expect(stepOf(plan, "escalate")?.decision).toBe("DO");
    expect(plan.ownerAttentionRequired).toBe(true);
  });

  it("does not escalate a recovery the loop can finish itself", () => {
    const plan = planRecovery(failure(), permissive);

    expect(plan.ownerAttentionRequired).toBe(false);
    expect(stepOf(plan, "escalate")?.decision).toBe("REFUSE");
    expect(plan.automatic).toEqual(["freeze", "incident", "rollback", "repair"]);
  });
});

describe("as this tree actually ships", () => {
  it("freezes and records, and can do nothing else", () => {
    const plan = planRecovery(failure(), asShipped);

    expect(plan.automatic).toEqual(["freeze", "incident", "escalate"]);
    expect(stepOf(plan, "rollback")?.decision).toBe("REFUSE");
    expect(stepOf(plan, "repair")?.decision).toBe("REFUSE");
  });
});

describe("describeRecovery", () => {
  it("renders one readable line per step", () => {
    const lines = describeRecovery(planRecovery(failure(), asShipped));

    expect(lines).toHaveLength(RECOVERY_STEPS.length);
    expect(lines[0]).toMatch(/^Freeze releases: DO — /);
    expect(lines.join("\n")).toMatch(/EXECUTOR_NOT_CONNECTED/);
  });
});
