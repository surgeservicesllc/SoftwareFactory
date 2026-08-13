import { z } from "zod";

import { buildIncidentFingerprint } from "@/lib/operations/fingerprint";
import { probeHttpTarget } from "@/lib/operations/probe";
import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import { classifyIncidentSeverity } from "@/lib/operations/severity";
import { isProductionSignalKind } from "@/lib/operations/types";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const monitorIdSchema = z.string().uuid();

type MonitorRow = {
  id: string;
  project_id: string;
  name: string;
  signal_kind: string;
  provider: string;
  target_url: string | null;
  connection_state: string;
  enabled: boolean;
  expected_status_code: number;
  degraded_latency_ms: number;
  timeout_ms: number;
  failure_threshold: number;
};

type ObservationRow = {
  observation_id: string;
  observed_outcome: string;
  failures_after: number;
  threshold_breached: boolean;
  health_state: string;
};

type IncidentRow = {
  incident_id: string;
  incident_sev_level: string;
  incident_status_value: string;
  occurrences: number;
  deduplicated: boolean;
  freeze_applied: boolean;
};

/**
 * Run one real check for a monitor and let the result drive the pipeline.
 *
 * Probe -> record observation -> if the failure threshold is breached,
 * classify severity and open (or deduplicate into) an incident, which in turn
 * freezes autonomous releases for a SEV1/SEV2. Nothing is invented: when the
 * probe cannot run, the observation is not recorded at all.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ monitorId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { monitorId } = await params;
    if (!monitorIdSchema.safeParse(monitorId).success) {
      return invalidRequest("The monitor identifier is invalid.");
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const { data: monitorData, error: monitorError } = await context.client
      .from("production_monitors")
      .select(
        "id,project_id,name,signal_kind,provider,target_url,connection_state,enabled,expected_status_code,degraded_latency_ms,timeout_ms,failure_threshold",
      )
      .eq("organization_id", context.activeOrganization.id)
      .eq("id", monitorId)
      .maybeSingle();

    if (monitorError) return databaseErrorResponse(monitorError);
    if (!monitorData) {
      return jsonNoStore(
        { error: { code: "monitor_not_found", message: "That monitor is not available." } },
        { status: 404 },
      );
    }

    const monitor = monitorData as MonitorRow;
    if (monitor.connection_state !== "connected" || !monitor.enabled || !monitor.target_url) {
      return jsonNoStore(
        {
          error: {
            code: "monitor_not_connected",
            message: "This monitor has no connected adapter, so it cannot produce a real signal.",
          },
          connectionLabel: "Not Connected",
        },
        { status: 409 },
      );
    }

    const probe = await probeHttpTarget({
      targetUrl: monitor.target_url,
      expectedStatusCode: monitor.expected_status_code,
      degradedLatencyMs: monitor.degraded_latency_ms,
      timeoutMs: monitor.timeout_ms,
    });

    if (probe.outcome === "unknown") {
      // The probe could not run. Recording an "unknown" as if it were a
      // measurement would corrupt the failure count, so nothing is stored.
      return jsonNoStore(
        {
          error: {
            code: "probe_not_executable",
            message: probe.failureReason ?? "The monitor target could not be probed.",
          },
        },
        { status: 409 },
      );
    }

    const { data: observationData, error: observationError } = await context.client
      .rpc("record_monitor_observation", {
        p_monitor_id: monitor.id,
        p_outcome: probe.outcome,
        p_latency_ms: probe.latencyMs,
        p_status_code: probe.statusCode,
        p_failure_reason: probe.failureReason,
        p_evidence: {
          provider: monitor.provider,
          expected_status_code: monitor.expected_status_code,
        },
      })
      .single();

    if (observationError) return databaseErrorResponse(observationError);
    const observation = observationData as ObservationRow;

    let incident: IncidentRow | null = null;
    if (observation.threshold_breached && isProductionSignalKind(monitor.signal_kind)) {
      const fingerprint = buildIncidentFingerprint({
        signalKind: monitor.signal_kind,
        subject: monitor.id,
        detail: probe.statusCode ? `status-${probe.statusCode}` : "unreachable",
      });

      if (fingerprint) {
        const classification = classifyIncidentSeverity({
          signalKind: monitor.signal_kind,
          productionUnavailable: probe.statusCode === null || probe.statusCode >= 500,
          affectsAllUsers: monitor.signal_kind === "uptime",
          deploymentAttributed: false,
          consecutiveFailures: observation.failures_after,
        });

        const { data: incidentData, error: incidentError } = await context.client
          .rpc("open_production_incident", {
            p_project_id: monitor.project_id,
            p_fingerprint: fingerprint,
            p_title: `${monitor.name} is failing in production`,
            p_sev: classification.severity,
            p_source: monitor.signal_kind,
            p_symptoms: probe.failureReason ?? "The monitor reported a failing signal.",
            p_impact: classification.reason,
            p_monitor_id: monitor.id,
            p_deployment_id: null,
            p_commit_sha: null,
            p_evidence: {
              consecutive_failures: observation.failures_after,
              status_code: probe.statusCode,
              latency_ms: probe.latencyMs,
            },
          })
          .single();

        if (incidentError) return databaseErrorResponse(incidentError);
        incident = incidentData as IncidentRow;
      }
    }

    return jsonNoStore({
      ...OPERATIONS_EXECUTION_ENVELOPE,
      observation: {
        id: observation.observation_id,
        outcome: observation.observed_outcome,
        latencyMs: probe.latencyMs,
        statusCode: probe.statusCode,
        failureReason: probe.failureReason,
        consecutiveFailures: observation.failures_after,
        thresholdBreached: observation.threshold_breached,
        healthState: observation.health_state,
      },
      incident: incident
        ? {
          id: incident.incident_id,
          severity: incident.incident_sev_level,
          status: incident.incident_status_value,
          occurrenceCount: incident.occurrences,
          deduplicated: incident.deduplicated,
          releasesFrozen: incident.freeze_applied,
        }
        : null,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "monitor_run_failed", "The monitor check could not be completed.");
  }
}
