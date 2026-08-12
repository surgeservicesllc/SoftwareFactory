import type { RiskLevel } from "@/lib/risk";

import { PHASE_1D_SAFETY_DEFAULTS } from "@/lib/constants";

export const PHASE_1D_POLICY_VERSION = "phase1d-observation-v1";

export type AutonomyObservationBlocker =
  | "AUTONOMOUS_MODE_OFF"
  | "NON_GREEN_RISK"
  | "PROTECTED_RESOURCE"
  | "EVIDENCE_MISSING_OR_STALE"
  | "REQUIRED_CHECKS_NOT_PASSING"
  | "OWNER_ATTENTION_REQUIRED";

export type AutonomyExecutionBlocker =
  | "GLOBAL_KILL_SWITCH_ACTIVE"
  | "OBSERVATION_ONLY"
  | "EXECUTOR_NOT_CONNECTED";

export interface AutonomyObservationRequest {
  readonly autonomousMode: boolean;
  readonly risk: RiskLevel;
  readonly protectedResourceTouched: boolean;
  readonly evidenceFresh: boolean;
  readonly requiredChecksPassing: boolean;
  readonly ownerAttentionRequired: boolean;
}

export interface AutonomyObservationResult {
  readonly policyVersion: typeof PHASE_1D_POLICY_VERSION;
  /** A hypothetical GREEN policy result only; never an execution grant. */
  readonly observationEligible: boolean;
  readonly observationDecision: "WOULD_BE_ELIGIBLE" | "BLOCKED";
  readonly observationBlockers: readonly AutonomyObservationBlocker[];
  readonly executionAllowed: false;
  readonly executionBlockers: readonly AutonomyExecutionBlocker[];
}

/**
 * Evaluate the observation-only Phase 1D prerequisites without performing or
 * authorizing any external action. The hard execution interlocks are returned
 * separately so a hypothetical policy result cannot be mistaken for runtime
 * authority.
 */
export function evaluateAutonomyObservation({
  autonomousMode,
  risk,
  protectedResourceTouched,
  evidenceFresh,
  requiredChecksPassing,
  ownerAttentionRequired,
}: AutonomyObservationRequest): AutonomyObservationResult {
  const observationBlockers: AutonomyObservationBlocker[] = [];

  if (!autonomousMode) observationBlockers.push("AUTONOMOUS_MODE_OFF");
  if (risk !== "GREEN") observationBlockers.push("NON_GREEN_RISK");
  if (protectedResourceTouched) observationBlockers.push("PROTECTED_RESOURCE");
  if (!evidenceFresh) observationBlockers.push("EVIDENCE_MISSING_OR_STALE");
  if (!requiredChecksPassing) {
    observationBlockers.push("REQUIRED_CHECKS_NOT_PASSING");
  }
  if (ownerAttentionRequired) {
    observationBlockers.push("OWNER_ATTENTION_REQUIRED");
  }

  const observationEligible = observationBlockers.length === 0;
  const executionBlockers: AutonomyExecutionBlocker[] = [];
  if (PHASE_1D_SAFETY_DEFAULTS.globalKillSwitchActive) {
    executionBlockers.push("GLOBAL_KILL_SWITCH_ACTIVE");
  }
  if (PHASE_1D_SAFETY_DEFAULTS.observationOnly) {
    executionBlockers.push("OBSERVATION_ONLY");
  }
  if (!PHASE_1D_SAFETY_DEFAULTS.executorConnected) {
    executionBlockers.push("EXECUTOR_NOT_CONNECTED");
  }

  return Object.freeze({
    policyVersion: PHASE_1D_POLICY_VERSION,
    observationEligible,
    observationDecision: observationEligible ? "WOULD_BE_ELIGIBLE" : "BLOCKED",
    observationBlockers: Object.freeze(observationBlockers),
    executionAllowed: false,
    executionBlockers: Object.freeze(executionBlockers),
  });
}
