import { z } from "zod";

import { requireGitHubConnection, requireGitHubUser, requireOrganizationManager } from "@/lib/github/access";
import { fetchGitHubInstallationSnapshot, GitHubApiError } from "@/lib/github/client";
import { getGitHubAppConfiguration } from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { persistGitHubInstallationSnapshot } from "@/lib/github/sync";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { jsonNoStore } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { connectionId } = await params;
    if (!z.string().uuid().safeParse(connectionId).success) {
      return jsonNoStore(
        { error: { code: "invalid_connection_id", message: "Connection id must be a UUID." } },
        { status: 400 },
      );
    }
    const configuration = getGitHubAppConfiguration();
    const { activeOrganization, supabase, user } = await requireGitHubUser();
    const context = await requireGitHubConnection(
      supabase,
      user.id,
      activeOrganization.id,
      connectionId,
      undefined,
      { allowInactive: true },
    );
    await requireOrganizationManager(supabase, user.id, context.organizationId);
    const snapshot = await fetchGitHubInstallationSnapshot(configuration, context.installationId);
    const result = await persistGitHubInstallationSnapshot(
      supabase,
      user.id,
      context.organizationId,
      snapshot,
      context.connectionId,
    );
    return jsonNoStore({
      connectionId: result.connection_id,
      repositoryCount: result.repository_count,
      status: snapshot.suspendedAt ? "not_connected" : "connected",
      statusLabel: snapshot.suspendedAt ? "Not Connected" : "Connected",
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (
      error instanceof GitHubApiError
      && ["github_installation_revoked", "github_permission_denied"].includes(error.code)
    ) {
      try {
        const { connectionId } = await params;
        const { activeOrganization, supabase, user } = await requireGitHubUser();
        await requireGitHubConnection(
          supabase,
          user.id,
          activeOrganization.id,
          connectionId,
          undefined,
          { allowInactive: true },
        );
        await createSupabaseGitHubWebhookClient().rpc("mark_github_connection_lost", {
          p_actor_user_id: user.id,
          p_connection_id: connectionId,
          p_reason: error.code === "github_installation_revoked"
            ? "installation_revoked"
            : "insufficient_permission",
        });
      } catch {
        // The provider failure remains the client-safe primary error.
      }
    }
    return githubRouteErrorResponse(error);
  }
}
