import "server-only";

import {
  createGitHubInstallationToken,
  githubApiRequest,
} from "@/lib/github/client";
import { getGitHubAppConfigurationForAppId } from "@/lib/github/config";

/**
 * Wakes the auth-broker worker the moment a sign-in session opens, so the
 * person is not waiting on a cron. Best-effort by design: the event carries
 * nothing (the worker claims from the database, which is the only authority),
 * and any failure here just means the workflow's schedule picks the session
 * up instead.
 */

export const AUTH_BROKER_DISPATCH_EVENT = "softwarefactory_auth_broker";

type TargetRow = {
  app_id: number;
  external_installation_id: number;
  external_repository_id: number;
  repository_full_name: string;
};

type TenantClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        limit: (count: number) => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
  rpc: (fn: string, args?: Record<string, unknown>) => {
    single: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  };
};

/**
 * Resolves any live installation the organization has — via its executable
 * projects — and posts the dispatch. Returns whether a wake was sent; false
 * is not an error, it is "the cron will get it".
 *
 * The parameter is `unknown` on purpose: comparing the full Supabase client
 * type against a structural query-builder shape sends the compiler into deep
 * instantiation (TS2589), and this function only touches two methods. The
 * narrow cast happens once, here, instead of at every call site.
 */
export async function wakeAuthBrokerWorker(
  clientLike: unknown,
  organizationId: string,
): Promise<boolean> {
  const client = clientLike as TenantClient;
  try {
    const { data } = await client
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(5);
    const projects = (data ?? []) as Array<{ id: string }>;

    for (const project of projects) {
      const { data: targetData, error } = await client
        .rpc("resolve_phase1c_command_target", {
          p_organization_id: organizationId,
          p_project_id: project.id,
        })
        .single();
      if (error || !targetData) continue;

      const target = targetData as TargetRow;
      const [owner, repository] = target.repository_full_name.split("/");
      if (!owner || !repository) continue;

      const configuration = getGitHubAppConfigurationForAppId(target.app_id);
      const installationToken = await createGitHubInstallationToken(
        configuration,
        target.external_installation_id,
        {
          permissions: { contents: "write", metadata: "read" },
          repositoryIds: [target.external_repository_id],
        },
      );
      await githubApiRequest(`/repos/${owner}/${repository}/dispatches`, {
        body: { event_type: AUTH_BROKER_DISPATCH_EVENT, client_payload: {} },
        method: "POST",
        token: installationToken.token,
      });
      return true;
    }
  } catch {
    // Fall through: the schedule is the fallback path.
  }
  return false;
}
