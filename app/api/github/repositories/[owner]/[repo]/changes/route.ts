import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { GitHubApiError } from "@/lib/github/client";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import {
  createGitHubBranch,
  createGitHubDraftPullRequest,
  getGitHubBranchReference,
  getGitHubFile,
  isProtectedGitHubWritePath,
  normalizeRepositoryPath,
  updateGitHubFileOnBranch,
} from "@/lib/github/repository";
import {
  authorizeGitHubRepositoryRequest,
  createGitHubRepositoryRequestToken,
} from "@/lib/github/route";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const changeSchema = z.object({
  baseBranch: z.string().min(1).max(255),
  commitMessage: z.string().trim().min(1).max(256),
  content: z.string().max(1024 * 1024),
  expectedBlobSha: z.string().regex(/^[0-9a-f]{40,64}$/),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  path: z.string().min(1).max(1024),
  projectId: z.string().uuid(),
  protectedApproval: z.object({
    confirmation: z.string().min(1).max(1100),
    reason: z.string().trim().min(20).max(500),
    rollbackPlan: z.string().trim().min(20).max(500),
  }).strict().optional(),
  title: z.string().trim().min(1).max(256),
}).strict();

type ChangeRecord = {
  base_branch: string;
  commit_message: string;
  content_sha256: string;
  commit_sha: string | null;
  commit_url: string | null;
  connection_id: string;
  expected_blob_sha: string;
  execution_nonce: string;
  external_pull_request_id: number | null;
  head_branch: string | null;
  id: string;
  path: string;
  project_id: string;
  pull_request_number: number | null;
  pull_request_url: string | null;
  reservation_expires_at: string;
  repository_id: string;
  status: "reserved" | "completed" | "failed";
  title: string;
};

const PROTECTED_APPROVAL_DURATION_SECONDS = 15 * 60;

function protectedApprovalPhrase(path: string) {
  return `APPROVE RED DRAFT PR FOR ${path}`;
}

function protectedApprovalRequiredResponse(path: string) {
  return jsonNoStore(
    {
      error: {
        code: "protected_resource_approval_required",
        constraints: {
          expiresInSeconds: PROTECTED_APPROVAL_DURATION_SECONDS,
          reason: { maxLength: 500, minLength: 20 },
          rollbackPlan: { maxLength: 500, minLength: 20 },
        },
        message: "This RED protected-file change requires an explicit organization-owner approval before a draft pull request can be created.",
        path,
        requiredConfirmation: protectedApprovalPhrase(path),
        risk: "RED",
      },
    },
    { status: 428 },
  );
}

