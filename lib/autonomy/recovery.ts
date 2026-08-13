import {
  isActionPermitted,
  type EffectiveAutonomyControls,
} from "@/lib/autonomy/controls";
import { evaluateRetry, MAX_ATTEMPTS } from "@/lib/autonomy/retries";
import type { RiskLevel } from "@/lib/risk";

/**
 * The recovery decision machine: what the loop should do about a failure.
 *
 * `pipeline.ts` decides about a change going *out*. This decides about a
 * release that went out and broke, which is a different question with a
 * different ordering and a different set of things that must never happen
 * automatically.
 *
 * Like the forward pipeline, it decides and records; it executes nothing. The
 * point of separating it is that "should we roll back?" is a judgement with
 * real consequences, and it should be inspectable and testable on its own
 * rather than implied by whichever caller happens to drive Phase 1E's
 * functions in what order.
 */

export const RECOVERY_STEPS = [
  "freeze",
  "incident",
  "rollback",
  "repair",
  "escalate",
] as const;

export type RecoveryStep = (typeof RECOVERY_STEPS)[number];

export const RECOVERY_STEP_LABELS: Readonly<Record<RecoveryStep, string>> = Object.freeze({
  freeze: "Freeze releases",
  incident: "Open an incident",
  rollback: "Roll back to the last known good release",
  repair: "Open bounded repair work",
  escalate: "Escalate to an owner",
});

export type RecoveryDecision = "DO" | "REFUSE" | "OWNER_ONLY";

export type RecoveryRefusal =
  | "ACTION_NOT_ENABLED"
  | "ABOVE_RISK_CEILING"
  | "NO_VALIDATED_LAST_KNOWN_GOOD"
  | "DESTRUCTIVE_MIGRATION_IN_RELEASE"
  | "EXECUTOR_NOT_CONNECTED"
  | "RETRY_BUDGET_EXHAUSTED";

export interface RecoveryStepPlan {
  readonly step: RecoveryStep;
  readonly decision: RecoveryDecision;
  readonly refusal?: RecoveryRefusal;
  readonly detail: string;
}

export interface FailedRelease {
  /** Risk of the change that shipped, used against the ceiling. */
  readonly risk: RiskLevel;
  /**
   * True when the failed release contained a destructive schema change —
   * a dropped table or column, a truncate, an unbounded delete, an RLS or
   * policy removal.
   */
  readonly containsDestructiveMigration: boolean;
  /** A previous release whose own validation passed, if one exists. */
  readonly lastKnownGoodValidated: boolean;
  /** Repair attempts already made for this failure. */
  readonly repairAttemptsUsed: number;
}

export interface RecoveryPlan {
  readonly steps: readonly RecoveryStepPlan[];
  /** Steps the loop may take on its own, in order. */
  readonly automatic: readonly RecoveryStep[];
  /** True when anything needs a human. */
  readonly ownerAttentionRequired: boolean;
}

/**
 * Plan the response to a failed release.
 *
 * The ordering is fixed and deliberate: **freeze first**. Freezing only
 * subtracts authority, so it is always safe and always the first thing to do —
 * it stops the loop making the situation worse while the rest is decided.
 *
 * Rollback is where the judgement is, and it fails closed on four separate
 * conditions. The one worth stating outright: a release containing a
 * destructive migration is **never** rolled back automatically. Re-running a
 * migration forward is usually safe; reversing one that dropped a table or a
 * policy is not, because the data or the protection is already gone and a
 * "rollback" would be a second destructive act rather than an undo. That
 * refusal holds regardless of controls, ceiling, or owner approval — it is a
 * property of the change, not of the configuration.
 */
