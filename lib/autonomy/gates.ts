import { compareRisk, type RiskLevel } from "@/lib/risk";

/**
 * The gate sets a change has to clear before the loop may advance.
 *
 * GREEN is the base set. YELLOW adds to it rather than replacing it, so a
 * YELLOW change can never satisfy fewer checks than a GREEN one. RED inherits
 * the YELLOW set and additionally requires owner approval, which is decided in
 * `approval.ts` rather than here — a gate answers "was this verified", not
 * "is this allowed".
 */

export const GATES = [
  "tests",
  "lint",
  "typecheck",
  "build",
  "secret_scan",
  "diff_review",
  "ci",
  "preview_smoke",
  "security_review",
  "migration_review",
  "e2e",
  "rollback_validated",
] as const;

export type Gate = (typeof GATES)[number];

/** Gates every change must clear, whatever its risk. */
export const GREEN_GATES: readonly Gate[] = Object.freeze([
  "tests",
  "lint",
  "typecheck",
  "build",
  "secret_scan",
  "diff_review",
  "ci",
  "preview_smoke",
]);

/** Added on top of the GREEN set for YELLOW and RED. */
export const ENHANCED_GATES: readonly Gate[] = Object.freeze([
  "security_review",
  "migration_review",
  "e2e",
  "rollback_validated",
]);

export const GATE_LABELS: Readonly<Record<Gate, string>> = Object.freeze({
  tests: "Tests",
  lint: "Lint",
  typecheck: "Typecheck",
  build: "Production build",
  secret_scan: "Secret scan",
  diff_review: "Diff review",
  ci: "CI",
  preview_smoke: "Preview smoke test",
  security_review: "Security review",
  migration_review: "Migration review",
  e2e: "End-to-end tests",
  rollback_validated: "Validated rollback",
});

export type GateOutcome = "passed" | "failed" | "not_run" | "not_connected";

export interface GateResult {
  readonly gate: Gate;
  readonly outcome: GateOutcome;
  /** Why it reached that outcome. Required for anything that is not `passed`. */
  readonly detail?: string;
}

export type GateBlockerKind = "FAILED" | "NOT_RUN" | "NOT_CONNECTED";

export interface GateBlocker {
  readonly gate: Gate;
  readonly kind: GateBlockerKind;
  readonly detail: string;
}

export interface GateEvaluation {
  readonly risk: RiskLevel;
  readonly required: readonly Gate[];
  readonly satisfied: boolean;
  readonly blockers: readonly GateBlocker[];
  /** Required gates that passed, for the evidence record. */
  readonly passed: readonly Gate[];
}

/** The gates required at a given risk level. */
export function requiredGates(risk: RiskLevel): readonly Gate[] {
  return compareRisk(risk, "GREEN") > 0
    ? Object.freeze([...GREEN_GATES, ...ENHANCED_GATES])
    : GREEN_GATES;
}

const BLOCKER_DETAIL: Readonly<Record<GateBlockerKind, string>> = Object.freeze({
  FAILED: "reported a failure",
  NOT_RUN: "has not run",
  NOT_CONNECTED: "has no connected provider",
});

/**
 * Evaluate a set of gate results against the requirement for this risk level.
 *
 * A missing result is a blocker, not a pass. That is the whole point: the loop
 * must not advance because a check was never attempted, and `not_connected` is
 * kept distinct from `not_run` so the interface can say *why* — one is a
 * pending action, the other needs an owner to connect a provider.
 *
 * Results for gates that are not required at this level are ignored rather than
 * treated as failures, so running extra verification never blocks a change.
 */
export function evaluateGates(risk: RiskLevel, results: readonly GateResult[]): GateEvaluation {
  const required = requiredGates(risk);
  const byGate = new Map<Gate, GateResult>();
  for (const result of results) byGate.set(result.gate, result);

  const blockers: GateBlocker[] = [];
  const passed: Gate[] = [];

  for (const gate of required) {
    const result = byGate.get(gate);

    if (!result || result.outcome === "not_run") {
      blockers.push({ gate, kind: "NOT_RUN", detail: result?.detail ?? BLOCKER_DETAIL.NOT_RUN });
      continue;
    }
    if (result.outcome === "not_connected") {
      blockers.push({
        gate,
        kind: "NOT_CONNECTED",
        detail: result.detail ?? BLOCKER_DETAIL.NOT_CONNECTED,
      });
      continue;
    }
    if (result.outcome === "failed") {
      blockers.push({ gate, kind: "FAILED", detail: result.detail ?? BLOCKER_DETAIL.FAILED });
      continue;
    }
    passed.push(gate);
  }

  return Object.freeze({
    risk,
    required,
    satisfied: blockers.length === 0,
    blockers: Object.freeze(blockers),
    passed: Object.freeze(passed),
  });
}

/** One line per blocker, for an activity record or a PR reply. */
export function describeGateBlockers(evaluation: GateEvaluation): readonly string[] {
  return Object.freeze(
    evaluation.blockers.map((blocker) => `${GATE_LABELS[blocker.gate]} ${blocker.detail}`),
  );
}
