import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { GitHubConnectionContext } from "@/lib/github/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";

export class GitHubAuthorizationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GitHubAuthorizationError";
    this.status = status;
    this.code = code;
  }
}

export async function requireGitHubUser(): Promise<{
  supabase: SupabaseClient;
  user: User;
}> {
  const supabase = await createSupabaseServerClient();
  const { user } = await requireAuthenticatedUser(supabase);
  return { supabase, user };
}

export async function requireOrganizationManager(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
) {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new GitHubAuthorizationError(500, "membership_lookup_failed", "Organization access could not be verified.");
  }
  if (!data || !["owner", "admin"].includes(data.role)) {
    throw new GitHubAuthorizationError(
      403,
      "manager_required",
      "Organization owner or administrator access is required.",
    );
  }
  return data.role as "owner" | "admin";
}

export async function requireGitHubConnection(
  supabase: SupabaseClient,
  userId: string,
  connectionId: string,
  repositoryFullName?: string,
  options: { allowInactive?: boolean } = {},
): Promise<GitHubConnectionContext> {
  const { data: connection, error: connectionError } = await supabase
    .from("connections")
    .select("id,organization_id,provider,status")
    .eq("id", connectionId)
    .eq("provider", "github")
    .maybeSingle();
  if (connectionError) {
    throw new GitHubAuthorizationError(500, "connection_lookup_failed", "GitHub connection access could not be verified.");
  }
  if (!connection) {
    throw new GitHubAuthorizationError(404, "github_connection_not_found", "The GitHub connection was not found.");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", connection.organization_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError || !membership) {
    throw new GitHubAuthorizationError(403, "forbidden", "The GitHub connection is not available to this user.");
  }

  const { data: installation, error: installationError } = await supabase
    .from("github_installations")
    .select("id,external_installation_id,status")
    .eq("connection_id", connection.id)
    .maybeSingle();
  if (installationError) {
    throw new GitHubAuthorizationError(500, "installation_lookup_failed", "GitHub installation access could not be verified.");
  }
  if (!installation || (!options.allowInactive && (
    installation.status !== "active" || connection.status !== "connected"
  ))) {
    throw new GitHubAuthorizationError(503, "github_not_connected", "This GitHub installation is Not Connected.");
  }

  let repository: GitHubConnectionContext["repository"] = null;
  if (repositoryFullName) {
    const { data: repositories, error } = await supabase
      .from("github_repositories")
      .select("id,external_repository_id,full_name,default_branch,selected,archived,disabled")
      .eq("installation_id", installation.id);
    if (error) {
      throw new GitHubAuthorizationError(500, "repository_lookup_failed", "Repository access could not be verified.");
    }
    const normalizedFullName = repositoryFullName.toLowerCase();
    const matchingRepositories = (repositories ?? []).filter(
      (candidate) => candidate.full_name.toLowerCase() === normalizedFullName,
    );
    if (matchingRepositories.length > 1) {
      throw new GitHubAuthorizationError(500, "repository_lookup_failed", "Repository access could not be verified.");
    }
    const data = matchingRepositories[0];
    if (!data || !data.selected) {
      throw new GitHubAuthorizationError(
        404,
        "github_repository_not_selected",
        "The repository is not selected for this GitHub App installation.",
      );
    }
    if (data.archived || data.disabled) {
      throw new GitHubAuthorizationError(409, "github_repository_read_only", "The repository is archived or disabled.");
    }
    repository = {
      archived: data.archived,
      defaultBranch: data.default_branch,
      disabled: data.disabled,
      externalId: data.external_repository_id,
      fullName: data.full_name,
      id: data.id,
      selected: data.selected,
    };
  }

  return {
    connectionId: connection.id,
    installationId: installation.external_installation_id,
    internalInstallationId: installation.id,
    organizationId: connection.organization_id,
    repository,
    role: membership.role,
    status: installation.status,
    userId,
  };
}
