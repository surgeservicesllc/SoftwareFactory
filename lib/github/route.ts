import "server-only";

import { z } from "zod";

import {
  GitHubAuthorizationError,
  requireGitHubConnection,
  requireGitHubUser,
} from "@/lib/github/access";
import { createGitHubInstallationToken, GitHubApiError } from "@/lib/github/client";
import { getGitHubAppConfiguration } from "@/lib/github/config";
import { validateRepositoryCoordinate } from "@/lib/github/repository";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";

async function markDiscoveredConnectionLoss(
  connectionId: string,
  error: GitHubApiError,
) {
  if (!["github_installation_revoked", "github_permission_denied"].includes(error.code)) return;
  try {
    await createSupabaseGitHubWebhookClient().rpc("mark_github_connection_lost", {
      p_actor_user_id: null,
      p_connection_id: connectionId,
      p_reason: error.code === "github_installation_revoked"
        ? "installation_revoked"
        : "insufficient_permission",
    });
  } catch {
    // The provider failure remains the client-safe primary error. Connection-loss
    // persistence is best effort because no database detail may replace it.
  }
}

export async function prepareGitHubRepositoryRequest(
  request: Request,
  coordinates: { owner: string; repo: string },
  permissions: Record<string, "read" | "write">,
  managerOnly = false,
) {
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!z.string().uuid().safeParse(connectionId).success) {
    throw new GitHubAuthorizationError(
      400,
      "invalid_connection_id",
      "Connection id must be a UUID.",
    );
  }
  const owner = validateRepositoryCoordinate(coordinates.owner, "Repository owner");
  const repository = validateRepositoryCoordinate(coordinates.repo, "Repository name");
  const fullName = `${owner}/${repository}`;
  const { activeOrganization, supabase, user } = await requireGitHubUser();
  const context = await requireGitHubConnection(
    supabase,
    user.id,
    activeOrganization.id,
    connectionId!,
    fullName,
  );
  if (!context.repository) throw new Error("repository_context_missing");
  if (managerOnly && !["owner", "admin"].includes(context.role)) {
    throw new GitHubAuthorizationError(
      403,
      "manager_required",
      "Organization owner or administrator access is required.",
    );
  }
  let installationToken;
  try {
    installationToken = await createGitHubInstallationToken(
      getGitHubAppConfiguration(),
      context.installationId,
      {
        permissions,
        repositoryIds: [context.repository.externalId],
      },
    );
  } catch (error) {
    if (error instanceof GitHubApiError) {
      await markDiscoveredConnectionLoss(context.connectionId, error);
    }
    throw error;
  }
  return {
    connectionId: connectionId!,
    context,
    owner,
    repository,
    supabase,
    token: installationToken.token,
    user,
  };
}
