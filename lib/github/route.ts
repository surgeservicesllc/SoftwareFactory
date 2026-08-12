import "server-only";

import { z } from "zod";

import {
  GitHubAuthorizationError,
  requireGitHubConnection,
  requireGitHubUser,
} from "@/lib/github/access";
import { createGitHubInstallationToken } from "@/lib/github/client";
import { getGitHubAppConfiguration } from "@/lib/github/config";
import { validateRepositoryCoordinate } from "@/lib/github/repository";

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
  const { supabase, user } = await requireGitHubUser();
  const context = await requireGitHubConnection(supabase, user.id, connectionId!, fullName);
  if (!context.repository) throw new Error("repository_context_missing");
  if (managerOnly && !["owner", "admin"].includes(context.role)) {
    throw new GitHubAuthorizationError(
      403,
      "manager_required",
      "Organization owner or administrator access is required.",
    );
  }
  const installationToken = await createGitHubInstallationToken(
    getGitHubAppConfiguration(),
    context.installationId,
    {
      permissions,
      repositoryIds: [context.repository.externalId],
    },
  );
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
