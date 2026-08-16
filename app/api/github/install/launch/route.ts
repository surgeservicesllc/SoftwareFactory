import { cookies } from "next/headers";
import { z } from "zod";

import {
  requireGitHubUser,
  requireMatchingActiveOrganization,
  requireOrganizationManager,
} from "@/lib/github/access";
import { getGitHubAppConfigurationForSlot } from "@/lib/github/config";
import {
  githubConnectionsErrorRedirect,
  safeGitHubClientError,
} from "@/lib/github/errors";
import {
  buildGitHubInstallAuthorizationUrl,
  createGitHubInstallState,
  GITHUB_INSTALL_STATE_COOKIE,
  githubInstallStateCookieOptions,
  normalizeReturnTo,
} from "@/lib/github/state";

/**
 * Starts a GitHub App installation as a single top-level navigation.
 *
 * The console used to POST to `/install/start` with `fetch` and then redirect
 * the browser to the URL it returned. That set the anti-forgery state cookie on
 * a background `fetch` response — and Safari on iOS/iPadOS is entitled, under
 * its tracking prevention, to drop cookies set on such responses. When it did,
 * the callback found no cookie to match the state token against and the install
 * failed only on those devices. Setting the cookie on this navigation's own
 * redirect response is honored the same way on every browser, so the flow works
 * on all devices.
 *
 * This is a GET so a plain link/navigation can reach it; a top-level GET
 * navigation carries no `Origin` header, so there is no same-origin assertion.
 * That is safe here: the handler requires an authenticated session and an
 * owner/admin of the *active* organization, and its only effect is to send that
 * person to GitHub's own installation-approval screen. The state it mints is
 * bound to the user and organization and is fully re-verified at the callback.
 */

export const runtime = "nodejs";

const launchSchema = z
  .object({
    appSlot: z.enum(["primary", "candidate"]).default("primary"),
    organizationId: z.string().uuid(),
    returnTo: z.string().max(512).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const parsed = launchSchema.safeParse({
      appSlot: url.searchParams.get("appSlot") ?? undefined,
      organizationId: url.searchParams.get("organizationId") ?? undefined,
      returnTo: url.searchParams.get("returnTo") ?? undefined,
    });
    if (!parsed.success) {
      return githubConnectionsErrorRedirect(
        request.url,
        "invalid_install_request",
        "The GitHub installation request is invalid.",
      );
    }

    const configuration = getGitHubAppConfigurationForSlot(parsed.data.appSlot);
    const { activeOrganization, supabase, user } = await requireGitHubUser();
    requireMatchingActiveOrganization(activeOrganization.id, parsed.data.organizationId);
    await requireOrganizationManager(supabase, user.id, parsed.data.organizationId);

    const state = createGitHubInstallState(
      {
        appId: configuration.appId,
        appSlot: parsed.data.appSlot,
        organizationId: parsed.data.organizationId,
        returnTo: normalizeReturnTo(parsed.data.returnTo),
        userId: user.id,
      },
      configuration.stateSecret,
    );

    const cookieStore = await cookies();
    cookieStore.set(
      GITHUB_INSTALL_STATE_COOKIE,
      state.nonce,
      githubInstallStateCookieOptions(),
    );

    return new Response(null, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Location: buildGitHubInstallAuthorizationUrl(configuration.appSlug, state.token),
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
      },
      status: 303,
    });
  } catch (error) {
    const { code, message } = await safeGitHubClientError(error);
    return githubConnectionsErrorRedirect(request.url, code, message);
  }
}
