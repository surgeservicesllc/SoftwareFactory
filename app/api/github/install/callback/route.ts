import { cookies } from "next/headers";
import { z } from "zod";

import {
  GitHubAuthorizationError,
  requireGitHubUser,
  requireMatchingActiveOrganization,
  requireOrganizationManager,
} from "@/lib/github/access";
import {
  exchangeGitHubUserCode,
  fetchGitHubInstallationSnapshot,
  revokeGitHubUserToken,
  verifyUserCanAccessInstallation,
} from "@/lib/github/client";
import {
  getGitHubAppConfigurationForSlot,
  type GitHubAppConfiguration,
} from "@/lib/github/config";
import {
  githubConnectionsErrorRedirect,
  githubRouteErrorResponse,
  safeGitHubClientError,
} from "@/lib/github/errors";
import {
  GITHUB_INSTALL_STATE_COOKIE,
  GitHubStateError,
  readGitHubInstallStateTarget,
  verifyGitHubInstallState,
} from "@/lib/github/state";
import { persistGitHubInstallationSnapshot } from "@/lib/github/sync";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

const callbackSchema = z.object({
  code: z.string().min(8).max(512),
  installationId: z.coerce.number().int().positive(),
  state: z.string().min(32).max(4096),
});

function acceptsJson(request: Request) {
  return request.headers.get("accept")?.toLowerCase().includes("application/json") ?? false;
}

function callbackRedirect(url: URL) {
  return new Response(null, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Location: url.toString(),
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    },
    status: 303,
  });
}

async function callbackErrorResponse(request: Request, error: unknown) {
  if (acceptsJson(request)) return githubRouteErrorResponse(error);
  const { code, message } = await safeGitHubClientError(error);
  return githubConnectionsErrorRedirect(request.url, code, message);
}

export async function GET(request: Request) {
  let configuration: GitHubAppConfiguration | null = null;
  let userToken: string | null = null;
  try {
    const url = new URL(request.url);
    const cookieStore = await cookies();
    const nonce = cookieStore.get(GITHUB_INSTALL_STATE_COOKIE)?.value;
    cookieStore.delete(GITHUB_INSTALL_STATE_COOKIE);
    if (url.searchParams.has("error") || url.searchParams.get("setup_action") === "request") {
      throw new GitHubAuthorizationError(
        400,
        "github_installation_cancelled",
        "GitHub installation was cancelled or is awaiting organization approval.",
      );
    }
    const parsed = callbackSchema.safeParse({
      code: url.searchParams.get("code"),
      installationId: url.searchParams.get("installation_id"),
      state: url.searchParams.get("state"),
    });
    if (!parsed.success) {
      throw new GitHubAuthorizationError(
        400,
        "invalid_github_callback",
        "GitHub returned an invalid installation callback.",
      );
    }

    const stateTarget = readGitHubInstallStateTarget(parsed.data.state);
    configuration = getGitHubAppConfigurationForSlot(stateTarget.appSlot);
    if (configuration.appId !== stateTarget.appId) {
      throw new GitHubStateError("GitHub installation state does not match the configured App.");
    }
    const { activeOrganization, supabase, user } = await requireGitHubUser();
    const state = verifyGitHubInstallState(
      parsed.data.state,
      nonce,
      user.id,
      configuration.stateSecret,
    );
    if (state.appId !== configuration.appId || state.appSlot !== stateTarget.appSlot) {
      throw new GitHubStateError("GitHub installation state does not match the configured App.");
    }
    requireMatchingActiveOrganization(activeOrganization.id, state.organizationId);
    await requireOrganizationManager(supabase, user.id, state.organizationId);

    userToken = await exchangeGitHubUserCode(configuration, parsed.data.code);
    const userInstallation = await verifyUserCanAccessInstallation(
      userToken,
      parsed.data.installationId,
    );
    if (userInstallation.app_id !== configuration.appId) {
      throw new GitHubAuthorizationError(
        403,
        "wrong_github_app",
        "The installation belongs to a different GitHub App.",
      );
    }

    const snapshot = await fetchGitHubInstallationSnapshot(
      configuration,
      parsed.data.installationId,
    );
    const result = await persistGitHubInstallationSnapshot(
      supabase,
      user.id,
      state.organizationId,
      snapshot,
    );

    if (acceptsJson(request)) {
      return jsonNoStore({
        connectionId: result.connection_id,
        installation: {
          account: snapshot.account,
          id: snapshot.id,
          repositoryCount: result.repository_count,
          status: snapshot.suspendedAt ? "suspended" : "connected",
        },
      });
    }

    const redirect = new URL(state.returnTo, configuration.callbackUrl);
    redirect.searchParams.set("github", "connected");
    redirect.searchParams.set("connectionId", result.connection_id);
    redirect.searchParams.set("repositories", String(result.repository_count));
    return callbackRedirect(redirect);
  } catch (error) {
    return callbackErrorResponse(request, error);
  } finally {
    if (userToken && configuration) {
      try {
        await revokeGitHubUserToken(configuration, userToken);
      } catch {
        // Configuration/provider failures are handled by the primary flow. The
        // short-lived token is never persisted or returned regardless.
      }
    }
  }
}
