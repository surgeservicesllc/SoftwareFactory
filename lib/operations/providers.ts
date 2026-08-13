import { NOT_CONNECTED_LABEL } from "@/lib/constants";
import type { ProductionSignalKind } from "@/lib/operations/types";

/**
 * Provider-neutral monitoring adapter registry.
 *
 * Exactly one adapter is implemented in Phase 1E: a direct outbound HTTPS
 * probe. Every other provider is listed with the concrete reason it is
 * unavailable, so the product shows **Not Connected** with an explanation
 * instead of an empty chart that reads like "everything is fine".
 */

export interface MonitorProvider {
  readonly id: string;
  readonly label: string;
  readonly connected: boolean;
  readonly supports: readonly ProductionSignalKind[];
  /** Present exactly when `connected` is false. */
  readonly unavailableReason: string | null;
  /** What an owner would have to do to connect it. */
  readonly unblockedBy: string | null;
}

export const MONITOR_PROVIDERS: readonly MonitorProvider[] = Object.freeze([
  Object.freeze({
    id: "http",
    label: "Direct HTTPS probe",
    connected: true,
    supports: Object.freeze([
      "uptime",
      "latency",
      "critical_route",
      "authentication",
      "synthetic",
    ] as ProductionSignalKind[]),
    unavailableReason: null,
    unblockedBy: null,
  }),
  Object.freeze({
    id: "vercel",
    label: "Vercel deployments",
    connected: false,
    supports: Object.freeze(["deployment"] as ProductionSignalKind[]),
    unavailableReason: "No Vercel API connection exists; Vercel hosts the UI but is not an in-product adapter.",
    unblockedBy: "An owner-authorized Vercel connection with a server-only token.",
  }),
  Object.freeze({
    id: "supabase",
    label: "Supabase database health",
    connected: false,
    supports: Object.freeze(["database"] as ProductionSignalKind[]),
    unavailableReason: "No database liveness adapter is connected in this phase.",
    unblockedBy: "A bounded read-only liveness probe approved for the production project.",
  }),
  Object.freeze({
    id: "telemetry",
    label: "Application error and latency telemetry",
    connected: false,
    supports: Object.freeze(["error_rate", "latency"] as ProductionSignalKind[]),
    unavailableReason: "No error or latency telemetry provider is connected.",
    unblockedBy: "A connected telemetry provider emitting real error-rate and latency signals.",
  }),
  Object.freeze({
    id: "jobs",
    label: "Background jobs and integrations",
    connected: false,
    supports: Object.freeze(["job", "integration"] as ProductionSignalKind[]),
    unavailableReason: "There is no job runner or integration telemetry to read.",
    unblockedBy: "A connected job runner or integration reporting real failures.",
  }),
]);

export function findMonitorProvider(id: string): MonitorProvider | undefined {
  return MONITOR_PROVIDERS.find((provider) => provider.id === id);
}

export function connectedProviderIds(): readonly string[] {
  return MONITOR_PROVIDERS.filter((provider) => provider.connected).map((provider) => provider.id);
}

/**
 * The label a surface must show for an unconnected provider. Kept here so no
 * page invents its own softer wording.
 */
export function providerStatusLabel(provider: MonitorProvider): string {
  return provider.connected ? "Connected" : NOT_CONNECTED_LABEL;
}
