import "server-only";

import {
  FROZEN_POLICIES,
  FROZEN_POLICY_DETAIL,
  type FrozenPolicy,
} from "@/lib/graph/frozen";

/**
 * The frozen constitution, as it applies to the factory changing itself.
 *
 * `lib/graph/frozen.ts` already froze these ten policies against a *planner*:
 * a graph that would, given the chance, route around the thing stopping it.
 * Phase 3 introduces a second actor with the same incentive and more reach — a
 * self-improvement proposal, which edits the repository rather than a plan.
 *
 * The policies are deliberately not restated here. They are imported, so there
 * is exactly one list in the codebase and no way for the two to drift into
 * disagreeing about what is frozen. What this module adds is the part a
 * self-improving system needs and a planner does not:
 *
 * 1. **A version.** The brief requires the frozen rules be "stored
 *    separately/versioned". Without a version, "the constitution changed" is
 *    unprovable after the fact, and an improvement that quietly widened its own
 *    limits looks identical to one that did not.
 * 2. **A subject that is a diff, not an intent.** A planner declares what it
 *    means to do. A self-change *is* what it does, so the check has to read the
 *    proposal's actual effects.
 * 3. **A refusal that cannot be scored away.** The specific failure this
 *    guards is a system that improves its own health number by editing what the
 *    number measures.
 */

/**
 * Bump only with explicit owner approval, and never in the same change as a
 * self-improvement. A constitution that can be amended by the thing it
 * constrains is not a constraint.
 */
export const FROZEN_CONSTITUTION_VERSION = "phase3-constitution-v1";

/**
 * A stable fingerprint of the frozen set. Recorded alongside every proposal
 * verdict so a later audit can tell whether a proposal was judged under the
 * same rules that exist now — the question "was this approved under weaker
 * rules?" is otherwise unanswerable.
 */
export function frozenPolicyFingerprint(): string {
  return [...FROZEN_POLICIES].sort().join("|");
}

/** Paths whose contents define the factory's own limits. */
const CONSTITUTIONAL_PATHS: readonly RegExp[] = [
  /^lib\/graph\/frozen\.ts$/,
  /^lib\/improvement\/constitution\.ts$/,
  /^lib\/autonomy\/controls\.ts$/,
  /^lib\/autonomy\/approval\.ts$/,
  /^lib\/autonomy\/diff-risk\.ts$/,
  /^lib\/autonomy\/gates\.ts$/,
  /^policies\//,
];

/**
 * Paths that define how the factory measures itself.
 *
 * Separated from the constitution because the failure mode is different and
 * more insidious. Editing a policy is a visible loosening. Editing the
 * *measurement* leaves every policy intact and simply makes the score go up —
 * Goodhart's law with commit access. A proposal may not both change how health
 * is computed and claim a health improvement as its benefit.
 */
const MEASUREMENT_PATHS: readonly RegExp[] = [
  /^lib\/improvement\/(metrics|baseline|health)\.ts$/,
  /^lib\/graph\/optimizer\.ts$/,
];

export type ConstitutionRefusalCode =
  | "EDITS_FROZEN_POLICY"
  | "EDITS_OWN_MEASUREMENT"
  | "WEAKENS_RISK_CLASSIFICATION"
  | "SELF_APPROVES"
  | "WRITES_OUTSIDE_ISOLATED_BRANCH"
  | "SKIPS_MANDATORY_GATE"
  | "SELF_IMPROVEMENT_DISABLED"
  | "EMERGENCY_STOP_ACTIVE";

/** What a self-improvement proposal actually does, not what it intends. */
export interface ImprovementProposalEffects {
  /** Repository-relative paths the proposal's diff touches. */
  readonly changedPaths: readonly string[];
  /** Metric the proposal claims it will improve, if any. */
  readonly claimedBenefitMetric: string | null;
  /** Risk the diff classifier assigned to the actual diff. */
  readonly classifiedRisk: "GREEN" | "YELLOW" | "RED";
  /** Whether an owner has approved, for a RED proposal. */
  readonly ownerApproved: boolean;
  /** Identity that produced the change, and the identity that reviewed it. */
  readonly implementedBy: string;
  readonly reviewedBy: string | null;
  readonly headBranch: string;
  readonly gatesSatisfied: readonly string[];
  readonly requiredGates: readonly string[];
  readonly selfImprovementEnabled: boolean;
  readonly emergencyStopActive: boolean;
}