export function planRecovery(
  failure: FailedRelease,
  controls: EffectiveAutonomyControls,
): RecoveryPlan {
  const steps: RecoveryStepPlan[] = [];

  // 1. Freeze. Always safe: it removes authority rather than exercising it.
  steps.push({
    step: "freeze",
    decision: "DO",
    detail: "Freezing only removes authority, so it is always safe and always first.",
  });

  // 2. Incident. Recording a failure is never gated.
  steps.push({
    step: "incident",
    decision: "DO",
    detail: "A failure is recorded whether or not anything can be done about it.",
  });

  // 3. Rollback.
  steps.push(planRollback(failure, controls));

  // 4. Repair, bounded.
  steps.push(planRepair(failure, controls));

  // 5. Escalate when the loop cannot finish the job itself.
  const unresolved = steps.some((step) => step.decision !== "DO");
  steps.push({
    step: "escalate",
    decision: unresolved ? "DO" : "REFUSE",
    detail: unresolved
      ? "Something in the recovery needs a human."
      : "The loop can complete this recovery without an owner.",
  });

  return Object.freeze({
    steps: Object.freeze(steps),
    automatic: Object.freeze(
      steps.filter((step) => step.decision === "DO").map((step) => step.step),
    ),
    ownerAttentionRequired: unresolved,
  });
}

function planRollback(
  failure: FailedRelease,
  controls: EffectiveAutonomyControls,
): RecoveryStepPlan {
  // This one outranks everything else, including an enabled control and an
  // owner's ceiling. Reversing a destructive migration is not an undo.
  if (failure.containsDestructiveMigration) {
    return {
      step: "rollback",
      decision: "OWNER_ONLY",
      refusal: "DESTRUCTIVE_MIGRATION_IN_RELEASE",
      detail:
        "The release contained a destructive migration. Reversing it would be a second destructive act, not an undo, so only an owner may decide it.",
    };
  }

  if (!failure.lastKnownGoodValidated) {
    return {
      step: "rollback",
      decision: "REFUSE",
      refusal: "NO_VALIDATED_LAST_KNOWN_GOOD",
      detail: "No previous release has a passing validation to roll back to.",
    };
  }

  if (controls.restrictions.includes("EXECUTOR_NOT_CONNECTED")) {
    return {
      step: "rollback",
      decision: "REFUSE",
      refusal: "EXECUTOR_NOT_CONNECTED",
      detail: "No rollback executor is connected.",
    };
  }

  if (!isActionPermitted(controls, "rollback", failure.risk)) {
    const enabled = controls.actions.rollback;
    return {
      step: "rollback",
      decision: "REFUSE",
      refusal: enabled ? "ABOVE_RISK_CEILING" : "ACTION_NOT_ENABLED",
      detail: enabled
        ? "The failed release is riskier than the configured ceiling allows."
        : "Automatic rollback is not enabled.",
    };
  }

  return {
    step: "rollback",
    decision: "DO",
    detail: "A validated last known good release exists and rollback is permitted.",
  };
}

function planRepair(
  failure: FailedRelease,
  controls: EffectiveAutonomyControls,
): RecoveryStepPlan {
  const retry = evaluateRetry("repair", failure.repairAttemptsUsed);
  if (retry.decision !== "RETRY") {
    return {
      step: "repair",
      decision: "REFUSE",
      refusal: "RETRY_BUDGET_EXHAUSTED",
      detail: `All ${MAX_ATTEMPTS.repair} repair attempts are used; escalating instead.`,
    };
  }

  if (controls.restrictions.includes("EXECUTOR_NOT_CONNECTED")) {
    return {
      step: "repair",
      decision: "REFUSE",
      refusal: "EXECUTOR_NOT_CONNECTED",
      detail: "Repair work can be created, but no worker is connected to run it.",
    };
  }

  if (!isActionPermitted(controls, "repair", failure.risk)) {
    const enabled = controls.actions.repair;
    return {
      step: "repair",
      decision: "REFUSE",
      refusal: enabled ? "ABOVE_RISK_CEILING" : "ACTION_NOT_ENABLED",
      detail: enabled
        ? "The failure is riskier than the configured ceiling allows."
        : "Automatic repair is not enabled.",
    };
  }

  return {
    step: "repair",
    decision: "DO",
    detail: `Repair is permitted; ${retry.attemptsRemaining} attempt(s) remain.`,
  };
}

/** One readable line per step, for an incident record or a report. */
export function describeRecovery(plan: RecoveryPlan): readonly string[] {
  return Object.freeze(
    plan.steps.map(
      (step) =>
        `${RECOVERY_STEP_LABELS[step.step]}: ${step.decision}${
          step.refusal ? ` (${step.refusal})` : ""
        } — ${step.detail}`,
    ),
  );
}
