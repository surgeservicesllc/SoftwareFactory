import { cookies } from "next/headers";
import { z } from "zod";

import { requireGitHubUser, requireOrganizationManager } from "@/lib/github/access";
import { getGitHubAppConfiguration } from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import {
  createGitHubInstallState,
  GITHUB_INSTALL_STATE_COOKIE,
  normalizeReturnTo,
} from "@/lib/github/state";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  returnTo: z.string().max(512).optional(),
}).strict();

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

    const configuration = getGitHubAppConfiguration();
    const { supabase, user } = await requireGitHubUser();
    await requireOrganizationManager(supabase, user.id, parsed.data.organizationId);
    const state = createGitHubInstallState(
      {
        organizationId: parsed.data.organizationId,
        returnTo: normalizeReturnTo(parsed.data.returnTo),
        userId: user.id,
      },
      configuration.stateSecret,
    );

    const cookieStore = await cookies();
    cookieStore.set(GITHUB_INSTALL_STATE_COOKIE, state.nonce, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/api/github/install",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    const authorizationUrl = new URL(
      `https://github.com/apps/${encodeURIComponent(configuration.appSlug)}/installations/new`,
    );
    authorizationUrl.searchParams.set("state", state.token);

    return jsonNoStore({
      authorizationUrl: authorizationUrl.toString(),
      expiresAt: state.expiresAt,
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
