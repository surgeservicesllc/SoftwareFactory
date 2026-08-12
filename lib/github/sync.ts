import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import type { GitHubInstallationSnapshot } from "@/lib/github/types";

type SyncResult = {
  connection_id: string;
  installation_id: string;
  repository_count: number;
  was_created: boolean;
};

export async function persistGitHubInstallationSnapshot(
  supabase: SupabaseClient,
  actorUserId: string,
  organizationId: string,
  snapshot: GitHubInstallationSnapshot,
  connectionId?: string,
) {
  void supabase;
  const repositories = snapshot.repositories.map((repository) => ({
    archived: repository.archived,
    default_branch: repository.defaultBranch,
    disabled: repository.disabled,
    full_name: repository.fullName,
    github_updated_at: repository.githubUpdatedAt,
    html_url: repository.htmlUrl,
    id: repository.id,
    name: repository.name,
    node_id: repository.nodeId,
    owner_login: repository.ownerLogin,
    permissions: repository.permissions,
    private: repository.private,
    pushed_at: repository.pushedAt,
    visibility: repository.visibility,
  }));

  const privilegedClient = createSupabaseGitHubWebhookClient();
  const { data, error } = await privilegedClient.rpc("sync_github_installation", {
    p_account_avatar_url: snapshot.account.avatarUrl,
    p_account_id: snapshot.account.id,
    p_account_login: snapshot.account.login,
    p_account_type: snapshot.account.type,
    p_actor_user_id: actorUserId,
    p_app_id: snapshot.appId,
    p_app_slug: snapshot.appSlug,
    p_connection_id: connectionId ?? null,
    p_external_installation_id: snapshot.id,
    p_installed_at: snapshot.installedAt,
    p_organization_id: organizationId,
    p_permissions: snapshot.permissions,
    p_repositories: repositories,
    p_repository_selection: snapshot.repositorySelection,
    p_subscribed_events: snapshot.events,
    p_suspended_at: snapshot.suspendedAt,
    p_target_type: snapshot.targetType,
  }).single();
  if (error) throw error;
  return data as SyncResult;
}
