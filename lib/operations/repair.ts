import type { InvestigationConfidence } from "@/lib/operations/investigator";
import type { IncidentSeverity } from "@/lib/operations/types";
import type { RiskLevel } from "@/lib/risk";

/**
 * Self-healing eligibility.
 *
 * Phase 1E creates bounded repair work; it does not execute a fix. The gates
 * below exist so that when an execution worker is eventually connected, the
 * GREEN/YELLOW/RED policy cannot be bypassed by routing work through the
 * incident pipeline instead of the normal approval path.
 */

export const MAX_REPAIR_ATTEMPTS = 3;

export type RepairBlocker =
  | "WORKER_NOT_CONNECTED"
  | "ATTEMPT_LIMIT_REACHED"
  | "CONFIDENCE_TOO_LOW"
  | "RED_REQUIRES_OWNER_APPROVAL"
  | "ABOVE_RISK_CEILING"
  | "OWNER_STOPPED_OPERATIONS"
  | "NO_DIAGNOSIS";

export interface RepairEligibilityInput {
  readonly severity: IncidentSeverity;
  readonly hasDiagnosis: boolean;
  readonly confidence: InvestigationConfidence | null;
  readonly risk: RiskLevel;
  readonly maximumAutonomousRisk: RiskLevel;
  readonly priorAttempts: number;
  readonly ownerApproved: boolean;
  readonly operationsStopped: boolean;
  /** Whether a code-execution worker (Phase 1C) is connected. */
  readonly workerConnected: boolean;
}

export interface RepairEligibility {
  /** True only when a worker could safely be handed the work. */
  readonly executable: boolean;
  /** True when repair work should be created for a human to pick up. */
  readonly workCreatable: boolean;
  readonly blockers: readonly RepairBlocker[];
  readonly escalateToOwner: boolean;
}

const RISK_RANK: Record<RiskLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export function evaluateRepairEligibility(
  input: RepairEligibilityInput,
): RepairEligibility {
  const blockers: RepairBlocker[] = [];

  if (!input.workerConnected) blockers.push("WORKER_NOT_CONNECTED");
  if (!input.hasDiagnosis) blockers.push("NO_DIAGNOSIS");
  if (input.priorAttempts >= MAX_REPAIR_ATTEMPTS) blockers.push("ATTEMPT_LIMIT_REACHED");
  if (input.operationsStopped) blockers.push("OWNER_STOPPED_OPERATIONS");
  if (input.confidence === "low" || input.confidence === null) blockers.push("CONFIDENCE_TOO_LOW");
  if (input.risk === "RED" && !input.ownerApproved) blockers.push("RED_REQUIRES_OWNER_APPROVAL");
  if (RISK_RANK[input.risk] > RISK_RANK[input.maximumAutonomousRisk]) {
    blockers.push("ABOVE_RISK_CEILING");
  }

  const attemptLimitReached = input.priorAttempts >= MAX_REPAIR_ATTEMPTS;

  return Object.freeze({
    executable: blockers.length === 0,
    // Repair work is still worth creating for a human when the only thing
    // missing is the worker itself. It is not worth creating once attempts are
    // exhausted or the owner has stopped operations.
    workCreatable: input.hasDiagnosis && !attemptLimitReached && !input.operationsStopped,
    blockers: Object.freeze(blockers),
    escalateToOwner: attemptLimitReached || input.severity === "sev1",
  });
}

export const REPAIR_BLOCKER_EXPLANATIONS: Record<RepairBlocker, string> = {
  WORKER_NOT_CONNECTED: "No code-execution worker is connected, so the fix cannot be produced automatically.",
  ATTEMPT_LIMIT_REACHED: `Repair attempts are bounded at ${MAX_REPAIR_ATTEMPTS}; this now needs an owner decision.`,
  CONFIDENCE_TOO_LOW: "The diagnosis confidence is too low to act on automatically.",
  RED_REQUIRES_OWNER_APPROVAL: "The proposed repair is RED and requires explicit owner approval.",
  ABOVE_RISK_CEILING: "The proposed repair exceeds the project's configured risk ceiling.",
  OWNER_STOPPED_OPERATIONS: "The owner stopped autonomous operations for this organization.",
  NO_DIAGNOSIS: "No diagnosis exists yet, so there is nothing specific to repair.",
};

/** Phase 1C is Not Connected, so no worker can be handed repair work. */
export const PHASE_1E_REPAIR_WORKER_CONNECTED = false;
