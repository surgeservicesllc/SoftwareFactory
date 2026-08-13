import { z } from "zod";

import { investigateProductionIncident } from "@/lib/operations/investigator";
import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import { isProductionSignalKind } from "@/lib/operations/types";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const incidentIdSchema = z.string().uuid();

type IncidentRow = {
  id: string;
  project_id: string;
  source: string | null;
  occurrence_count: number;
  detected_at: string;
  deployment_id: string | null;
  commit_sha: string | null;
};

type MonitorRow = { name: string; last_outcome: string; consecutive_failures: number; failure_threshold: number };

type DeploymentRow = {
  id: string;
  commit_sha: string | null;
  status: string;
  created_at: string;
  external_reference: string | null;
};

type DiagnosisRow = {
  id: string;
  likely_cause: string;
  affected_subsystem: string;
  confidence: string;
  recommended_action: string;
  risk_level: string;
};

function minutesBetween(later: string, earlier: string): number | null {
  const laterMs = Date.parse(later);
  const earlierMs = Date.parse(earlier);
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) return null;
  return Math.max(0, Math.round((laterMs - earlierMs) / 60_000));
}

/**
 * Run the Production Investigator over the evidence this control plane
 * actually holds and store its structured conclusion. Only the conclusion and
 * the cited evidence are persisted or returned.
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
      .select("id,project_id,source,occurrence_count,detected_at,deployment_id,commit_sha")
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

    const [monitorResult, deploymentResult] = await Promise.all([
      context.client
        .from("production_monitors")
        .select("name,last_outcome,consecutive_failures,failure_threshold")
        .eq("organization_id", context.activeOrganization.id)
        .eq("project_id", incident.project_id)
        .eq("enabled", true)
        .limit(50),
      context.client
        .from("deployments")
        .select("id,commit_sha,status,created_at,external_reference")
        .eq("organization_id", context.activeOrganization.id)
        .eq("project_id", incident.project_id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    if (monitorResult.error) return databaseErrorResponse(monitorResult.error);
    if (deploymentResult.error) return databaseErrorResponse(deploymentResult.error);

    const monitors = (monitorResult.data ?? []) as MonitorRow[];
    const deployments = (deploymentResult.data ?? []) as DeploymentRow[];
    const failingMonitorNames = monitors
      .filter((monitor) => monitor.last_outcome === "fail" && monitor.consecutive_failures >= monitor.failure_threshold)
      .map((monitor) => monitor.name);

    const suspectDeployment = incident.deployment_id
      ? deployments.find((deployment) => deployment.id === incident.deployment_id) ?? null
      : deployments[0] ?? null;
    const previousDeployment = suspectDeployment
      ? deployments.find((deployment) => deployment.id !== suspectDeployment.id) ?? null
      : null;

    const investigation = investigateProductionIncident({
      signalKind: isProductionSignalKind(incident.source) ? incident.source : "uptime",
      occurrenceCount: incident.occurrence_count,
      failingMonitorNames,
      minutesSinceDeployment: suspectDeployment
        ? minutesBetween(incident.detected_at, suspectDeployment.created_at)
        : null,
      deploymentReference: suspectDeployment?.external_reference ?? suspectDeployment?.id ?? null,
      commitSha: incident.commit_sha ?? suspectDeployment?.commit_sha ?? null,
      pullRequestReference: null,
      recentChangePaths: [],
      failedTestNames: [],
      errorSamples: [],
      previousDeploymentHealthy: previousDeployment?.status === "succeeded",
    });

    const { data: diagnosisData, error: diagnosisError } = await context.client
      .rpc("record_production_diagnosis", {
        p_incident_id: incidentId,
        p_likely_cause: investigation.likelyCause,
        p_affected_subsystem: investigation.affectedSubsystem,
        p_confidence: investigation.confidence,
        p_recommended_action: investigation.recommendedAction,
        p_risk_level: investigation.risk.toLowerCase(),
        p_evidence: investigation.evidence,
        p_analyzer: investigation.analyzer,
      })
      .single();

    if (diagnosisError) return databaseErrorResponse(diagnosisError);
    const diagnosis = diagnosisData as DiagnosisRow;

    return jsonNoStore({
      ...OPERATIONS_EXECUTION_ENVELOPE,
      diagnosis: {
        id: diagnosis.id,
        likelyCause: diagnosis.likely_cause,
        affectedSubsystem: diagnosis.affected_subsystem,
        confidence: diagnosis.confidence,
        recommendedAction: diagnosis.recommended_action,
        risk: diagnosis.risk_level.toUpperCase(),
        evidence: investigation.evidence,
        analyzer: investigation.analyzer,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "diagnosis_failed", "The incident could not be diagnosed.");
  }
}
