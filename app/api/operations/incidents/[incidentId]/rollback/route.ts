import { z } from "zod";

import {
  PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED,
  ROLLBACK_BLOCKER_EXPLANATIONS,
  evaluateRollbackEligibility,
} from "@/lib/operations/rollback";
import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireOwner,
} from "@/lib/operations/route";
import { isIncidentSeverity } from "@/lib/operations/types";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const rollbackRequestSchema = z
  .object({
    /**
     * The exact RED confirmation phrase. It does not authorize execution — no
     * executor exists — but the decision is still recorded as an owner action.
     */
    confirmation: z.literal("EVALUATE ROLLBACK"),
    rootCauseConfident: z.boolean().default(false),
    databaseCompatibilityConfirmed: z.boolean().default(false),
    releaseContainedIrreversibleChange: z.boolean().default(true),
  })
  .strict();

type IncidentRow = {
  id: string;
  project_id: string;
  sev: string | null;
  deployment_id: string | null;
};

type ProjectRow = { autonomous_operations_stopped: boolean };

type LastKnownGoodRow = { deployment_id: string; commit_sha: string | null; validated_at: string };

type RollbackRow = {
  id: string;
  state: string;
  attempt: number;
  eligible: boolean;
  blocked_reason: string | null;
};

/**
 * Evaluate rollback eligibility for an incident and record the decision.
 *
 * This never performs a rollback. `AUTO_ROLLBACK.md` disables automatic
 * rollback and no deployment adapter exists, so the recorded outcome is always
 * blocked with the exact reasons. The record is the deliverable: it proves what
 * was considered, with what evidence, by whom.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { incidentId } = await params;
    if (!z.string().uuid().safeParse(incidentId).success) {
      return invalidRequest("The incident identifier is invalid.");
    }

    const parsed = rollbackRequestSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return invalidRequest('Send the exact confirmation phrase "EVALUATE ROLLBACK".');
    }

    const context = await operationsContext();
    const forbidden = requireOwner(context);
    if (forbidden) return forbidden;

    const { data: incidentData, error: incidentError } = await context.client
      .from("incidents")
      .select("id,project_id,sev,deployment_id")
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

    const [lastKnownGoodResult, projectResult, attemptResult, inFlightResult] = await Promise.all([
      context.client.rpc("last_known_good_deployment", {
        p_project_id: incident.project_id,
        p_environment: "production",
        p_before: null,
      }),
      context.client
        .from("projects")
        .select("autonomous_operations_stopped")
        .eq("organization_id", context.activeOrganization.id)
        .eq("id", incident.project_id)
        .maybeSingle(),
      context.client
        .from("rollback_operations")
        .select("id")
        .eq("organization_id", context.activeOrganization.id)
        .eq("incident_id", incidentId),
      context.client
        .from("deployments")
        .select("id")
        .eq("organization_id", context.activeOrganization.id)
        .eq("project_id", incident.project_id)
        .in("status", ["pending", "in_progress"]),
    ]);

    if (lastKnownGoodResult.error) return databaseErrorResponse(lastKnownGoodResult.error);
    if (projectResult.error) return databaseErrorResponse(projectResult.error);
    if (attemptResult.error) return databaseErrorResponse(attemptResult.error);
    if (inFlightResult.error) return databaseErrorResponse(inFlightResult.error);

    const lastKnownGood = ((lastKnownGoodResult.data ?? []) as LastKnownGoodRow[])[0] ?? null;
    const project = (projectResult.data ?? null) as ProjectRow | null;
    const priorAttempts = (attemptResult.data ?? []).length;

    const evaluation = evaluateRollbackEligibility({
      severity: isIncidentSeverity(incident.sev) ? incident.sev : "sev4",
      // Owner identity is proven by the role check above; the confirmation
      // phrase records the intent alongside it.
      ownerApproved: true,
      lastKnownGoodDeploymentId: lastKnownGood?.deployment_id ?? null,
      // The Last Known Good resolver only returns validated deployments.
      lastKnownGoodValidationPassed: lastKnownGood !== null,
      failingDeploymentId: incident.deployment_id,
      deploymentsInFlight: (inFlightResult.data ?? []).length,
      rootCauseConfident: parsed.data.rootCauseConfident,
      releaseContainedIrreversibleChange: parsed.data.releaseContainedIrreversibleChange,
      databaseCompatibilityConfirmed: parsed.data.databaseCompatibilityConfirmed,
      telemetryFresh: true,
      priorAttempts,
      operationsStopped: project?.autonomous_operations_stopped ?? false,
      executorConnected: PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED,
    });

    const { data: rollbackData, error: rollbackError } = await context.client
      .rpc("record_rollback_decision", {
        p_incident_id: incidentId,
        p_eligible: evaluation.eligible,
        p_blocked_reason: evaluation.primaryBlocker,
        p_eligibility: { ...evaluation.evidence, blockers: evaluation.blockers },
        p_from_deployment_id: incident.deployment_id,
        p_to_deployment_id: lastKnownGood?.deployment_id ?? null,
      })
      .single();

    if (rollbackError) return databaseErrorResponse(rollbackError);
    const rollback = rollbackData as RollbackRow;

    return jsonNoStore(
      {
        ...OPERATIONS_EXECUTION_ENVELOPE,
        executed: false,
        rollback: {
          id: rollback.id,
          state: rollback.state,
          attempt: rollback.attempt,
          eligible: rollback.eligible,
          blockedReason: rollback.blocked_reason,
        },
        lastKnownGood: lastKnownGood
          ? {
            deploymentId: lastKnownGood.deployment_id,
            commitSha: lastKnownGood.commit_sha,
            validatedAt: lastKnownGood.validated_at,
          }
          : null,
        blockers: evaluation.blockers.map((blocker) => ({
          code: blocker,
          explanation: ROLLBACK_BLOCKER_EXPLANATIONS[blocker],
        })),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(
      error,
      "rollback_evaluation_failed",
      "The rollback decision could not be recorded.",
    );
  }
}
