/**
 * Decide what a post-deploy validation record actually proves.
 *
 * Phase 1E stores validation evidence (`deployment_validations`) and Phase 1D
 * has to *act* on it. Those are different jobs: storage accepts whatever an
 * owner recorded, and this decides whether that record is evidence about the
 * deployment in front of us.
 *
 * The rule that shapes everything here is one sentence of
 * `policies/POST_DEPLOY_VALIDATION.md`:
 *
 * > Missing, stale, or mismatched deployment evidence produces `inconclusive`,
 * > never `passed`.
 *
 * So `passed` is only ever reached by exhausting every way of not reaching it.
 * There is no default-satisfied path: absence of evidence is `inconclusive`,
 * and `inconclusive` freezes automation rather than letting a run continue.
 */

export const VALIDATION_STAGES = [
  "identity",
  "availability",
  "data_integration",
  "quality_security",
  "observation",
] as const;

export type ValidationStage = (typeof VALIDATION_STAGES)[number];

export const STAGE_LABELS: Readonly<Record<ValidationStage, string>> = Object.freeze({
  identity: "Identity and readiness",
  availability: "Availability and smoke checks",
  data_integration: "Data and integration safety",
  quality_security: "Quality and security signals",
  observation: "Observation window",
});

/** The four outcomes the policy defines, matching `deployment_validation_state`. */
export type ValidationOutcome = "passed" | "failed" | "inconclusive" | "cancelled";

export type ValidationFinding =
  | "NO_EVIDENCE"
  | "EVIDENCE_INCOMPLETE"
  | "DEPLOYMENT_MISMATCH"
  | "COMMIT_MISMATCH"
  | "DEPLOYMENT_NOT_READY"
  | "VALIDATION_INCOMPLETE"
  | "EVIDENCE_STALE"
  | "REQUIRED_STAGE_MISSING"
  | "REQUIRED_CHECK_FAILED"
  | "REQUIRED_CHECK_UNKNOWN"
  | "OBSERVATION_WINDOW_INCOMPLETE"
  | "CANCELLED_BY_OWNER";

/** The deployment we are asking about, read from the provider now. */
export interface DeploymentIdentity {
  readonly projectId: string;
  readonly environment: "preview" | "production";
  readonly provider: string;
  readonly deploymentId: string;
  readonly commitSha: string;
  readonly url: string;
  /** True only when the provider reports a terminal ready state. */
  readonly ready: boolean;
}

export interface ValidationCheck {
  readonly stage: ValidationStage;
  readonly name: string;
  readonly required: boolean;
  readonly result: "pass" | "fail" | "unknown";
  readonly detail?: string;
}

/**
 * A validation record. Every field the policy's evidence requirements list is
 * present, because a record missing any of them cannot support `passed`.
 */
export interface ValidationEvidence {
  readonly projectId: string;
  readonly environment: "preview" | "production";
  readonly provider: string;
  readonly deploymentId: string;
  readonly commitSha: string;
  readonly url: string;
  readonly startedAt: string;
  /** Null while validation is still running. */
  readonly completedAt: string | null;
  readonly correlationId: string;
  readonly validatorVersion: string;
  readonly policyVersion: string;
  readonly baselineReference: string | null;
  readonly checks: readonly ValidationCheck[];
  /** Set when an owner or a kill switch stopped validation. */
  readonly cancelledBy?: string | null;
  readonly cancelledReason?: string | null;
  /** True only once the risk-proportional observation window has elapsed. */
  readonly observationWindowComplete?: boolean;
}

export interface PostDeployValidationRequest {
  readonly deployment: DeploymentIdentity;
  /** Null when nothing validated this deployment at all. */
  readonly evidence: ValidationEvidence | null;
  readonly now?: Date;
  /** Overrides the default staleness bound; exposed for tests and tuning. */
  readonly maximumEvidenceAgeMs?: number;
}

export interface PostDeployValidationResult {
  readonly outcome: ValidationOutcome;
  readonly findings: readonly ValidationFinding[];
  readonly reasons: readonly string[];
  /** Inconclusive freezes further automation, per the policy's Outcomes. */
  readonly freezeAutomation: boolean;
  readonly ownerAttentionRequired: boolean;
  /** A failed validation creates or updates an incident. */
  readonly openIncident: boolean;
  /**
   * A failed validation never authorizes rollback. It only means eligibility
   * has to be evaluated from fresh state under `AUTO_ROLLBACK.md`, which is a
   * separate decision this module deliberately does not make.
   */
  readonly rollbackEligibilityMustBeReevaluated: boolean;
  /** The deployment this decision was made about, for the audit record. */
  readonly evaluatedDeploymentId: string;
}

const REASONS: Readonly<Record<ValidationFinding, string>> = Object.freeze({
  NO_EVIDENCE: "No validation evidence exists for this deployment.",
  EVIDENCE_INCOMPLETE: "The validation record is missing required evidence fields.",
  DEPLOYMENT_MISMATCH: "The validation evidence describes a different deployment.",
  COMMIT_MISMATCH: "The validation evidence describes a different commit.",
  DEPLOYMENT_NOT_READY: "The provider does not report this deployment as ready.",
  VALIDATION_INCOMPLETE: "Validation has not finished.",
  EVIDENCE_STALE: "The validation evidence is too old to describe the current deployment.",
  REQUIRED_STAGE_MISSING: "A required validation stage reported no checks at all.",
  REQUIRED_CHECK_FAILED: "A required check breached policy.",
  REQUIRED_CHECK_UNKNOWN: "A required check could not be determined.",
  OBSERVATION_WINDOW_INCOMPLETE: "The observation window has not completed.",
  CANCELLED_BY_OWNER: "An owner or kill switch stopped validation.",
});

