import { cookies } from "next/headers";
import { z } from "zod";

import {
  requireGitHubUser,
  requireMatchingActiveOrganization,
  requireOrganizationManager,
} from "@/lib/github/access";
import {
  getGitHubAppConfigurationEntries,
  getGitHubAppConfigurationForSlot,
} from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import {
  buildGitHubInstallAuthorizationUrl,
  createGitHubInstallState,
  GITHUB_INSTALL_STATE_COOKIE,
  githubInstallStateCookieOptions,
  normalizeReturnTo,
} from "@/lib/github/state";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const requestSchema = z.object({
  appSlot: z.enum(["primary", "candidate"]).default("primary"),
  organizationId: z.string().uuid(),
  returnTo: z.string().max(512).optional(),
}).strict();

export async function GET() {
  try {
    const { activeOrganization, supabase, user } = await requireGitHubUser();
    await requireOrganizationManager(supabase, user.id, activeOrganization.id);
    return jsonNoStore({
      apps: getGitHubAppConfigurationEntries().map(({ configuration, slot }) => ({
        appId: configuration.appId,
        appSlug: configuration.appSlug,
        slot,
      })),
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = requestSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_install_request", message: "The GitHub installation request is invalid." } },
        { status: 400 },
      );
    }

    const configuration = getGitHubAppConfigurationForSlot(parsed.data.appSlot);
    const { activeOrganization, supabase, user } = await requireGitHubUser();
    requireMatchingActiveOrganization(
      activeOrganization.id,
      parsed.data.organizationId,
    );
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

    return jsonNoStore({
      appSlot: parsed.data.appSlot,
      authorizationUrl: buildGitHubInstallAuthorizationUrl(configuration.appSlug, state.token),
      expiresAt: state.expiresAt,
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
