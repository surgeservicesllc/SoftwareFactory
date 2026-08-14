import {
  isActionPermitted,
  type EffectiveAutonomyControls,
} from "@/lib/autonomy/controls";
import { evaluateRetry, MAX_ATTEMPTS } from "@/lib/autonomy/retries";
import type { RiskFactor, RiskLevel } from "@/lib/risk";

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
  | "IRREVERSIBLE_CHANGE_IN_RELEASE"
  | "DEPLOYMENT_IDENTITY_AMBIGUOUS"
  | "TELEMETRY_UNRELIABLE"
  | "CONCURRENT_DEPLOYMENTS"
  | "EXECUTOR_NOT_CONNECTED"
  | "RETRY_BUDGET_EXHAUSTED";

/**
 * Change classes whose presence in the failed release prohibits an automatic
 * rollback, from `policies/AUTO_ROLLBACK.md`: "the preceding release included
 * irreversible data, auth, security, secret, DNS, or infrastructure changes".
 *
 * These are reused from the diff classifier rather than restated, so the
 * definition of "irreversible" cannot drift between the two.
 */
export const IRREVERSIBLE_RELEASE_FACTORS: readonly RiskFactor[] = Object.freeze([
  "destructive-production-data",
  "secrets-or-credentials",
  "authentication-or-security-controls",
  "dns-or-domain-ownership",
  "privileged-access",
  "irreversible-production-change",
]);

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
   * Risk factors the failed release actually carried, from the diff
   * classifier. Any factor in `IRREVERSIBLE_RELEASE_FACTORS` prohibits an
   * automatic rollback.
   */
  readonly releaseRiskFactors?: readonly RiskFactor[];
  /** A previous release whose own validation passed, if one exists. */
  readonly lastKnownGoodValidated: boolean;
  /** Repair attempts already made for this failure. */
  readonly repairAttemptsUsed: number;
  /** True when the current deployment identity or root cause is ambiguous. */
  readonly deploymentIdentityAmbiguous?: boolean;
  /** True when telemetry is stale, unavailable, noisy, or in a known outage. */
  readonly telemetryUnreliable?: boolean;
  /** True when more than one deployment is in flight. */
  readonly concurrentDeployments?: boolean;
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
 * Rollback is where the judgement is, and it fails closed on every condition
 * `policies/AUTO_ROLLBACK.md` names. The one worth stating outright: a release
 * that changed data destructively, or touched auth, secrets, DNS, privileged
 * access, or anything else irreversible, is **never** rolled back
 * automatically. Re-running a migration forward is usually safe; reversing one
 * that dropped a table or a policy is not, because the data or the protection
 * is already gone and the "rollback" would be a second irreversible act rather
 * than an undo. That refusal holds regardless of controls, ceiling, or owner
 * approval — it is a property of the change, not of the configuration.
 *
 * The policy also prohibits automation on ambiguous or unreliable state, so an
 * unclear deployment identity, unreliable telemetry, or concurrent deployments
 * each hand the decision to an owner.
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
  // This outranks everything else, including an enabled control and an owner's
  // ceiling. Reversing an irreversible change is not an undo — the data, the
  // credential, or the security control is already gone.
  const irreversible = (failure.releaseRiskFactors ?? []).filter((factor) =>
    IRREVERSIBLE_RELEASE_FACTORS.includes(factor),
  );
  if (irreversible.length > 0) {
    return {
      step: "rollback",
      decision: "OWNER_ONLY",
      refusal: "IRREVERSIBLE_CHANGE_IN_RELEASE",
      detail: `The release changed ${irreversible
        .map((factor) => factor.replaceAll("-", " "))
        .join(", ")}. Reversing that is a second irreversible act, not an undo, so only an owner may decide it.`,
    };
  }

  // policies/AUTO_ROLLBACK.md prohibits automation on ambiguous or unreliable
  // state. Rolling back the wrong deployment, or on a signal that is merely
  // noisy, expands the incident instead of ending it.
  if (failure.deploymentIdentityAmbiguous) {
    return {
      step: "rollback",
      decision: "OWNER_ONLY",
      refusal: "DEPLOYMENT_IDENTITY_AMBIGUOUS",
      detail: "The current deployment identity or root cause is ambiguous.",
    };
  }
  if (failure.telemetryUnreliable) {
    return {
      step: "rollback",
      decision: "OWNER_ONLY",
      refusal: "TELEMETRY_UNRELIABLE",
      detail: "Telemetry is stale, unavailable, noisy, or inside a known monitoring outage.",
    };
  }
  if (failure.concurrentDeployments) {
    return {
      step: "rollback",
      decision: "OWNER_ONLY",
      refusal: "CONCURRENT_DEPLOYMENTS",
      detail: "More than one deployment is in flight.",
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