function replayResponse(record: ChangeRecord) {
  return jsonNoStore({
    branch: { name: record.head_branch, sha: record.commit_sha },
    commit: { sha: record.commit_sha, url: record.commit_url },
    idempotentReplay: true,
    pullRequest: {
      draft: true,
      id: record.external_pull_request_id,
      number: record.pull_request_number,
      state: "open",
      title: record.title,
      url: record.pull_request_url,
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  let reservedRequestId: string | null = null;
  let prepared: Awaited<ReturnType<typeof authorizeGitHubRepositoryRequest>> | null = null;
  let headBranchEvidence: string | null = null;
  let commitEvidence: { sha: string; url: string } | null = null;
  let pullRequestEvidence: { id: number; number: number; state: string; title: string; url: string } | null = null;
  try {
    assertSameOriginRequest(request);
    const parsed = changeSchema.safeParse(await readBoundedJson(request, 1100 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_github_change",
            fields: z.flattenError(parsed.error).fieldErrors,
            message: "The GitHub file change request is invalid.",
          },
        },
        { status: 400 },
      );
    }
    const normalizedPath = normalizeRepositoryPath(parsed.data.path);
    const protectedPath = isProtectedGitHubWritePath(normalizedPath);
    const sensitiveFinding = findSensitiveData({
      commitMessage: parsed.data.commitMessage,
      content: parsed.data.content,
      protectedChangeReason: parsed.data.protectedApproval?.reason,
      protectedChangeRollbackPlan: parsed.data.protectedApproval?.rollbackPlan,
      title: parsed.data.title,
    });
    if (sensitiveFinding) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "Repository changes cannot contain credentials or likely secret values.",
            path: sensitiveFinding.path,
          },
        },
        { status: 400 },
      );
    }

    prepared = await authorizeGitHubRepositoryRequest(
      request,
      await params,
      true,
    );
    if (!prepared.context.repository) throw new Error("repository_context_missing");
    if (parsed.data.baseBranch !== prepared.context.repository.defaultBranch) {
      return jsonNoStore(
        {
          error: {
            code: "base_branch_mismatch",
            message: "Changes must branch from the repository's verified default branch.",
          },
        },
        { status: 409 },
      );
    }

    const { data: project, error: projectError } = await prepared.supabase
      .from("projects")
      .select("id,organization_id,github_repository,default_branch")
      .eq("id", parsed.data.projectId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (
      !project
      || project.organization_id !== prepared.context.organizationId
      || project.github_repository?.toLowerCase() !== prepared.context.repository.fullName.toLowerCase()
      || project.default_branch !== parsed.data.baseBranch
    ) {
      return jsonNoStore(
        { error: { code: "project_repository_mismatch", message: "The project is not linked to this repository and branch." } },
        { status: 409 },
      );
    }
    const { data: projectConnection, error: projectConnectionError } = await prepared.supabase
      .from("project_connections")
      .select("id,github_repository_id")
      .eq("project_id", project.id)
      .eq("connection_id", prepared.context.connectionId)
      .maybeSingle();
    if (projectConnectionError) throw projectConnectionError;
    if (!projectConnection || projectConnection.github_repository_id !== prepared.context.repository.id) {
      return jsonNoStore(
        { error: { code: "project_connection_missing", message: "The project is not linked to this exact GitHub repository connection." } },
        { status: 409 },
      );
    }

    if (!protectedPath && parsed.data.protectedApproval) {
      return jsonNoStore(
        {
          error: {
            code: "protected_approval_not_applicable",
            message: "Protected-file approval fields are accepted only for a protected repository path.",
          },
        },
        { status: 400 },
      );
    }
    if (protectedPath && !parsed.data.protectedApproval) {
      return protectedApprovalRequiredResponse(normalizedPath);
    }
    if (protectedPath && prepared.context.role !== "owner") {
      return jsonNoStore(
        {
          error: {
            code: "organization_owner_required",
            message: "Only an active organization owner can approve a RED protected-file change.",
          },
        },
        { status: 403 },
      );
    }
    if (
      protectedPath
      && parsed.data.protectedApproval?.confirmation !== protectedApprovalPhrase(normalizedPath)
    ) {
      return jsonNoStore(
        {
          error: {
            code: "protected_approval_confirmation_mismatch",
            message: "The protected-file confirmation did not exactly match the required phrase.",
            requiredConfirmation: protectedApprovalPhrase(normalizedPath),
          },
        },
        { status: 400 },
      );
    }

    const executionNonce = randomUUID();
    const requestedRecord = {
      base_branch: parsed.data.baseBranch,
      commit_message: parsed.data.commitMessage,
      content_sha256: createHash("sha256").update(parsed.data.content, "utf8").digest("hex"),
      connection_id: prepared.context.connectionId,
      created_by: prepared.user.id,
      expected_blob_sha: parsed.data.expectedBlobSha,
      execution_nonce: executionNonce,
      idempotency_key: parsed.data.idempotencyKey,
      organization_id: prepared.context.organizationId,
      path: normalizedPath,
      project_id: project.id,
      repository_id: prepared.context.repository.id,
      title: parsed.data.title,
    };
    const reservationArguments = {
      p_base_branch: requestedRecord.base_branch,
      p_commit_message: requestedRecord.commit_message,
      p_connection_id: requestedRecord.connection_id,
      p_content_sha256: requestedRecord.content_sha256,
      p_execution_nonce: requestedRecord.execution_nonce,
      p_expected_blob_sha: requestedRecord.expected_blob_sha,
      p_idempotency_key: requestedRecord.idempotency_key,
      p_organization_id: requestedRecord.organization_id,
      p_path: requestedRecord.path,
      p_project_id: requestedRecord.project_id,
      p_repository_id: requestedRecord.repository_id,
      p_title: requestedRecord.title,
    };
    const reservation = protectedPath
      ? await prepared.supabase.rpc("reserve_owner_approved_protected_github_change", {
        ...reservationArguments,
        p_confirmation_text: parsed.data.protectedApproval!.confirmation,
        p_rationale: parsed.data.protectedApproval!.reason,
        p_rollback_plan: parsed.data.protectedApproval!.rollbackPlan,
      }).single()
      : await prepared.supabase.rpc("reserve_github_change_request", reservationArguments).single();
    const { data: changeRecord, error: changeError } = reservation;
    if (changeError || !changeRecord) throw changeError ?? new Error("change_reservation_failed");
    let typedRecord = changeRecord as ChangeRecord;
    const requestMatches = typedRecord.project_id === requestedRecord.project_id
      && typedRecord.connection_id === requestedRecord.connection_id
      && typedRecord.repository_id === requestedRecord.repository_id
      && typedRecord.path === requestedRecord.path
      && typedRecord.expected_blob_sha === requestedRecord.expected_blob_sha
      && typedRecord.base_branch === requestedRecord.base_branch
      && typedRecord.commit_message === requestedRecord.commit_message
      && typedRecord.content_sha256 === requestedRecord.content_sha256
      && typedRecord.title === requestedRecord.title;
    if (!requestMatches) {
      return jsonNoStore(
        { error: { code: "idempotency_conflict", message: "The idempotency key was already used for a different change." } },
        { status: 409 },
      );
    }
    if (typedRecord.status === "completed") return replayResponse(typedRecord);
    if (typedRecord.status === "reserved" && typedRecord.execution_nonce !== executionNonce) {
      if (Date.parse(typedRecord.reservation_expires_at) > Date.now()) {
        return jsonNoStore(
          { error: { code: "change_in_progress", message: "This GitHub change is already in progress." } },
          { status: 409 },
        );
      }
      const { data: reclaimedRecord, error: reclaimError } = await prepared.supabase
        .rpc("reclaim_expired_github_change_reservation", {
          p_base_branch: requestedRecord.base_branch,
          p_commit_message: requestedRecord.commit_message,
          p_connection_id: requestedRecord.connection_id,
          p_content_sha256: requestedRecord.content_sha256,
          p_expected_blob_sha: requestedRecord.expected_blob_sha,
          p_expected_execution_nonce: typedRecord.execution_nonce,
          p_idempotency_key: requestedRecord.idempotency_key,
          p_new_execution_nonce: executionNonce,
          p_organization_id: requestedRecord.organization_id,
          p_path: requestedRecord.path,
          p_project_id: requestedRecord.project_id,
          p_repository_id: requestedRecord.repository_id,
          p_request_id: typedRecord.id,
          p_title: requestedRecord.title,
        })
        .single();
      if (reclaimError || !reclaimedRecord) throw reclaimError ?? new Error("change_reclaim_failed");
      typedRecord = reclaimedRecord as ChangeRecord;
      if (typedRecord.execution_nonce !== executionNonce || typedRecord.status !== "reserved") {
        return jsonNoStore(
          { error: { code: "change_in_progress", message: "This GitHub change is already in progress." } },
          { status: 409 },
        );
      }
    }
    if (typedRecord.status !== "reserved") {
      return jsonNoStore(
        { error: { code: "change_not_retryable", message: "This change request cannot be retried with the same key." } },
        { status: 409 },
      );
    }
    reservedRequestId = typedRecord.id;

    // Persist the execution boundary before contacting GitHub or minting a
    // write-scoped installation token. For protected paths, the RPC also
    // revalidates the still-live owner approval in the same database boundary.
    const executionBoundary = await prepared.supabase.rpc("begin_github_change_provider_execution", {
      p_execution_nonce: executionNonce,
      p_request_id: typedRecord.id,
    });
    if (executionBoundary.error || executionBoundary.data !== true) {
      throw executionBoundary.error ?? new Error("provider_execution_boundary_failed");
    }
    const token = await createGitHubRepositoryRequestToken(
      prepared.context,
      { contents: "write", pull_requests: "write" },
    );

    const currentFile = await getGitHubFile(
      token,
      prepared.owner,
      prepared.repository,
      parsed.data.baseBranch,
      normalizedPath,
    );
    if (currentFile.sha !== parsed.data.expectedBlobSha) {
      throw new GitHubApiError(409, "stale_file", "The file changed in GitHub. Reload it before saving.");
    }
    if (currentFile.content === parsed.data.content) {
      throw new GitHubApiError(409, "no_file_change", "The submitted content is unchanged.");
    }

    const baseReference = await getGitHubBranchReference(
      token,
      prepared.owner,
      prepared.repository,
      parsed.data.baseBranch,
    );
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const headBranch = `softwarefactory/${timestamp}-${typedRecord.id.slice(0, 12)}`;
    await createGitHubBranch(
      token,
      prepared.owner,
      prepared.repository,
      headBranch,
      baseReference.object.sha,
    );
    headBranchEvidence = headBranch;
    const commit = await updateGitHubFileOnBranch(token, {
      branch: headBranch,
      content: parsed.data.content,
      expectedBlobSha: parsed.data.expectedBlobSha,
      message: parsed.data.commitMessage,
      owner: prepared.owner,
      path: normalizedPath,
      repository: prepared.repository,
    });
    commitEvidence = {
      sha: commit.commit.sha,
      url: commit.commit.html_url,
    };
    const pullRequest = await createGitHubDraftPullRequest(token, {
      baseBranch: parsed.data.baseBranch,
      body: [
        protectedPath
          ? "Created by SoftwareFactory as an isolated, explicitly owner-approved RED change."
          : "Created by SoftwareFactory as an isolated, manager-initiated YELLOW change.",
        "",
        `Path: \`${normalizedPath}\``,
        "",
        "This pull request is intentionally a draft. SoftwareFactory did not write the default branch, merge, or deploy it.",
      ].join("\n"),
      headBranch,
      owner: prepared.owner,
      repository: prepared.repository,
      title: parsed.data.title,
    });
    pullRequestEvidence = {
      id: pullRequest.id,
      number: pullRequest.number,
      state: pullRequest.state,
      title: pullRequest.title,
      url: pullRequest.html_url,
    };

    const privilegedClient = createSupabaseGitHubWebhookClient();
    const completion = await privilegedClient.rpc("complete_github_change_request", {
      p_actor_user_id: prepared.user.id,
      p_commit_sha: commit.commit.sha,
      p_commit_url: commit.commit.html_url,
      p_head_branch: headBranch,
      p_pull_request_id: pullRequest.id,
      p_pull_request_number: pullRequest.number,
      p_pull_request_title: pullRequest.title,
      p_pull_request_url: pullRequest.html_url,
      p_request_id: typedRecord.id,
    });
    if (completion.error) throw completion.error;
    reservedRequestId = null;

    return jsonNoStore(
      {
        branch: { name: headBranch, sha: commit.commit.sha },
        commit: { sha: commit.commit.sha, url: commit.commit.html_url },
        idempotentReplay: false,
        pullRequest: {
          draft: true,
          id: pullRequest.id,
          number: pullRequest.number,
          state: pullRequest.state,
          title: pullRequest.title,
          url: pullRequest.html_url,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (reservedRequestId && prepared) {
      const errorCode = error instanceof GitHubApiError ? error.code : "change_failed";
      if (headBranchEvidence && commitEvidence && pullRequestEvidence) {
        try {
          const recovery = await createSupabaseGitHubWebhookClient().rpc("recover_github_change_request_with_provider_evidence", {
            p_actor_user_id: prepared.user.id,
            p_commit_sha: commitEvidence.sha,
            p_commit_url: commitEvidence.url,
            p_head_branch: headBranchEvidence,
            p_pull_request_id: pullRequestEvidence.id,
            p_pull_request_number: pullRequestEvidence.number,
            p_pull_request_title: pullRequestEvidence.title,
            p_pull_request_url: pullRequestEvidence.url,
            p_recovery_reason: "completion_persistence_failed",
            p_request_id: reservedRequestId,
          });
          if (recovery.error || recovery.data !== true) throw recovery.error ?? new Error("change_recovery_failed");
          reservedRequestId = null;
          return jsonNoStore(
            {
              branch: { name: headBranchEvidence, sha: commitEvidence.sha },
              commit: commitEvidence,
              idempotentReplay: false,
              recovered: true,
              pullRequest: {
                draft: true,
                id: pullRequestEvidence.id,
                number: pullRequestEvidence.number,
                state: pullRequestEvidence.state,
                title: pullRequestEvidence.title,
                url: pullRequestEvidence.url,
              },
            },
            { status: 201 },
          );
        } catch {
          // If the recovery boundary is unavailable, retain the branch and
          // commit through the older failure RPC and preserve the primary error.
        }
      }
      try {
        const failure = await createSupabaseGitHubWebhookClient().rpc("fail_github_change_request_with_evidence", {
          p_actor_user_id: prepared.user.id,
          p_commit_sha: commitEvidence?.sha ?? null,
          p_commit_url: commitEvidence?.url ?? null,
          p_error_code: /^[a-z][a-z0-9_]{0,62}$/.test(errorCode) ? errorCode : "change_failed",
          p_head_branch: headBranchEvidence,
          p_request_id: reservedRequestId,
        });
        if (failure.error) throw failure.error;
      } catch {
        // Preserve the primary failure; the immutable provider evidence remains
        // external and operators can reconcile the reserved record manually.
      }
    }
    return githubRouteErrorResponse(error);
  }
}