export interface ConstitutionViolation {
  readonly code: ConstitutionRefusalCode;
  readonly policy: FrozenPolicy | null;
  readonly detail: string;
}

export interface ConstitutionVerdict {
  readonly allowed: boolean;
  readonly constitutionVersion: typeof FROZEN_CONSTITUTION_VERSION;
  readonly policyFingerprint: string;
  readonly violations: readonly ConstitutionViolation[];
}

function matchesAny(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

/**
 * Judge a self-improvement proposal against the frozen constitution.
 *
 * Every refusal is named. There is no override parameter, deliberately: the
 * value of this gate is that a caller cannot discover a way through it.
 */
export function assertImprovementRespectsConstitution(
  effects: ImprovementProposalEffects,
): ConstitutionVerdict {
  const violations: ConstitutionViolation[] = [];
  const add = (
    code: ConstitutionRefusalCode,
    policy: FrozenPolicy | null,
    detail: string,
  ) => violations.push({ code, detail, policy });

  if (effects.emergencyStopActive) {
    add(
      "EMERGENCY_STOP_ACTIVE",
      "EMERGENCY_STOP",
      FROZEN_POLICY_DETAIL.EMERGENCY_STOP,
    );
  }

  if (!effects.selfImprovementEnabled) {
    add(
      "SELF_IMPROVEMENT_DISABLED",
      null,
      "Self-improvement is switched off, which is a complete stop rather than a preference.",
    );
  }

  const constitutionalEdits = effects.changedPaths.filter((path) =>
    matchesAny(path, CONSTITUTIONAL_PATHS),
  );
  if (constitutionalEdits.length > 0) {
    add(
      "EDITS_FROZEN_POLICY",
      "OWNER_REQUIRED_ACTIONS",
      `A self-improvement may not edit the rules that constrain it: ${constitutionalEdits.join(", ")}. An owner may make this change; the factory may not make it about itself.`,
    );
  }

  // The specific trap: change what the score measures, then report a better
  // score. Editing measurement is allowed; editing measurement *and* claiming
  // the resulting number as the benefit is not.
  const measurementEdits = effects.changedPaths.filter((path) =>
    matchesAny(path, MEASUREMENT_PATHS),
  );
  if (measurementEdits.length > 0 && effects.claimedBenefitMetric !== null) {
    add(
      "EDITS_OWN_MEASUREMENT",
      null,
      `This proposal changes how the factory measures itself (${measurementEdits.join(", ")}) while claiming "${effects.claimedBenefitMetric}" as its benefit. Improving the measurement and improving the thing measured must be separate changes.`,
    );
  }

  if (effects.classifiedRisk === "RED" && !effects.ownerApproved) {
    add(
      "WEAKENS_RISK_CLASSIFICATION",
      "RED_REQUIRES_OWNER_APPROVAL",
      FROZEN_POLICY_DETAIL.RED_REQUIRES_OWNER_APPROVAL,
    );
  }

  if (effects.reviewedBy === null || effects.reviewedBy === effects.implementedBy) {
    add(
      "SELF_APPROVES",
      "NO_SELF_APPROVAL",
      FROZEN_POLICY_DETAIL.NO_SELF_APPROVAL,
    );
  }

  if (!/^(factory|softwarefactory)\//.test(effects.headBranch)) {
    add(
      "WRITES_OUTSIDE_ISOLATED_BRANCH",
      "DRAFT_PR_ONLY",
      `${FROZEN_POLICY_DETAIL.DRAFT_PR_ONLY} Branch "${effects.headBranch}" is not an isolated factory branch.`,
    );
  }

  const satisfied = new Set(effects.gatesSatisfied);
  const missing = effects.requiredGates.filter((gate) => !satisfied.has(gate));
  if (missing.length > 0) {
    // A missing gate is a blocker, never a pass — the same rule Phase 1D
    // applies, restated here so a self-change cannot be the exception.
    add(
      "SKIPS_MANDATORY_GATE",
      "BRANCH_PROTECTIONS",
      `Required gates not satisfied: ${missing.join(", ")}.`,
    );
  }

  return Object.freeze({
    allowed: violations.length === 0,
    constitutionVersion: FROZEN_CONSTITUTION_VERSION,
    policyFingerprint: frozenPolicyFingerprint(),
    violations: Object.freeze(violations),
  });
}
