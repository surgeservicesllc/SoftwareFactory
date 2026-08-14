import { z } from "zod";

import { GitHubApiError } from "@/lib/github/client";
import { createGitHubInstallationToken } from "@/lib/github/client";
import { getGitHubAppConfigurationForAppId } from "@/lib/github/config";
import { getGitHubBranchReference } from "@/lib/github/repository";
import { buildRepairCommand, type RepairDiagnosis } from "@/lib/operations/promotion";
import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireOwner,
} from "@/lib/operations/route";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

type RepairRow = {
  id: string;
  project_id: string;
  diagnosis_id: string | null;
  state: string;
  assignment_status: string;
  task_id: string | null;
};

type DiagnosisRow = {
  likely_cause: string;
  affected_subsystem: string;
  recommended_action: string;
  risk_level: "green" | "yellow" | "red";
};

type CommandTarget = {
  app_id: number;
  base_branch: string;
  connection_id: string;
  external_installation_id: number;
  external_repository_id: number;
  internal_installation_id: string;
  project_id: string;
  repository_full_name: string;
  repository_id: string;
};

type SubmissionResult = {
  command_id: string;
  task_id: string;
  command_state: string;
  task_state: string;
  requires_owner_approval: boolean;
  was_created: boolean;
};

type LinkResult = {
  repair_id: string;
  task_id: string | null;
  state: string;
  assignment_status: string;
  linked: boolean;
  blocked_reason: string | null;
};

