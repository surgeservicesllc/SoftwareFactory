import { FROZEN_POLICIES, FROZEN_POLICY_DETAIL } from "@/lib/graph/frozen";

/**
 * The factory constitution: the frozen policies, versioned, applied to any
 * actor — including the one Phase 3 introduces, a self-improvement proposal.
 *
 * `lib/graph/frozen.ts` remains the door for graph *plans*; this module is
 * the general form. Phase 3 goal 30 names the gap it closes: a factory that
 * measures and improves itself will, given the chance, propose improving the
 * constraints that score it. So the constitution is a *versioned subject* —
 * a proposal is checked against a named version, the check records which
 * version judged it, and the one move that is never legal, for any actor at
 * any risk level, is modifying the constitution to improve one's own score.
 *
 * The factory-level policies extend the graph list with the three rules that
 * exist above any single plan:
 *
 * - **NO_PAID_TOKEN_DEPENDENCY** — the zero-token rule. Normal operation
 *   spends no funded API tokens; a proposal that adds a paid dependency is
 *   refused regardless of the improvement it predicts.
 * - **APPEND_ONLY_EVIDENCE** — audit trails are immutable. A proposal that
 *   edits or deletes recorded evidence would let the factory improve its
 *   score by rewriting its history.
 * - **CONSTITUTION_IMMUTABLE_TO_SUBJECTS** — no actor may modify the
 *   constitution that judges it. Changing these policies is an owner
 *   decision made outside any self-improvement loop.
 */

export const CONSTITUTION_VERSION = "factory-constitution-v1" as const;

export const FACTORY_POLICIES = [
  ...FROZEN_POLICIES,
  "NO_PAID_TOKEN_DEPENDENCY",
  "APPEND_ONLY_EVIDENCE",
  "CONSTITUTION_IMMUTABLE_TO_SUBJECTS",
] as const;
export type FactoryPolicy = (typeof FACTORY_POLICIES)[number];

export const FACTORY_POLICY_DETAIL: Readonly<Record<FactoryPolicy, string>> = Object.freeze({
  ...FROZEN_POLICY_DETAIL,
  NO_PAID_TOKEN_DEPENDENCY:
    "Normal operation spends no funded API tokens. Workers authenticate with owner subscriptions; a paid path must name itself, and no proposal may add one.",
  APPEND_ONLY_EVIDENCE:
    "Activity, decision, and scheduling evidence is append-only. History is never edited to improve a score.",
  CONSTITUTION_IMMUTABLE_TO_SUBJECTS:
    "No actor may modify the constitution that judges it. Changing these policies is an owner decision made outside any improvement loop.",
});

/** The actors the constitution judges. Every new autonomous surface joins this list. */
export const CONSTITUTION_SUBJECTS = [
  "graph_plan",
  "self_improvement_proposal",
  "worker_run",
  "portfolio_control",
] as const;
export type ConstitutionSubject = (typeof CONSTITUTION_SUBJECTS)[number];

export type SubjectIntent = {
  readonly subject: ConstitutionSubject;
  readonly declaredRisk: "GREEN" | "YELLOW" | "RED";
  readonly classifiedRisk: "GREEN" | "YELLOW" | "RED";
  readonly skipsOwnerApproval: boolean;
  readonly writesOutsideDraftPr: boolean;
  readonly disablesRls: boolean;
  readonly verifierIsImplementer: boolean;
  readonly emergencyStopActive: boolean;
  /** The three moves only a self-measuring actor can attempt. */
  readonly modifiesConstitution: boolean;
  readonly addsPaidTokenDependency: boolean;
  readonly editsRecordedEvidence: boolean;
};

export type ConstitutionViolation = {
  readonly policy: FactoryPolicy;
  readonly detail: string;
};

export type ConstitutionCheck = {
  readonly version: typeof CONSTITUTION_VERSION;
  readonly subject: ConstitutionSubject;
  readonly allowed: boolean;
  readonly violations: readonly ConstitutionViolation[];
};

const RISK_ORDER = { GREEN: 0, YELLOW: 1, RED: 2 } as const;

/**
 * The one door, and it has no override parameter. The result names the
 * version that judged the intent, so an improvement ledger can record not
 * just that a proposal was allowed but under which constitution.
 */
export function checkIntentAgainstConstitution(intent: SubjectIntent): ConstitutionCheck {
  const violations: ConstitutionViolation[] = [];
  const add = (policy: FactoryPolicy, detail: string) => violations.push({ policy, detail });

  if (intent.emergencyStopActive) {
    add("EMERGENCY_STOP", "The emergency stop is active, which outranks every subject and every intent.");
  }

  if (intent.modifiesConstitution) {
    add(
      "CONSTITUTION_IMMUTABLE_TO_SUBJECTS",
      `A ${intent.subject} may not modify the constitution that judges it, whatever improvement it predicts.`,
    );
  }

  if (intent.addsPaidTokenDependency) {
    add(
      "NO_PAID_TOKEN_DEPENDENCY",
      "The intent adds a funded-token dependency to normal operation.",
    );
  }

  if (intent.editsRecordedEvidence) {
    add(
      "APPEND_ONLY_EVIDENCE",
      "The intent edits or deletes recorded evidence. History is not a score to optimise.",
    );
  }

  if (RISK_ORDER[intent.declaredRisk] < RISK_ORDER[intent.classifiedRisk]) {
    add(
      "RED_REQUIRES_OWNER_APPROVAL",
      `Intent declared ${intent.declaredRisk} for work classified ${intent.classifiedRisk}. Risk is not the subject's to lower.`,
    );
  }

  if (intent.classifiedRisk === "RED" && intent.skipsOwnerApproval) {
    add("RED_REQUIRES_OWNER_APPROVAL", "RED work cannot proceed without explicit owner approval.");
  }

  if (intent.skipsOwnerApproval && intent.classifiedRisk !== "GREEN") {
    add("OWNER_REQUIRED_ACTIONS", "Only GREEN work may proceed without an owner in the loop.");
  }

  if (intent.writesOutsideDraftPr) {
    add("DRAFT_PR_ONLY", "The intent writes outside the isolated branch and draft pull request path.");
  }

  if (intent.disablesRls) {
    add("RLS_REQUIRED", "The intent disables Row Level Security.");
  }

  if (intent.verifierIsImplementer) {
    add("NO_SELF_APPROVAL", "The intent has an actor verifying its own work.");
  }

  return {
    version: CONSTITUTION_VERSION,
    subject: intent.subject,
    allowed: violations.length === 0,
    violations,
  };
}
