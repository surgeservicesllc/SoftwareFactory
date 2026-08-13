import { z } from "zod";

import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
} from "@/lib/operations/route";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  operations_health_state: string;
  operations_health_reason: string | null;
  operations_health_computed_at: string | null;
  autonomous_releases_frozen: boolean;
  autonomous_operations_stopped: boolean;
  owner_attention_required: boolean;
};

type HealthSnapshotRow = {
  id: string;
  state: string;
  previous_state: string | null;
  reason: string;
  computed_at: string;
};

type IncidentRow = {
  id: string;
  title: string;
  sev: string | null;
  status: string;
  detected_at: string;
  resolved_at: string | null;
  occurrence_count: number;
  root_cause: string | null;
  corrective_action: string | null;
  prevention_reference: string | null;
};

type MonitorRow = {
  id: string;
  name: string;
  signal_kind: string;
  connection_state: string;
  unavailable_reason: string | null;
  enabled: boolean;
  last_outcome: string;
  last_observed_at: string | null;
};

type FreezeRow = {
  id: string;
  state: string;
  reason_code: string;
  reason: string;
  automatic: boolean;
  frozen_at: string;
  released_at: string | null;
};

type RollbackRow = {
  id: string;
  state: string;
  attempt: number;
  eligible: boolean;
  blocked_reason: string | null;
  escalated: boolean;
  created_at: string;
};

type RepairRow = {
  id: string;
  attempt_number: number;
  state: string;
  assignment_status: string;
  blocked_reason: string | null;
  failure_reason: string | null;
  escalated: boolean;
  created_at: string;
};

type BlockerRow = { allowed: boolean; blockers: string[] };

/**
 * One project's operational report: current health with its reason, health
 * history, incidents, monitors, freezes, rollback decisions, and repair work.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return invalidRequest("The project identifier is invalid.");
    }

    const context = await operationsContext();
    const organizationId = context.activeOrganization.id;

    const { data: projectData, error: projectError } = await context.client
      .from("projects")
      .select(
        "id,name,status,operations_health_state,operations_health_reason,operations_health_computed_at,autonomous_releases_frozen,autonomous_operations_stopped,owner_attention_required",
      )
      .eq("organization_id", organizationId)
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) return databaseErrorResponse(projectError);
    if (!projectData) {
      return jsonNoStore(
        { error: { code: "project_not_found", message: "That project is not available." } },
        { status: 404 },
      );
    }
    const project = projectData as ProjectRow;

    const [history, incidents, monitors, freezes, rollbacks, repairs, releaseAuthority] = await Promise.all([
      context.client
        .from("project_health_snapshots")
        .select("id,state,previous_state,reason,computed_at")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .order("computed_at", { ascending: false })
        .limit(25),
      context.client
        .from("incidents")
        .select("id,title,sev,status,detected_at,resolved_at,occurrence_count,root_cause,corrective_action,prevention_reference")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .order("detected_at", { ascending: false })
        .limit(50),
      context.client
        .from("production_monitors")
        .select("id,name,signal_kind,connection_state,unavailable_reason,enabled,last_outcome,last_observed_at")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .order("name", { ascending: true })
        .limit(50),
      context.client
        .from("release_freezes")
        .select("id,state,reason_code,reason,automatic,frozen_at,released_at")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .order("frozen_at", { ascending: false })
        .limit(25),
      context.client
        .from("rollback_operations")
        .select("id,state,attempt,eligible,blocked_reason,escalated,created_at")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(25),
      context.client
        .from("repair_attempts")
        .select("id,attempt_number,state,assignment_status,blocked_reason,failure_reason,escalated,created_at")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(25),
      context.client.rpc("autonomous_release_allowed", { p_project_id: projectId }),
    ]);

    for (const result of [history, incidents, monitors, freezes, rollbacks, repairs, releaseAuthority]) {
      if (result.error) return databaseErrorResponse(result.error);
    }

    const authority = ((releaseAuthority.data ?? []) as BlockerRow[])[0] ?? null;

    return jsonNoStore({
      ...OPERATIONS_EXECUTION_ENVELOPE,
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        healthState: project.operations_health_state,
        healthReason: project.operations_health_reason,
        healthComputedAt: project.operations_health_computed_at,
        releasesFrozen: project.autonomous_releases_frozen,
        operationsStopped: project.autonomous_operations_stopped,
        ownerAttentionRequired: project.owner_attention_required,
      },
      releaseAuthority: {
        allowed: authority?.allowed ?? false,
        blockers: authority?.blockers ?? ["EXECUTOR_NOT_CONNECTED"],
      },
      healthHistory: ((history.data ?? []) as HealthSnapshotRow[]).map((row) => ({
        id: row.id,
        state: row.state,
        previousState: row.previous_state,
        reason: row.reason,
        computedAt: row.computed_at,
      })),
      incidents: ((incidents.data ?? []) as IncidentRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        severity: row.sev,
        status: row.status,
        detectedAt: row.detected_at,
        resolvedAt: row.resolved_at,
        occurrenceCount: row.occurrence_count,
        rootCause: row.root_cause,
        correctiveAction: row.corrective_action,
        preventionReference: row.prevention_reference,
      })),
      monitors: ((monitors.data ?? []) as MonitorRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        signalKind: row.signal_kind,
        connectionState: row.connection_state,
        connectionLabel: row.connection_state === "connected" ? "Connected" : "Not Connected",
        unavailableReason: row.unavailable_reason,
        enabled: row.enabled,
        lastOutcome: row.last_outcome,
        lastObservedAt: row.last_observed_at,
      })),
      freezes: ((freezes.data ?? []) as FreezeRow[]).map((row) => ({
        id: row.id,
        state: row.state,
        reasonCode: row.reason_code,
        reason: row.reason,
        automatic: row.automatic,
        frozenAt: row.frozen_at,
        releasedAt: row.released_at,
      })),
      rollbacks: ((rollbacks.data ?? []) as RollbackRow[]).map((row) => ({
        id: row.id,
        state: row.state,
        attempt: row.attempt,
        eligible: row.eligible,
        blockedReason: row.blocked_reason,
        escalated: row.escalated,
        createdAt: row.created_at,
      })),
      repairs: ((repairs.data ?? []) as RepairRow[]).map((row) => ({
        id: row.id,
        attemptNumber: row.attempt_number,
        state: row.state,
        assignmentStatus: row.assignment_status,
        assignmentLabel: row.assignment_status === "not_connected" ? "Not Connected" : "Assigned",
        blockedReason: row.blocked_reason,
        failureReason: row.failure_reason,
        escalated: row.escalated,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return operationsFailure(
      error,
      "project_operations_unavailable",
      "The project operations report could not be loaded.",
    );
  }
}
