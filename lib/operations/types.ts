/**
 * Shared Phase 1E production-operations vocabulary.
 *
 * These names mirror the enum labels in
 * `supabase/migrations/20260812002800_phase1e_production_operations.sql`. The
 * database remains the authority; this module exists so route handlers, the UI,
 * and tests all speak the same language without re-typing string literals.
 */

export const PHASE_1E_POLICY_VERSION = "phase1e-operations-v1";

/** Version stamped on every diagnosis so a conclusion is traceable to its analyzer. */
export const PRODUCTION_INVESTIGATOR_VERSION = "rules-engine-v1";

export const PRODUCTION_SIGNAL_KINDS = [
  "uptime",
  "deployment",
  "error_rate",
  "latency",
  "critical_route",
  "authentication",
  "database",
  "job",
  "integration",
  "synthetic",
] as const;
export type ProductionSignalKind = (typeof PRODUCTION_SIGNAL_KINDS)[number];

export const SIGNAL_OUTCOMES = ["pass", "degraded", "fail", "unknown"] as const;
export type SignalOutcome = (typeof SIGNAL_OUTCOMES)[number];

export const PROJECT_HEALTH_STATES = [
  "healthy",
  "degraded",
  "critical",
  "unknown",
  "paused",
] as const;
export type ProjectHealthState = (typeof PROJECT_HEALTH_STATES)[number];

export const INCIDENT_SEVERITIES = ["sev1", "sev2", "sev3", "sev4"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const SYNTHETIC_PROFILES = ["basic", "standard", "critical"] as const;
export type SyntheticProfile = (typeof SYNTHETIC_PROFILES)[number];

export const MONITOR_CONNECTION_STATES = [
  "not_connected",
  "connected",
  "error",
  "disabled",
] as const;
export type MonitorConnectionState = (typeof MONITOR_CONNECTION_STATES)[number];

export const OPERATIONS_EVENT_TYPES = [
  "health.failed",
  "deployment.failed",
  "deployment.degraded",
  "synthetic.failed",
  "incident.created",
  "rollback.started",
  "rollback.completed",
  "repair.started",
  "repair.failed",
  "incident.resolved",
] as const;
export type OperationsEventType = (typeof OPERATIONS_EVENT_TYPES)[number];

/** Human-facing labels. The UI never invents its own wording for a state. */
export const HEALTH_STATE_LABELS: Record<ProjectHealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
  unknown: "Unknown",
  paused: "Paused",
};

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  sev1: "SEV1",
  sev2: "SEV2",
  sev3: "SEV3",
  sev4: "SEV4",
};

export function isProductionSignalKind(value: unknown): value is ProductionSignalKind {
  return typeof value === "string" && (PRODUCTION_SIGNAL_KINDS as readonly string[]).includes(value);
}

export function isProjectHealthState(value: unknown): value is ProjectHealthState {
  return typeof value === "string" && (PROJECT_HEALTH_STATES as readonly string[]).includes(value);
}

export function isIncidentSeverity(value: unknown): value is IncidentSeverity {
  return typeof value === "string" && (INCIDENT_SEVERITIES as readonly string[]).includes(value);
}
