import { z } from "zod";

import {
  PHASE_1E_REPAIR_WORKER_CONNECTED,
  REPAIR_BLOCKER_EXPLANATIONS,
  evaluateRepairEligibility,
} from "@/lib/operations/repair";
import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import { isIncidentSeverity } from "@/lib/operations/types";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import type { RiskLevel } from "@/lib/risk";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const incidentIdSchema = z.string().uuid();

type IncidentRow = {
  id: string;
  project_id: string;
  sev: string | null;
  title: string;
};

type ProjectRow = {
  maximum_autonomous_risk: string;
  autonomous_operations_stopped: boolean;
};

type DiagnosisRow = {
  id: string;
  likely_cause: string;
  recommended_action: string;
  affected_subsystem: string;
  confidence: "low" | "medium" | "high";
  risk_level: string;
};

type RepairRow = {
  repair_id: string;
  repair_attempt_number: number;
  repair_state_value: string;
  repair_task_id: string | null;
  repair_assignment_status: string;
  repair_escalated: boolean;
};

/**
 * Create bounded repair work from the incident's latest diagnosis.
 *
 * Self-healing does not bypass the risk policy: eligibility is evaluated
 * first, and because no execution worker is connected the created work is
 * recorded as blocked and assigned to nobody.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { incidentId } = await params;
    if (!incidentIdSchema.safeParse(incidentId).success) {
      return invalidRequest("The incident identifier is invalid.");
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const { data: incidentData, error: incidentError } = await context.client
      .from("incidents")
      .select("id,project_id,sev,title")
      .eq("organization_id", context.activeOrganization.id)
      .eq("id", incidentId)
      .maybeSingle();
    if (incidentError) return databaseErrorResponse(incidentError);
    if (!incidentData) {
      return jsonNoStore(
        { error: { code: "incident_not_found", message: "That incident is not available." } },
        { status: 404 },
      );
    }
    const incident = incidentData as IncidentRow;

    const [diagnosisResult, projectResult, attemptResult] = await Promise.all([
      context.client
        .from("production_diagnoses")
        .select("id,likely_cause,recommended_action,affected_subsystem,confidence,risk_level")
        .eq("organization_id", context.activeOrganization.id)
        .eq("incident_id", incidentId)
        .order("created_at", { ascending: false })
        .limit(1),
      context.client
        .from("projects")
        .select("maximum_autonomous_risk,autonomous_operations_stopped")
        .eq("organization_id", context.activeOrganization.id)
        .eq("id", incident.project_id)
        .maybeSingle(),
      context.client
        .from("repair_attempts")
        .select("id")
        .eq("organization_id", context.activeOrganization.id)
        .eq("incident_id", incidentId),
    ]);

    if (diagnosisResult.error) return databaseErrorResponse(diagnosisResult.error);
    if (projectResult.error) return databaseErrorResponse(projectResult.error);
    if (attemptResult.error) return databaseErrorResponse(attemptResult.error);

    const diagnosis = ((diagnosisResult.data ?? []) as DiagnosisRow[])[0] ?? null;
    const project = (projectResult.data ?? null) as ProjectRow | null;
    const priorAttempts = (attemptResult.data ?? []).length;

    const eligibility = evaluateRepairEligibility({
      severity: isIncidentSeverity(incident.sev) ? incident.sev : "sev4",
      hasDiagnosis: diagnosis !== null,
      confidence: diagnosis?.confidence ?? null,
      risk: (diagnosis?.risk_level.toUpperCase() ?? "YELLOW") as RiskLevel,
      maximumAutonomousRisk: (project?.maximum_autonomous_risk.toUpperCase() ?? "GREEN") as RiskLevel,
      priorAttempts,
      ownerApproved: false,
      operationsStopped: project?.autonomous_operations_stopped ?? false,
      workerConnected: PHASE_1E_REPAIR_WORKER_CONNECTED,
    });

    if (!eligibility.workCreatable) {
      return jsonNoStore(
        {
          ...OPERATIONS_EXECUTION_ENVELOPE,
          created: false,
          blockers: eligibility.blockers.map((blocker) => ({
            code: blocker,
            explanation: REPAIR_BLOCKER_EXPLANATIONS[blocker],
          })),
          escalateToOwner: eligibility.escalateToOwner,
        },
        { status: 409 },
      );
    }

    const { data: repairData, error: repairError } = await context.client
      .rpc("create_repair_attempt", {
        p_incident_id: incidentId,
        p_diagnosis_id: diagnosis?.id ?? null,
        p_task_title: `Repair: ${incident.title}`.slice(0, 240),
        p_task_description: [
          diagnosis?.likely_cause ?? "No diagnosis text is available.",
          "",
          `Recommended action: ${diagnosis?.recommended_action ?? "Investigate before changing production."}`,
          `Affected subsystem: ${diagnosis?.affected_subsystem ?? "unknown"}`,
        ].join("\n"),
        p_risk_level: (diagnosis?.risk_level ?? "yellow"),
      })
      .single();

    if (repairError) return databaseErrorResponse(repairError);
    const repair = repairData as RepairRow;

    return jsonNoStore(
      {
        ...OPERATIONS_EXECUTION_ENVELOPE,
        created: true,
        repair: {
          id: repair.repair_id,
          attemptNumber: repair.repair_attempt_number,
          state: repair.repair_state_value,
          taskId: repair.repair_task_id,
          assignmentStatus: repair.repair_assignment_status,
          assignmentLabel: repair.repair_assignment_status === "not_connected" ? "Not Connected" : "Assigned",
          escalated: repair.repair_escalated,
        },
        blockers: eligibility.blockers.map((blocker) => ({
          code: blocker,
          explanation: REPAIR_BLOCKER_EXPLANATIONS[blocker],
        })),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "repair_creation_failed", "Repair work could not be created.");
  }
}
