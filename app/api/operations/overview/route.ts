import { MONITOR_PROVIDERS } from "@/lib/operations/providers";
import {
  OPERATIONS_EXECUTION_ENVELOPE,
  operationsContext,
  operationsFailure,
} from "@/lib/operations/route";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

type SummaryRow = {
  projects_total: number;
  projects_healthy: number;
  projects_degraded: number;
  projects_critical: number;
  projects_unknown: number;
  projects_paused: number;
  projects_frozen: number;
  open_incidents: number;
  open_sev1: number;
  open_sev2: number;
  incidents_resolved_24h: number;
  failed_deployments_24h: number;
  rollbacks_24h: number;
  failed_rollbacks_24h: number;
  repairs_open: number;
  owner_attention: number;
  connected_monitors: number;
  pending_events: number;
};

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  health_state: string;
  health_reason: string | null;
  health_computed_at: string | null;
  releases_frozen: boolean;
  operations_stopped: boolean;
  owner_attention_required: boolean;
  connected_monitors: number;
  open_incidents: number;
};

type IncidentRow = {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  sev: string;
  status: string;
  source: string | null;
  symptoms: string | null;
  impact: string | null;
  occurrence_count: number;
  detected_at: string;
  last_signal_at: string | null;
  resolved_at: string | null;
  owner_attention_required: boolean;
  root_cause: string | null;
  corrective_action: string | null;
  auto_created: boolean;
};

type MonitorRow = {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  signal_kind: string;
  provider: string;
  target_url: string | null;
  profile: string | null;
  connection_state: string;
  unavailable_reason: string | null;
  enabled: boolean;
  last_outcome: string;
  last_observed_at: string | null;
  consecutive_failures: number;
  failure_threshold: number;
};

type AuditRow = {
  id: string;
  project_id: string | null;
  kind: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
};

type JourneyRow = {
  id: string;
  project_name: string;
  monitor_id: string;
  name: string;
  profile: string;
  base_url: string;
  steps: Array<{ kind: string; name: string; method: string }>;
  enabled: boolean;
  monitor_connection_state: string;
  last_outcome: string;
  last_observed_at: string | null;
};

function briefingIncident(row: IncidentRow) {
  return {
    id: row.id,
    projectName: row.project_name,
    title: row.title,
    severity: row.sev,
    status: row.status,
    impact: row.impact,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
    ownerAttentionRequired: row.owner_attention_required,
  };
}

function fullIncident(row: IncidentRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    title: row.title,
    severity: row.sev,
    status: row.status,
    source: row.source,
    symptoms: row.symptoms,
    impact: row.impact,
    occurrenceCount: row.occurrence_count,
    detectedAt: row.detected_at,
    lastSignalAt: row.last_signal_at,
    resolvedAt: row.resolved_at,
    ownerAttentionRequired: row.owner_attention_required,
    rootCause: row.root_cause,
    correctiveAction: row.corrective_action,
    autoCreated: row.auto_created,
  };
}

