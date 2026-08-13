import type { ProjectHealthState } from "@/lib/operations/types";

/**
 * Project health derivation.
 *
 * This mirrors `public.evaluate_project_health` so the UI can explain a state
 * without a round trip and so the rule is directly testable. Two properties
 * matter more than the exact thresholds:
 *
 * 1. Absence of evidence is UNKNOWN, never HEALTHY. A project with no connected
 *    monitor has not been observed and must not look reassuring.
 * 2. Every state carries a reason. "Degraded" with no explanation is a rumour.
 */

export interface HealthSignals {
  readonly projectPaused: boolean;
  readonly operationsStopped: boolean;
  readonly connectedMonitors: number;
  readonly failingMonitors: number;
  readonly degradedMonitors: number;
  readonly openSev1: number;
  readonly openSev2: number;
  readonly openLowerSeverity: number;
  readonly failedDeployments24h: number;
}

export interface HealthDerivation {
  readonly state: ProjectHealthState;
  readonly reason: string;
  readonly reasons: readonly { code: string; value: number }[];
}

export function deriveProjectHealth(signals: HealthSignals): HealthDerivation {
  const reasons = [
    { code: "connected_monitors", value: signals.connectedMonitors },
    { code: "failing_monitors", value: signals.failingMonitors },
    { code: "degraded_monitors", value: signals.degradedMonitors },
    { code: "open_sev1", value: signals.openSev1 },
    { code: "open_sev2", value: signals.openSev2 },
    { code: "open_lower_severity", value: signals.openLowerSeverity },
    { code: "failed_deployments_24h", value: signals.failedDeployments24h },
  ] as const;

  if (signals.projectPaused || signals.operationsStopped) {
    return { state: "paused", reason: "Operations are paused for this project.", reasons };
  }

  if (signals.openSev1 > 0 || signals.failingMonitors > 0) {
    return {
      state: "critical",
      reason: `Critical: ${signals.failingMonitors} failing monitor(s) past threshold and ${signals.openSev1} open SEV1 incident(s).`,
      reasons,
    };
  }

  if (
    signals.openSev2 > 0
    || signals.degradedMonitors > 0
    || signals.failedDeployments24h > 0
  ) {
    return {
      state: "degraded",
      reason: `Degraded: ${signals.openSev2} open SEV2 incident(s), ${signals.degradedMonitors} degraded monitor(s), ${signals.failedDeployments24h} failed deployment(s) in 24h.`,
      reasons,
    };
  }

  if (signals.connectedMonitors === 0) {
    return {
      state: "unknown",
      reason: "No connected production monitor is enabled, so health cannot be evidenced.",
      reasons,
    };
  }

  if (signals.openLowerSeverity > 0) {
    return {
      state: "degraded",
      reason: `Degraded: ${signals.openLowerSeverity} open lower-severity incident(s).`,
      reasons,
    };
  }

  return {
    state: "healthy",
    reason: `Healthy: ${signals.connectedMonitors} connected monitor(s) reporting passing signals.`,
    reasons,
  };
}

/** Worst-first ordering so the portfolio view surfaces problems at the top. */
const HEALTH_RANK: Record<ProjectHealthState, number> = {
  critical: 0,
  degraded: 1,
  unknown: 2,
  paused: 3,
  healthy: 4,
};

export function compareHealth(left: ProjectHealthState, right: ProjectHealthState): number {
  return HEALTH_RANK[left] - HEALTH_RANK[right];
}

export function healthTone(state: ProjectHealthState): "safe" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "healthy":
      return "safe";
    case "degraded":
      return "warning";
    case "critical":
      return "danger";
    default:
      return "neutral";
  }
}
