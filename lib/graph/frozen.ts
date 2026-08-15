/**
 * Frozen policies.
 *
 * A planner optimising for completion will, given the chance, route around the
 * thing stopping it. That is not misbehaviour — it is what optimisation is. So
 * the constraints that exist precisely to stop completion are declared here and
 * made unreachable: the planner may choose topology, concurrency, models and
 * ordering, and it may not choose to need less approval, less isolation, or a
 * bigger budget than the owner set.
 *
 * This module is a list and a gate, deliberately boring. Its value is that
 * `assertPlanRespectsFrozenPolicies` is the only door, and it has no override
 * parameter for a caller to discover.
 */

export const FROZEN_POLICIES = [
  "RED_REQUIRES_OWNER_APPROVAL",
  "RLS_REQUIRED",
  "SECRETS_NEVER_IN_BROWSER_OR_LOGS",
  "PAYMENT_PROTECTIONS",
  "BRANCH_PROTECTIONS",
  "MAX_BUDGET",
  "EMERGENCY_STOP",
  "OWNER_REQUIRED_ACTIONS",
  "DRAFT_PR_ONLY",
  "NO_SELF_APPROVAL",
] as const;
export type FrozenPolicy = (typeof FROZEN_POLICIES)[number];

export const FROZEN_POLICY_DETAIL: Readonly<Record<FrozenPolicy, string>> = Object.freeze({
  RED_REQUIRES_OWNER_APPROVAL:
    "A RED-classified change requires explicit owner approval. No graph may downgrade its own risk to avoid this.",
  RLS_REQUIRED:
    "Row Level Security stays enabled and forced on every exposed table. No node may disable it for convenience.",
  SECRETS_NEVER_IN_BROWSER_OR_LOGS:
    "Credentials never enter browser code, prompts, logs, fixtures, database rows, or source control.",
  PAYMENT_PROTECTIONS: "Spending money at a provider requires the owner execution switch to be on.",
  BRANCH_PROTECTIONS: "Branch protection is never inferred as satisfied and never bypassed.",
  MAX_BUDGET: "The owner's budget ceiling cannot be raised by the planner to finish a graph.",
  EMERGENCY_STOP: "The kill switch and emergency stop outrank every control and every plan.",
  OWNER_REQUIRED_ACTIONS: "Merge, deploy, and rollback remain owner-gated in this phase.",
  DRAFT_PR_ONLY: "The only repository write path is an isolated branch, commit, and draft pull request.",
  NO_SELF_APPROVAL: "An implementation agent can never approve or verify its own work.",
});

export type PlanIntent = {
  /** Risk the planner assigned. Compared against the classifier's answer. */
  readonly declaredRisk: "GREEN" | "YELLOW" | "RED";
  readonly classifiedRisk: "GREEN" | "YELLOW" | "RED";
  readonly requestedBudget: { readonly maxCostMicros?: number; readonly maxNodes: number };
  readonly ownerBudget: { readonly maxCostMicros?: number; readonly maxNodes: number };
  readonly skipsOwnerApproval: boolean;
  readonly writesOutsideDraftPr: boolean;
  readonly disablesRls: boolean;
  readonly verifierIsImplementer: boolean;
  readonly emergencyStopActive: boolean;
};

export type FrozenViolation = {
  readonly policy: FrozenPolicy;
  readonly detail: string;
};

export type FrozenPolicyCheck = {
  readonly allowed: boolean;
  readonly violations: readonly FrozenViolation[];
};

const RISK_ORDER = { GREEN: 0, YELLOW: 1, RED: 2 } as const;

export function assertPlanRespectsFrozenPolicies(intent: PlanIntent): FrozenPolicyCheck {
  const violations: FrozenViolation[] = [];

  const add = (policy: FrozenPolicy, detail: string) =>
    violations.push({ policy, detail });

  if (intent.emergencyStopActive) {
    add("EMERGENCY_STOP", "The emergency stop is active, which outranks any plan.");
  }

  // Declaring a lower risk than the classifier found is the specific move that
  // would let a plan slip past the approval it needs.
  if (RISK_ORDER[intent.declaredRisk] < RISK_ORDER[intent.classifiedRisk]) {
    add(
      "RED_REQUIRES_OWNER_APPROVAL",
      `Plan declared ${intent.declaredRisk} for work classified ${intent.classifiedRisk}. Risk is not the planner's to lower.`,
    );
  }

  if (intent.classifiedRisk === "RED" && intent.skipsOwnerApproval) {
    add("RED_REQUIRES_OWNER_APPROVAL", "RED work cannot proceed without explicit owner approval.");
  }

  if (intent.skipsOwnerApproval && intent.classifiedRisk !== "GREEN") {
    add("OWNER_REQUIRED_ACTIONS", "Only GREEN work may proceed without an owner in the loop.");
  }

  if (intent.writesOutsideDraftPr) {
    add("DRAFT_PR_ONLY", "The plan writes outside the isolated branch and draft pull request path.");
  }

  if (intent.disablesRls) {
    add("RLS_REQUIRED", "The plan disables Row Level Security.");
  }

  if (intent.verifierIsImplementer) {
    add("NO_SELF_APPROVAL", "The plan has an agent verifying its own work.");
  }

  if (intent.requestedBudget.maxNodes > intent.ownerBudget.maxNodes) {
    add(
      "MAX_BUDGET",
      `Plan requested ${intent.requestedBudget.maxNodes} nodes against an owner ceiling of ${intent.ownerBudget.maxNodes}.`,
    );
  }

  const requestedCost = intent.requestedBudget.maxCostMicros;
  const ownerCost = intent.ownerBudget.maxCostMicros;
  if (requestedCost !== undefined && ownerCost !== undefined && requestedCost > ownerCost) {
    add("MAX_BUDGET", "Plan requested a cost ceiling above the owner's.");
  }

  return { allowed: violations.length === 0, violations };
}
