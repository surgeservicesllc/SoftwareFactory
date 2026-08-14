import type { IncidentSeverity } from "@/lib/operations/types";

/**
 * Rollback eligibility under `policies/AUTO_ROLLBACK.md`.
 *
 * A rollback is a production mutation, not an undo button. This evaluator is
 * deliberately fail-closed: every blocker is collected, missing evidence counts
 * as a blocker, and `EXECUTOR_NOT_CONNECTED` is unconditional in this phase, so
 * `eligible` can never be true while no deployment adapter exists.
 */

export type RollbackBlocker =
  | "EXECUTOR_NOT_CONNECTED"
  | "OWNER_APPROVAL_REQUIRED"
  | "NO_LAST_KNOWN_GOOD"
  | "LAST_KNOWN_GOOD_NOT_VALIDATED"
  | "ROOT_CAUSE_AMBIGUOUS"
  | "DEPLOYMENT_IDENTITY_AMBIGUOUS"
  | "MULTIPLE_DEPLOYMENTS_IN_FLIGHT"
  | "IRREVERSIBLE_CHANGE_IN_RELEASE"
  | "DATABASE_COMPATIBILITY_UNCERTAIN"
  | "TELEMETRY_STALE_OR_UNAVAILABLE"
  | "SEVERITY_BELOW_THRESHOLD"
  | "ATTEMPT_LIMIT_REACHED"
  | "OWNER_STOPPED_OPERATIONS";

export const MAX_ROLLBACK_ATTEMPTS = 3;

export interface RollbackEvaluationInput {
  readonly severity: IncidentSeverity;
  readonly ownerApproved: boolean;
  readonly lastKnownGoodDeploymentId: string | null;
  readonly lastKnownGoodValidationPassed: boolean;
  readonly failingDeploymentId: string | null;
  readonly deploymentsInFlight: number;
  readonly rootCauseConfident: boolean;
  /** Any migration, auth, secret, DNS, or infrastructure change in the release. */
  readonly releaseContainedIrreversibleChange: boolean;
  readonly databaseCompatibilityConfirmed: boolean;
  readonly telemetryFresh: boolean;
  readonly priorAttempts: number;
  readonly operationsStopped: boolean;
  /**
   * Whether a deployment provider capable of performing the rollback is
   * connected. There is no such adapter in Phase 1E; the parameter exists so
   * the rule stays honest when one is added under a future approved policy.
   */
  readonly executorConnected: boolean;
}

export interface RollbackEvaluation {
  readonly eligible: boolean;
  readonly blockers: readonly RollbackBlocker[];
  readonly primaryBlocker: RollbackBlocker | null;
  readonly evidence: Record<string, unknown>;
}

export function evaluateRollbackEligibility(
  input: RollbackEvaluationInput,
): RollbackEvaluation {
  const blockers: RollbackBlocker[] = [];

  if (!input.executorConnected) blockers.push("EXECUTOR_NOT_CONNECTED");
  if (!input.ownerApproved) blockers.push("OWNER_APPROVAL_REQUIRED");
  if (input.operationsStopped) blockers.push("OWNER_STOPPED_OPERATIONS");
  if (input.priorAttempts >= MAX_ROLLBACK_ATTEMPTS) blockers.push("ATTEMPT_LIMIT_REACHED");

  if (input.severity === "sev3" || input.severity === "sev4") {
    blockers.push("SEVERITY_BELOW_THRESHOLD");
  }

  if (!input.lastKnownGoodDeploymentId) {
    blockers.push("NO_LAST_KNOWN_GOOD");
  } else if (!input.lastKnownGoodValidationPassed) {
    blockers.push("LAST_KNOWN_GOOD_NOT_VALIDATED");
  }

  if (!input.failingDeploymentId) blockers.push("DEPLOYMENT_IDENTITY_AMBIGUOUS");
  if (input.deploymentsInFlight > 1) blockers.push("MULTIPLE_DEPLOYMENTS_IN_FLIGHT");
  if (!input.rootCauseConfident) blockers.push("ROOT_CAUSE_AMBIGUOUS");
  if (input.releaseContainedIrreversibleChange) blockers.push("IRREVERSIBLE_CHANGE_IN_RELEASE");
  if (!input.databaseCompatibilityConfirmed) blockers.push("DATABASE_COMPATIBILITY_UNCERTAIN");
  if (!input.telemetryFresh) blockers.push("TELEMETRY_STALE_OR_UNAVAILABLE");

  return Object.freeze({
    eligible: blockers.length === 0,
    blockers: Object.freeze(blockers),
    primaryBlocker: blockers[0] ?? null,
    evidence: Object.freeze({
      severity: input.severity,
      lastKnownGoodDeploymentId: input.lastKnownGoodDeploymentId,
      failingDeploymentId: input.failingDeploymentId,
      deploymentsInFlight: input.deploymentsInFlight,
      priorAttempts: input.priorAttempts,
      policy: "AUTO_ROLLBACK.md",
    }),
  });
}

export const ROLLBACK_BLOCKER_EXPLANATIONS: Record<RollbackBlocker, string> = {
  EXECUTOR_NOT_CONNECTED:
    "No deployment provider adapter is connected, so SoftwareFactory cannot perform a rollback.",
  OWNER_APPROVAL_REQUIRED: "Rollback is a RED action and needs explicit owner approval.",
  NO_LAST_KNOWN_GOOD: "No previous deployment qualifies as Last Known Good.",
  LAST_KNOWN_GOOD_NOT_VALIDATED:
    "The candidate previous deployment has no passing post-deploy validation.",
  ROOT_CAUSE_AMBIGUOUS: "The cause is not attributable with confidence to the current release.",
  DEPLOYMENT_IDENTITY_AMBIGUOUS: "The failing deployment cannot be identified exactly.",
  MULTIPLE_DEPLOYMENTS_IN_FLIGHT: "More than one deployment is in flight.",
  IRREVERSIBLE_CHANGE_IN_RELEASE:
    "The release included an irreversible data, auth, secret, DNS, or infrastructure change.",
  DATABASE_COMPATIBILITY_UNCERTAIN: "Schema or data compatibility with the previous release is unconfirmed.",
  TELEMETRY_STALE_OR_UNAVAILABLE: "Health signals are stale, missing, or inside a monitoring outage.",
  SEVERITY_BELOW_THRESHOLD: "The incident severity does not justify a production mutation.",
  ATTEMPT_LIMIT_REACHED: "The bounded rollback attempt limit was reached; this is now an owner decision.",
  OWNER_STOPPED_OPERATIONS: "The owner stopped autonomous operations for this organization.",
};

/**
 * The Phase 1E evaluation input. `executorConnected` is fixed false because no
 * deployment provider adapter exists; a rollback therefore always records a
 * blocked decision instead of mutating production.
 */
export const PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED = false;
