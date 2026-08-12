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
import { prepareGitHubRepositoryRequest } from "@/lib/github/route";
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
  repository_id: string;
  status: "reserved" | "completed" | "failed";
  title: string;
};

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
  let prepared: Awaited<ReturnType<typeof prepareGitHubRepositoryRequest>> | null = null;
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
    if (isProtectedGitHubWritePath(normalizedPath)) {
      return jsonNoStore(
        {
          error: {
            code: "protected_resource",
            message: "This protected path requires a separate owner-approved workflow and cannot be changed here.",
          },
        },
        { status: 403 },
      );
    }
    const sensitiveFinding = findSensitiveData({
      commitMessage: parsed.data.commitMessage,
      content: parsed.data.content,
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

    prepared = await prepareGitHubRepositoryRequest(
      request,
      await params,
      { contents: "write", pull_requests: "write" },
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
      .select("id")
      .eq("project_id", project.id)
      .eq("connection_id", prepared.context.connectionId)
      .maybeSingle();
    if (projectConnectionError) throw projectConnectionError;
    if (!projectConnection) {
      return jsonNoStore(
        { error: { code: "project_connection_missing", message: "The project is not linked to this GitHub connection." } },
        { status: 409 },
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
    let { data: changeRecord, error: changeError } = await prepared.supabase
      .from("github_change_requests")
      .insert(requestedRecord)
      .select("*")
      .single();
    if (changeError?.code === "23505") {
      const replay = await prepared.supabase
        .from("github_change_requests")
        .select("*")
        .eq("organization_id", prepared.context.organizationId)
        .eq("idempotency_key", parsed.data.idempotencyKey)
        .maybeSingle();
      if (replay.error) throw replay.error;
      changeRecord = replay.data;
      changeError = null;
    }
    if (changeError || !changeRecord) throw changeError ?? new Error("change_reservation_failed");
    const typedRecord = changeRecord as ChangeRecord;
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
      return jsonNoStore(
        { error: { code: "change_in_progress", message: "This GitHub change is already in progress." } },
        { status: 409 },
      );
    }
    if (typedRecord.status !== "reserved") {
      return jsonNoStore(
        { error: { code: "change_not_retryable", message: "This change request cannot be retried with the same key." } },
        { status: 409 },
      );
    }
    reservedRequestId = typedRecord.id;

    const currentFile = await getGitHubFile(
      prepared.token,
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
      prepared.token,
      prepared.owner,
      prepared.repository,
      parsed.data.baseBranch,
    );
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const headBranch = `softwarefactory/${timestamp}-${typedRecord.id.slice(0, 12)}`;
    await createGitHubBranch(
      prepared.token,
      prepared.owner,
      prepared.repository,
      headBranch,
      baseReference.object.sha,
    );
    const commit = await updateGitHubFileOnBranch(prepared.token, {
      branch: headBranch,
      content: parsed.data.content,
      expectedBlobSha: parsed.data.expectedBlobSha,
      message: parsed.data.commitMessage,
      owner: prepared.owner,
      path: normalizedPath,
      repository: prepared.repository,
    });
    const pullRequest = await createGitHubDraftPullRequest(prepared.token, {
      baseBranch: parsed.data.baseBranch,
      body: [
        "Created by SoftwareFactory as an isolated, owner-initiated YELLOW change.",
        "",
        `Path: \`${normalizedPath}\``,
        "",
        "This pull request is intentionally a draft. SoftwareFactory did not merge or deploy it.",
      ].join("\n"),
      headBranch,
      owner: prepared.owner,
      repository: prepared.repository,
      title: parsed.data.title,
    });

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
      try {
        await createSupabaseGitHubWebhookClient().rpc("fail_github_change_request", {
          p_actor_user_id: prepared.user.id,
          p_error_code: /^[a-z][a-z0-9_]{0,62}$/.test(errorCode) ? errorCode : "change_failed",
          p_request_id: reservedRequestId,
        });
      } catch {
        // Preserve the primary failure; the immutable provider evidence remains
        // external and operators can reconcile the reserved record manually.
      }
    }
    return githubRouteErrorResponse(error);
  }
}
