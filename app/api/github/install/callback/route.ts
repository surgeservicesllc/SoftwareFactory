import { cookies } from "next/headers";
import { z } from "zod";

import { requireGitHubUser, requireOrganizationManager } from "@/lib/github/access";
import {
  exchangeGitHubUserCode,
  fetchGitHubInstallationSnapshot,
  revokeGitHubUserToken,
  verifyUserCanAccessInstallation,
} from "@/lib/github/client";
import { getGitHubAppConfiguration } from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { GITHUB_INSTALL_STATE_COOKIE, verifyGitHubInstallState } from "@/lib/github/state";
import { persistGitHubInstallationSnapshot } from "@/lib/github/sync";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

const callbackSchema = z.object({
  code: z.string().min(8).max(512),
  installationId: z.coerce.number().int().positive(),
  state: z.string().min(32).max(4096),
});

export async function GET(request: Request) {
  let userToken: string | null = null;
  try {
    const url = new URL(request.url);
    if (url.searchParams.has("error") || url.searchParams.get("setup_action") === "request") {
      const cookieStore = await cookies();
      cookieStore.delete(GITHUB_INSTALL_STATE_COOKIE);
      return jsonNoStore(
        {
          error: {
            code: "github_installation_cancelled",
            message: "GitHub installation was cancelled or is awaiting organization approval.",
          },
        },
        { status: 400 },
      );
    }
    const parsed = callbackSchema.safeParse({
      code: url.searchParams.get("code"),
      installationId: url.searchParams.get("installation_id"),
      state: url.searchParams.get("state"),
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_github_callback", message: "GitHub returned an invalid installation callback." } },
        { status: 400 },
      );
    }

    const configuration = getGitHubAppConfiguration();
    const { supabase, user } = await requireGitHubUser();
    const cookieStore = await cookies();
    const nonce = cookieStore.get(GITHUB_INSTALL_STATE_COOKIE)?.value;
    cookieStore.delete(GITHUB_INSTALL_STATE_COOKIE);
    const state = verifyGitHubInstallState(
      parsed.data.state,
      nonce,
      user.id,
      configuration.stateSecret,
    );
    await requireOrganizationManager(supabase, user.id, state.organizationId);

    userToken = await exchangeGitHubUserCode(configuration, parsed.data.code);
    const userInstallation = await verifyUserCanAccessInstallation(
      userToken,
      parsed.data.installationId,
    );
    if (userInstallation.app_id !== configuration.appId) {
      return jsonNoStore(
        { error: { code: "wrong_github_app", message: "The installation belongs to a different GitHub App." } },
        { status: 403 },
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

    if (request.headers.get("accept")?.includes("application/json")) {
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
    const response = Response.redirect(redirect, 303);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    return githubRouteErrorResponse(error);
  } finally {
    if (userToken) {
      try {
        await revokeGitHubUserToken(getGitHubAppConfiguration(), userToken);
      } catch {
        // Configuration/provider failures are handled by the primary flow. The
        // short-lived token is never persisted or returned regardless.
      }
    }
  }
}
