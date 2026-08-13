import { z } from "zod";

import {
  GitHubAuthorizationError,
  requireGitHubConnection,
  requireGitHubUser,
} from "@/lib/github/access";
import { getGitHubCandidateAppConfiguration } from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import {
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
} from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const handoffSchema = z.object({
  confirmation: z.literal("HANDOFF GITHUB PROJECT"),
  fromConnectionId: z.string().uuid(),
  fromInstallationId: z.number().int().positive(),
  projectId: z.string().uuid(),
  rationale: z.string().trim().min(20).max(500),
  repositoryId: z.number().int().positive(),
  rollbackPlan: z.string().trim().min(20).max(500),
  toInstallationId: z.number().int().positive(),
}).strict();
const handoffResultSchema = z.object({
  connection_id: z.string().uuid(),
  default_branch: z.string().min(1).max(255),
  github_repository: z.string().min(3).max(201),
  github_repository_id: z.string().uuid(),
  previous_connection_id: z.string().uuid(),
  previous_github_repository_id: z.string().uuid(),
  project_id: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { connectionId: toConnectionId } = await params;
    if (!z.string().uuid().safeParse(toConnectionId).success) {
      return jsonNoStore(
        { error: { code: "invalid_connection_id", message: "Connection id must be a UUID." } },
        { status: 400 },
      );
    }

    const parsed = handoffSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success || parsed.data.fromConnectionId === toConnectionId) {
      return jsonNoStore(
        {
          error: {
            code: "github_handoff_confirmation_required",
            message: 'Choose distinct live connections and type "HANDOFF GITHUB PROJECT".',
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, supabase, user } = await requireGitHubUser();
    if (activeOrganization.role !== "owner") {
      throw new GitHubAuthorizationError(
        403,
        "owner_required",
        "The organization owner must approve a GitHub App handoff.",
      );
    }

    const [fromContext, toContext] = await Promise.all([
      requireGitHubConnection(
        supabase,
        user.id,
        activeOrganization.id,
        parsed.data.fromConnectionId,
      ),
      requireGitHubConnection(
        supabase,
        user.id,
        activeOrganization.id,
        toConnectionId,
      ),
    ]);
    if (
      fromContext.installationId !== parsed.data.fromInstallationId
      || toContext.installationId !== parsed.data.toInstallationId
    ) {
      return jsonNoStore(
        {
          error: {
            code: "github_handoff_stale",
            message: "A GitHub installation changed. Reload before approving the handoff.",
          },
        },
        { status: 409 },
      );
    }

    const candidateConfiguration = getGitHubCandidateAppConfiguration();
    if (candidateConfiguration?.appId === toContext.appId) {
      const verifiedWebhook = await createSupabaseGitHubWebhookClient()
        .from("github_webhook_deliveries")
        .select("id")
        .eq("organization_id", activeOrganization.id)
        .eq("installation_id", toContext.internalInstallationId)
        .eq("status", "processed")
        .gte("processed_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .contains("metadata", { app_id: toContext.appId })
        .limit(1)
        .maybeSingle();
      if (verifiedWebhook.error) throw verifiedWebhook.error;
      if (!verifiedWebhook.data) {
        return jsonNoStore(
          {
            error: {
              code: "candidate_webhook_not_verified",
              message: "The replacement GitHub App must complete a signed webhook delivery before handoff.",
            },
          },
          { status: 409 },
        );
      }
    }

    const { data: approvalId, error: approvalError } = await supabase.rpc(
      "approve_github_project_connection_handoff",
      {
        p_confirmation_text: parsed.data.confirmation,
        p_external_repository_id: parsed.data.repositoryId,
        p_from_connection_id: parsed.data.fromConnectionId,
        p_from_external_installation_id: parsed.data.fromInstallationId,
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
        p_rationale: parsed.data.rationale,
        p_rollback_plan: parsed.data.rollbackPlan,
        p_to_connection_id: toConnectionId,
        p_to_external_installation_id: parsed.data.toInstallationId,
      },
    );
    if (approvalError || !z.string().uuid().safeParse(approvalId).success) {
      if (approvalError) return databaseErrorResponse(approvalError);
      return jsonNoStore(
        { error: { code: "github_handoff_invalid_approval", message: "The GitHub App handoff approval returned invalid evidence." } },
        { status: 500 },
      );
    }

    const { data, error } = await supabase.rpc("handoff_github_project_connection", {
      p_approval_id: approvalId,
      p_external_repository_id: parsed.data.repositoryId,
      p_from_connection_id: parsed.data.fromConnectionId,
      p_from_external_installation_id: parsed.data.fromInstallationId,
      p_organization_id: activeOrganization.id,
      p_project_id: parsed.data.projectId,
      p_to_connection_id: toConnectionId,
      p_to_external_installation_id: parsed.data.toInstallationId,
    }).single();
    if (error?.code === "23505") {
      return jsonNoStore(
        {
          error: {
            code: "github_handoff_conflict",
            message: "The project already has a conflicting active GitHub repository connection.",
          },
        },
        { status: 409 },
      );
    }
    if (error) return databaseErrorResponse(error);

    const parsedResult = handoffResultSchema.safeParse(data);
    if (!parsedResult.success) {
      return jsonNoStore(
        {
          error: {
            code: "github_handoff_invalid_response",
            message: "The GitHub App handoff returned invalid evidence.",
          },
        },
        { status: 500 },
      );
    }
    const row = parsedResult.data;
    return jsonNoStore({
      handoff: {
        connectionId: row.connection_id,
        defaultBranch: row.default_branch,
        githubRepository: row.github_repository,
        githubRepositoryId: row.github_repository_id,
        previousConnectionId: row.previous_connection_id,
        previousGithubRepositoryId: row.previous_github_repository_id,
        projectId: row.project_id,
      },
      historyPreserved: true,
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
