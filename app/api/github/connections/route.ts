import { requireGitHubUser } from "@/lib/github/access";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { activeOrganization, supabase } = await requireGitHubUser();
    const { data: connections, error: connectionsError } = await supabase
      .from("connections")
      .select("id,name,organization_id,status,external_account_label,last_verified_at,error_message")
      .eq("provider", "github")
      .eq("organization_id", activeOrganization.id)
      .order("created_at", { ascending: true });
    if (connectionsError) throw connectionsError;

    const connectionIds = (connections ?? []).map((connection) => connection.id);
    if (!connectionIds.length) return jsonNoStore({ connections: [] });

    const { data: installations, error: installationsError } = await supabase
      .from("github_installations")
      .select("id,connection_id,external_installation_id,account_login,account_type,account_avatar_url,target_type,repository_selection,status,permissions,subscribed_events,suspended_at,installed_at,last_synced_at")
      .eq("organization_id", activeOrganization.id)
      .in("connection_id", connectionIds);
    if (installationsError) throw installationsError;

    const installationIds = (installations ?? []).map((installation) => installation.id);
    const { data: repositories, error: repositoriesError } = installationIds.length
      ? await supabase
        .from("github_repositories")
        .select("id,installation_id,external_repository_id,full_name,default_branch,private,visibility,archived,disabled,html_url,selected,github_updated_at,pushed_at,last_synced_at")
        .eq("organization_id", activeOrganization.id)
        .in("installation_id", installationIds)
        .order("full_name", { ascending: true })
      : { data: [], error: null };
    if (repositoriesError) throw repositoriesError;

    return jsonNoStore({
      connections: (connections ?? []).map((connection) => {
        const installation = (installations ?? []).find(
          (candidate) => candidate.connection_id === connection.id,
        );
        const active = connection.status === "connected"
          && installation?.status === "active"
          && !installation.suspended_at;
        const statusReason = active
          ? null
          : installation?.suspended_at
            ? "The GitHub App installation is suspended."
            : connection.status === "disabled"
              ? "This connection was disconnected in SoftwareFactory."
              : connection.status === "error"
                ? "GitHub access could not be verified. Reconnect or synchronize the installation."
                : "No active GitHub App installation is available.";
        return {
          account: installation
            ? {
              avatarUrl: installation.account_avatar_url,
              login: installation.account_login,
              type: installation.account_type,
            }
            : connection.external_account_label
              ? { login: connection.external_account_label, type: null }
              : null,
          id: connection.id,
          installation: installation
            ? {
              id: installation.external_installation_id,
              installedAt: installation.installed_at,
              lastSyncedAt: installation.last_synced_at,
              permissions: installation.permissions,
              repositorySelection: installation.repository_selection,
              subscribedEvents: installation.subscribed_events,
              suspendedAt: installation.suspended_at,
              targetType: installation.target_type,
            }
            : null,
          name: connection.name,
          repositories: installation
            ? (repositories ?? [])
              .filter((repository) => repository.installation_id === installation.id
                && repository.selected
                && !repository.archived
                && !repository.disabled)
              .map((repository) => ({
                archived: repository.archived,
                defaultBranch: repository.default_branch,
                disabled: repository.disabled,
                fullName: repository.full_name,
                htmlUrl: repository.html_url,
                id: repository.external_repository_id,
                githubUpdatedAt: repository.github_updated_at,
                pushedAt: repository.pushed_at,
                private: repository.private,
                selected: repository.selected,
                visibility: repository.visibility,
              }))
            : [],
          status: active ? "connected" : "not_connected",
          statusLabel: active ? "Connected" : "Not Connected",
          statusReason,
        };
      }),
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