export async function GET(request?: Request) {
  try {
    const context = await operationsContext();
    const organizationId = context.activeOrganization.id;
    const briefing = request
      ? new URL(request.url).searchParams.get("view") === "briefing"
      : false;

    if (briefing) {
      const incidents = await context.client.rpc("list_production_incidents", {
        p_organization_id: organizationId,
        p_limit: 50,
      });
      if (incidents.error) return databaseErrorResponse(incidents.error);

      return jsonNoStore({
        activeOrganizationId: organizationId,
        ...OPERATIONS_EXECUTION_ENVELOPE,
        incidents: ((incidents.data ?? []) as IncidentRow[]).map(briefingIncident),
      });
    }

    const [summary, projects, incidents, monitors, audit, journeys] = await Promise.all([
      context.client.rpc("operations_portfolio_summary", { p_organization_id: organizationId }),
      context.client.rpc("list_operations_projects", { p_organization_id: organizationId, p_limit: 100 }),
      context.client.rpc("list_production_incidents", { p_organization_id: organizationId, p_limit: 50 }),
      context.client.rpc("list_production_monitors", { p_organization_id: organizationId, p_limit: 100 }),
      context.client.rpc("list_operations_audit_events", { p_organization_id: organizationId, p_limit: 50 }),
      context.client.rpc("list_synthetic_journeys", { p_organization_id: organizationId, p_limit: 50 }),
    ]);

    for (const result of [summary, projects, incidents, monitors, audit, journeys]) {
      if (result.error) return databaseErrorResponse(result.error);
    }

    const summaryRow = ((summary.data ?? []) as SummaryRow[])[0] ?? null;

    return jsonNoStore({
      activeOrganizationId: organizationId,
      role: context.activeOrganization.role,
      ...OPERATIONS_EXECUTION_ENVELOPE,
      summary: summaryRow
        ? {
          projectsTotal: summaryRow.projects_total,
          projectsHealthy: summaryRow.projects_healthy,
          projectsDegraded: summaryRow.projects_degraded,
          projectsCritical: summaryRow.projects_critical,
          projectsUnknown: summaryRow.projects_unknown,
          projectsPaused: summaryRow.projects_paused,
          projectsFrozen: summaryRow.projects_frozen,
          openIncidents: summaryRow.open_incidents,
          openSev1: summaryRow.open_sev1,
          openSev2: summaryRow.open_sev2,
          incidentsResolved24h: summaryRow.incidents_resolved_24h,
          failedDeployments24h: summaryRow.failed_deployments_24h,
          rollbacks24h: summaryRow.rollbacks_24h,
          failedRollbacks24h: summaryRow.failed_rollbacks_24h,
          repairsOpen: summaryRow.repairs_open,
          ownerAttention: summaryRow.owner_attention,
          connectedMonitors: summaryRow.connected_monitors,
          pendingEvents: summaryRow.pending_events,
        }
        : null,
      projects: ((projects.data ?? []) as ProjectRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        healthState: row.health_state,
        healthReason: row.health_reason,
        healthComputedAt: row.health_computed_at,
        releasesFrozen: row.releases_frozen,
        operationsStopped: row.operations_stopped,
        ownerAttentionRequired: row.owner_attention_required,
        connectedMonitors: Number(row.connected_monitors),
        openIncidents: Number(row.open_incidents),
      })),
      incidents: ((incidents.data ?? []) as IncidentRow[]).map(fullIncident),
      monitors: ((monitors.data ?? []) as MonitorRow[]).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        projectName: row.project_name,
        name: row.name,
        signalKind: row.signal_kind,
        provider: row.provider,
        targetUrl: row.target_url,
        profile: row.profile,
        connectionState: row.connection_state,
        connectionLabel: row.connection_state === "connected" ? "Connected" : "Not Connected",
        unavailableReason: row.unavailable_reason,
        enabled: row.enabled,
        lastOutcome: row.last_outcome,
        lastObservedAt: row.last_observed_at,
        consecutiveFailures: row.consecutive_failures,
        failureThreshold: row.failure_threshold,
      })),
      auditEvents: ((audit.data ?? []) as AuditRow[]).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        kind: row.kind,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        createdAt: row.created_at,
      })),
      journeys: ((journeys.data ?? []) as JourneyRow[]).map((row) => ({
        id: row.id,
        projectName: row.project_name,
        monitorId: row.monitor_id,
        name: row.name,
        profile: row.profile,
        baseUrl: row.base_url,
        stepCount: Array.isArray(row.steps) ? row.steps.length : 0,
        // Declared writes are stored but never issued against production.
        writeSteps: Array.isArray(row.steps)
          ? row.steps.filter((step) => step.method === "POST").length
          : 0,
        enabled: row.enabled,
        connectionLabel: row.monitor_connection_state === "connected" ? "Connected" : "Not Connected",
        lastOutcome: row.last_outcome,
        lastObservedAt: row.last_observed_at,
      })),
      providers: MONITOR_PROVIDERS.map((provider) => ({
        id: provider.id,
        label: provider.label,
        connected: provider.connected,
        statusLabel: provider.connected ? "Connected" : "Not Connected",
        supports: provider.supports,
        unavailableReason: provider.unavailableReason,
        unblockedBy: provider.unblockedBy,
      })),
    });
  } catch (error) {
    return operationsFailure(
      error,
      "operations_overview_unavailable",
      "The operations overview could not be loaded.",
    );
  }
}
