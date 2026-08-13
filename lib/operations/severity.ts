import type { IncidentSeverity, ProductionSignalKind } from "@/lib/operations/types";

/**
 * Severity classification for a qualifying production signal.
 *
 * This mirrors `public.classify_production_severity` so the UI can explain a
 * severity before it is stored, and so the rule is unit-testable. The database
 * remains the authority for what is actually written.
 */

export interface SeverityInput {
  readonly signalKind: ProductionSignalKind;
  /** The production surface is not serving its intended response at all. */
  readonly productionUnavailable: boolean;
  /** The failure is not confined to a subset of users or a single route. */
  readonly affectsAllUsers: boolean;
  /** The failure is attributable to a specific recent deployment. */
  readonly deploymentAttributed: boolean;
  readonly consecutiveFailures: number;
}

export interface SeverityClassification {
  readonly severity: IncidentSeverity;
  readonly reason: string;
}

const ALWAYS_SEVERE_KINDS: ReadonlySet<ProductionSignalKind> = new Set([
  "authentication",
  "database",
]);

const USER_FACING_KINDS: ReadonlySet<ProductionSignalKind> = new Set([
  "critical_route",
  "synthetic",
  "error_rate",
]);

export function classifyIncidentSeverity(input: SeverityInput): SeverityClassification {
  if (input.productionUnavailable && input.affectsAllUsers) {
    return {
      severity: "sev1",
      reason: "Production is unavailable for all users.",
    };
  }

  if (input.productionUnavailable) {
    return {
      severity: "sev2",
      reason: "Production is unavailable for part of the surface.",
    };
  }

  if (ALWAYS_SEVERE_KINDS.has(input.signalKind)) {
    return {
      severity: "sev2",
      reason: `A ${input.signalKind} failure blocks users from working even while pages render.`,
    };
  }

  if (input.deploymentAttributed && input.consecutiveFailures >= 2) {
    return {
      severity: "sev2",
      reason: "A specific deployment is sustaining repeated failures.",
    };
  }

  if (USER_FACING_KINDS.has(input.signalKind)) {
    return {
      severity: "sev3",
      reason: "A user-facing signal is failing without full unavailability.",
    };
  }

  return {
    severity: "sev4",
    reason: "The signal is degraded but is not user-blocking.",
  };
}

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  sev1: 0,
  sev2: 1,
  sev3: 2,
  sev4: 3,
};

/**
 * Deduplicated repeats may raise pressure on an incident but never lower it.
 * A weaker later signal must not quietly downgrade an active SEV1.
 */
export function mostSevere(
  current: IncidentSeverity,
  incoming: IncidentSeverity,
): IncidentSeverity {
  return SEVERITY_RANK[incoming] < SEVERITY_RANK[current] ? incoming : current;
}

export function severityRequiresFreeze(severity: IncidentSeverity): boolean {
  return severity === "sev1" || severity === "sev2";
}

export function severityRequiresPrevention(severity: IncidentSeverity): boolean {
  return severity === "sev1" || severity === "sev2";
}
