/**
 * Phase 1 risk policy for actions proposed to the Software Factory.
 *
 * This module only answers whether an action satisfies the configured policy
 * gates. An `AUTHORIZED` result must never be interpreted as proof that an
 * action ran, succeeded, or was audited.
 */

export const RISK_LEVELS = ["GREEN", "YELLOW", "RED"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface RiskDefinition {
  readonly rank: number;
  readonly description: string;
  readonly enhancedValidationRequired: boolean;
  readonly ownerApprovalRequired: boolean;
}

export const RISK_DEFINITIONS = Object.freeze({
  GREEN: Object.freeze({
    rank: 0,
    description: "Low-risk, easily reversible changes.",
    enhancedValidationRequired: false,
    ownerApprovalRequired: false,
  }),
  YELLOW: Object.freeze({
    rank: 1,
    description:
      "Meaningful but testable and reversible changes requiring enhanced validation.",
    enhancedValidationRequired: true,
    ownerApprovalRequired: false,
  }),
  RED: Object.freeze({
    rank: 2,
    description:
      "High-impact actions involving money, destructive production data, secrets, authentication or security controls, DNS or domain ownership, or similarly sensitive operations.",
    enhancedValidationRequired: true,
    ownerApprovalRequired: true,
  }),
} satisfies Record<RiskLevel, RiskDefinition>);

/**
 * Factors are intentionally explicit. Callers should present every applicable
 * factor; classification always selects the highest resulting risk level.
 */
export const RISK_FACTORS = Object.freeze({
  "documentation-only": "GREEN",
  "test-only": "GREEN",
  "isolated-reversible-ui": "GREEN",
  "non-production-tooling": "GREEN",
  "application-behavior": "YELLOW",
  "dependency-change": "YELLOW",
  "non-destructive-schema-change": "YELLOW",
  "reversible-production-configuration": "YELLOW",
  "cross-component-change": "YELLOW",
  "safety-relevant-memory": "YELLOW",
  "money-or-billing": "RED",
  "destructive-production-data": "RED",
  "secrets-or-credentials": "RED",
  "authentication-or-security-controls": "RED",
  "dns-or-domain-ownership": "RED",
  "privileged-access": "RED",
  "irreversible-production-change": "RED",
} satisfies Record<string, RiskLevel>);

export type RiskFactor = keyof typeof RISK_FACTORS;

export interface RiskClassification {
  readonly level: RiskLevel;
  readonly factors: readonly RiskFactor[];
  /** True when missing context caused the safe YELLOW fallback. */
  readonly defaulted: boolean;
}

export function isRiskLevel(value: unknown): value is RiskLevel {
  return (
    typeof value === "string" &&
    (RISK_LEVELS as readonly string[]).includes(value)
  );
}

export function compareRisk(left: RiskLevel, right: RiskLevel): number {
  return RISK_DEFINITIONS[left].rank - RISK_DEFINITIONS[right].rank;
}

export function isWithinRiskCeiling(
  risk: RiskLevel,
  maximumAuthorizedRisk: RiskLevel,
): boolean {
  return compareRisk(risk, maximumAuthorizedRisk) <= 0;
}

/**
 * Classify a proposed action from concrete signals. Empty input deliberately
 * defaults to YELLOW: lack of classification evidence is not evidence of low
 * risk.
 */
export function classifyRisk(
  factors: readonly RiskFactor[],
): RiskClassification {
  const uniqueFactors = [...new Set(factors)];

  if (uniqueFactors.length === 0) {
    return Object.freeze({
      level: "YELLOW",
      factors: Object.freeze([]) as readonly RiskFactor[],
      defaulted: true,
    });
  }

  const level = uniqueFactors.reduce<RiskLevel>((highest, factor) => {
    const factorLevel = RISK_FACTORS[factor];
    return compareRisk(factorLevel, highest) > 0 ? factorLevel : highest;
  }, "GREEN");

  return Object.freeze({
    level,
    factors: Object.freeze(uniqueFactors),
    defaulted: false,
  });
}

export type ValidationStatus = "NOT_RUN" | "PASSED" | "FAILED";
export type OwnerApprovalStatus =
  | "NOT_REQUESTED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export type RiskAuthorizationDecision =
  | "AUTHORIZED"
  | "AUTONOMOUS_MODE_OFF"
  | "ABOVE_RISK_CEILING"
  | "ENHANCED_VALIDATION_REQUIRED"
  | "VALIDATION_FAILED"
  | "OWNER_APPROVAL_REQUIRED"
  | "OWNER_APPROVAL_REJECTED";

export interface RiskAuthorizationRequest {
  readonly risk: RiskLevel;
  readonly maximumAuthorizedRisk: RiskLevel;
  readonly autonomousMode: boolean;
  readonly validationStatus?: ValidationStatus;
  readonly ownerApprovalStatus?: OwnerApprovalStatus;
}

export interface RiskAuthorizationResult {
  readonly authorized: boolean;
  readonly decision: RiskAuthorizationDecision;
  readonly reason: string;
  readonly enhancedValidationRequired: boolean;
  readonly ownerApprovalRequired: boolean;
}

function result(
  risk: RiskLevel,
  decision: RiskAuthorizationDecision,
  reason: string,
): RiskAuthorizationResult {
  return Object.freeze({
    authorized: decision === "AUTHORIZED",
    decision,
    reason,
    enhancedValidationRequired:
      RISK_DEFINITIONS[risk].enhancedValidationRequired,
    ownerApprovalRequired: RISK_DEFINITIONS[risk].ownerApprovalRequired,
  });
}

/**
 * Evaluate the Phase 1 policy gates in their non-bypassable order.
 *
 * Owner approval does not override autonomous mode, the configured risk
 * ceiling, or failed/missing validation. In particular, RED always requires an
 * explicit APPROVED status even when the maximum authorized risk is RED.
 */
export function evaluateRiskAuthorization({
  risk,
  maximumAuthorizedRisk,
  autonomousMode,
  validationStatus = "NOT_RUN",
  ownerApprovalStatus = "NOT_REQUESTED",
}: RiskAuthorizationRequest): RiskAuthorizationResult {
  if (!autonomousMode) {
    return result(
      risk,
      "AUTONOMOUS_MODE_OFF",
      "Autonomous mode is off; no autonomous action is authorized.",
    );
  }

  if (!isWithinRiskCeiling(risk, maximumAuthorizedRisk)) {
    return result(
      risk,
      "ABOVE_RISK_CEILING",
      `${risk} exceeds the configured ${maximumAuthorizedRisk} risk ceiling.`,
    );
  }

  if (RISK_DEFINITIONS[risk].ownerApprovalRequired) {
    if (ownerApprovalStatus === "REJECTED") {
      return result(
        risk,
        "OWNER_APPROVAL_REJECTED",
        "The owner rejected this RED action.",
      );
    }

    if (ownerApprovalStatus !== "APPROVED") {
      return result(
        risk,
        "OWNER_APPROVAL_REQUIRED",
        "RED actions require explicit owner approval in Phase 1.",
      );
    }
  }

  if (RISK_DEFINITIONS[risk].enhancedValidationRequired) {
    if (validationStatus === "FAILED") {
      return result(
        risk,
        "VALIDATION_FAILED",
        "Enhanced validation failed; the action is blocked.",
      );
    }

    if (validationStatus !== "PASSED") {
      return result(
        risk,
        "ENHANCED_VALIDATION_REQUIRED",
        `${risk} actions require enhanced validation to pass.`,
      );
    }
  }

  return result(
    risk,
    "AUTHORIZED",
    "The action satisfies the configured Phase 1 risk gates.",
  );
}