/** Twelve hours. Older evidence is not about what is serving now. */
export const MAXIMUM_EVIDENCE_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Stages every validation must cover, whatever the risk.
 *
 * The observation window's *duration* is proportional to risk, per the policy,
 * but its completion is required at every level: a GREEN release that has not
 * been watched at all has not been validated, it has merely been deployed.
 */
const REQUIRED_STAGES: readonly ValidationStage[] = VALIDATION_STAGES;

function isBlank(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function evidenceIsComplete(evidence: ValidationEvidence): boolean {
  return (
    !isBlank(evidence.projectId) &&
    !isBlank(evidence.provider) &&
    !isBlank(evidence.deploymentId) &&
    !isBlank(evidence.commitSha) &&
    !isBlank(evidence.url) &&
    !isBlank(evidence.startedAt) &&
    !isBlank(evidence.correlationId) &&
    !isBlank(evidence.validatorVersion) &&
    !isBlank(evidence.policyVersion)
  );
}

/**
 * Decide the outcome for one deployment.
 *
 * The order of the checks is the argument. Attribution comes first: evidence
 * that describes a different deployment is not evidence about this one, so it
 * can neither pass it nor fail it. Only once the record is known to be about
 * this deployment, complete, and finished do the check results get to speak —
 * and a single failed required check outranks any number of passes.
 */
export function evaluatePostDeployValidation(
  request: PostDeployValidationRequest,
): PostDeployValidationResult {
  const { deployment, evidence, now = new Date(), maximumEvidenceAgeMs = MAXIMUM_EVIDENCE_AGE_MS } =
    request;

  const findings: ValidationFinding[] = [];

  if (!evidence) {
    return conclude("inconclusive", ["NO_EVIDENCE"], deployment.deploymentId);
  }

  // Attribution, before anything the record claims about behavior.
  if (
    evidence.deploymentId !== deployment.deploymentId ||
    evidence.projectId !== deployment.projectId ||
    evidence.environment !== deployment.environment ||
    evidence.provider !== deployment.provider
  ) {
    findings.push("DEPLOYMENT_MISMATCH");
  }
  if (evidence.commitSha !== deployment.commitSha) findings.push("COMMIT_MISMATCH");

  if (findings.length > 0) {
    // Nothing else in the record can be trusted to be about this deployment.
    return conclude("inconclusive", findings, deployment.deploymentId);
  }

  if (!isBlank(evidence.cancelledBy)) {
    return conclude("cancelled", ["CANCELLED_BY_OWNER"], deployment.deploymentId);
  }

  if (!deployment.ready) findings.push("DEPLOYMENT_NOT_READY");
  if (!evidenceIsComplete(evidence)) findings.push("EVIDENCE_INCOMPLETE");

  const completedAt = evidence.completedAt;
  if (completedAt === null || completedAt.trim().length === 0) {
    findings.push("VALIDATION_INCOMPLETE");
  } else if (isStale(completedAt, now, maximumEvidenceAgeMs)) {
    findings.push("EVIDENCE_STALE");
  }

  if (findings.length > 0) {
    return conclude("inconclusive", findings, deployment.deploymentId);
  }

  // The record is about this deployment, complete, and finished. Now the checks.
  const required = evidence.checks.filter((check) => check.required);
  const coveredStages = new Set(required.map((check) => check.stage));
  const missingStages = REQUIRED_STAGES.filter((stage) => !coveredStages.has(stage));

  const failed = required.filter((check) => check.result === "fail");
  const unknown = required.filter((check) => check.result === "unknown");

  if (failed.length > 0) {
    // An attributable required check breached policy. That is a failure, not an
    // ambiguity — report it as one even if other checks are also unknown.
    return conclude("failed", ["REQUIRED_CHECK_FAILED"], deployment.deploymentId);
  }

  if (missingStages.length > 0) findings.push("REQUIRED_STAGE_MISSING");
  if (unknown.length > 0) findings.push("REQUIRED_CHECK_UNKNOWN");
  if (evidence.observationWindowComplete !== true) {
    findings.push("OBSERVATION_WINDOW_INCOMPLETE");
  }

  if (findings.length > 0) {
    return conclude("inconclusive", findings, deployment.deploymentId);
  }

  return conclude("passed", [], deployment.deploymentId);
}

function isStale(completedAt: string, now: Date, maximumAgeMs: number): boolean {
  const completed = Date.parse(completedAt);
  // An unparseable timestamp is not evidence of freshness.
  if (Number.isNaN(completed)) return true;
  return now.getTime() - completed > maximumAgeMs;
}

function conclude(
  outcome: ValidationOutcome,
  findings: readonly ValidationFinding[],
  deploymentId: string,
): PostDeployValidationResult {
  const unique = [...new Set(findings)];

  return Object.freeze({
    outcome,
    findings: Object.freeze(unique),
    reasons: Object.freeze(
      unique.length
        ? unique.map((finding) => REASONS[finding])
        : ["Every required check passed against matching, fresh evidence."],
    ),
    // Inconclusive freezes automation and asks for an owner; failed opens an
    // incident and sends the rollback question elsewhere; cancelled is already
    // an owner decision and only needs recording.
    freezeAutomation: outcome === "inconclusive",
    ownerAttentionRequired: outcome !== "passed",
    openIncident: outcome === "failed",
    rollbackEligibilityMustBeReevaluated: outcome === "failed",
    evaluatedDeploymentId: deploymentId,
  });
}

/** A one-line summary per finding, for an activity record or a report. */
export function describeValidation(result: PostDeployValidationResult): readonly string[] {
  return Object.freeze([
    `Outcome: ${result.outcome}.`,
    ...result.reasons,
  ]);
}