/**
 * Promote a Phase 1E repair attempt into the Phase 1C execution queue.
 *
 * Before this existed, `create_repair_attempt` wrote a bare `backlog` task with
 * no command, which `claim_phase1c_run` could never select — repair work was
 * unclaimable, not merely unassigned.
 *
 * The command is assembled by `buildRepairCommand` and submitted through
 * `submit_command`, the same entry point a person's command uses, so the
 * database risk floor applies and a security-shaped repair is forced to RED and
 * owner approval. Self-healing gets no privileged lane.
 *
 * This adds no executor. Without a registered Phase 1C worker and a provider
 * credential the promoted run simply stays queued, which is the truthful state.
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

    const context = await operationsContext();
    // Promotion starts a Codex engineering command, so it carries the same
    // owner-only requirement as submitting one directly.
    const forbidden = requireOwner(context);
    if (forbidden) return forbidden;

    const { data: repairData, error: repairError } = await context.client
      .from("repair_attempts")
      .select("id,project_id,diagnosis_id,state,assignment_status,task_id")
      .eq("organization_id", context.activeOrganization.id)
      .eq("incident_id", incidentId)
      .order("attempt_number", { ascending: false })
      .limit(1);
    if (repairError) return databaseErrorResponse(repairError);

    const repair = ((repairData ?? []) as RepairRow[])[0];
    if (!repair) {
      return jsonNoStore(
        { error: { code: "repair_not_found", message: "This incident has no repair attempt to promote." } },
        { status: 404 },
      );
    }
    if (!repair.diagnosis_id) {
      return jsonNoStore(
        {
          error: {
            code: "diagnosis_required",
            message: "Diagnose the incident before promoting repair work; there is nothing to act on yet.",
          },
        },
        { status: 409 },
      );
    }

    const { data: diagnosisData, error: diagnosisError } = await context.client
      .from("production_diagnoses")
      .select("likely_cause,affected_subsystem,recommended_action,risk_level")
      .eq("organization_id", context.activeOrganization.id)
      .eq("id", repair.diagnosis_id)
      .maybeSingle();
    if (diagnosisError) return databaseErrorResponse(diagnosisError);
    if (!diagnosisData) {
      return jsonNoStore(
        { error: { code: "diagnosis_required", message: "The diagnosis is no longer available." } },
        { status: 409 },
      );
    }
    const diagnosisRow = diagnosisData as DiagnosisRow;
    const diagnosis: RepairDiagnosis = {
      likelyCause: diagnosisRow.likely_cause,
      affectedSubsystem: diagnosisRow.affected_subsystem,
      recommendedAction: diagnosisRow.recommended_action,
      riskLevel: diagnosisRow.risk_level,
    };

    const { data: targetData, error: targetError } = await context.client
      .rpc("resolve_phase1c_command_target", {
        p_organization_id: context.activeOrganization.id,
        p_project_id: repair.project_id,
      })
      .single();
    if (targetError || !targetData) {
      return jsonNoStore(
        {
          error: {
            code: "project_not_executable",
            message: "This project has no live selected GitHub repository to repair.",
          },
        },
        { status: 409 },
      );
    }
    const target = targetData as CommandTarget;

    const [repositoryOwner, repositoryName] = target.repository_full_name.split("/");
    if (!repositoryOwner || !repositoryName || target.repository_full_name.split("/").length !== 2) {
      return jsonNoStore(
        { error: { code: "project_not_executable", message: "The project repository binding is invalid." } },
        { status: 409 },
      );
    }

    // The base SHA must come from a live read. An invented or stale SHA would
    // send a worker at the wrong tree.
    let baseSha: string;
    try {
      const token = await createGitHubInstallationToken(
        getGitHubAppConfigurationForAppId(target.app_id),
        target.external_installation_id,
        {
          permissions: { contents: "read", metadata: "read" },
          repositoryIds: [target.external_repository_id],
        },
      );
      const reference = await getGitHubBranchReference(
        token.token,
        repositoryOwner,
        repositoryName,
        target.base_branch,
      );
      baseSha = reference.object.sha.toLowerCase();
    } catch (error) {
      if (error instanceof GitHubApiError) {
        return jsonNoStore(
          {
            error: {
              code: "project_not_executable",
              message: "The connected repository base branch could not be verified safely.",
            },
          },
          { status: error.status === 429 ? 429 : 409 },
        );
      }
      throw error;
    }

    const command = buildRepairCommand({
      diagnosis,
      repairAttemptId: repair.id,
      binding: {
        appId: target.app_id,
        baseBranch: target.base_branch,
        baseSha,
        connectionId: target.connection_id,
        externalInstallationId: target.external_installation_id,
        externalRepositoryId: target.external_repository_id,
        installationId: target.internal_installation_id,
        repositoryId: target.repository_id,
      },
    });

    const { data: submissionData, error: submissionError } = await context.client
      .rpc("submit_command", {
        p_project_id: repair.project_id,
        p_prompt: command.prompt,
        p_requested_risk: command.effectiveRisk,
        p_parameters: command.parameters,
        p_idempotency_key: command.idempotencyKey,
      })
      .single();
    if (submissionError) return databaseErrorResponse(submissionError);
    const submission = submissionData as SubmissionResult;

    const { data: linkData, error: linkError } = await context.client
      .rpc("link_repair_promotion", {
        p_repair_id: repair.id,
        p_task_id: submission.task_id,
      })
      .single();
    if (linkError) return databaseErrorResponse(linkError);
    const link = linkData as LinkResult;

    if (!link.linked) {
      return jsonNoStore(
        {
          ...OPERATIONS_EXECUTION_ENVELOPE,
          promoted: false,
          blockedReason: link.blocked_reason,
        },
        { status: 409 },
      );
    }

    return jsonNoStore(
      {
        ...OPERATIONS_EXECUTION_ENVELOPE,
        promoted: true,
        repair: {
          id: link.repair_id,
          state: link.state,
          assignmentStatus: link.assignment_status,
          assignmentLabel: link.assignment_status === "pending" ? "Queued" : "Not Connected",
        },
        command: {
          id: submission.command_id,
          taskId: submission.task_id,
          state: submission.command_state,
          requiresOwnerApproval: submission.requires_owner_approval,
        },
        // Queued is the end of the line here: no worker executes it.
        note: "The repair is queued in the ordinary command path. No worker executes it: Codex execution is Not Connected.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "repair_promotion_failed", "The repair could not be promoted.");
  }
}
