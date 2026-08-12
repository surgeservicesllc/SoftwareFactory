import { z } from "zod";

import { requireGitHubConnection, requireGitHubUser } from "@/lib/github/access";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const connectionId = new URL(request.url).searchParams.get("connectionId");
    if (!z.string().uuid().safeParse(connectionId).success) {
      return jsonNoStore(
        { error: { code: "invalid_connection_id", message: "Connection id must be a UUID." } },
        { status: 400 },
      );
    }
    const { supabase, user } = await requireGitHubUser();
    const context = await requireGitHubConnection(supabase, user.id, connectionId!);
    const { data, error } = await supabase
      .from("github_repositories")
      .select("external_repository_id,full_name,default_branch,private,visibility,archived,disabled,html_url,selected,github_updated_at,pushed_at,last_synced_at")
      .eq("installation_id", context.internalInstallationId)
      .eq("selected", true)
      .order("full_name", { ascending: true });
    if (error) throw error;
    return jsonNoStore({
      repositories: (data ?? []).map((repository) => ({
        archived: repository.archived,
        defaultBranch: repository.default_branch,
        disabled: repository.disabled,
        fullName: repository.full_name,
        htmlUrl: repository.html_url,
        id: repository.external_repository_id,
        githubUpdatedAt: repository.github_updated_at,
        lastSyncedAt: repository.last_synced_at,
        private: repository.private,
        pushedAt: repository.pushed_at,
        selected: repository.selected,
        visibility: repository.visibility,
      })),
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
