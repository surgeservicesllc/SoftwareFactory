import { cookies } from "next/headers";

import { buildGoogleAuthorizeUrl, readGoogleOAuthConfig } from "@/lib/bots/google-oauth";
import { createPkceChallenge } from "@/lib/bots/oauth-pkce";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { isCredentialStoreConfigured } from "@/lib/server/secret-box";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Begins "Sign in with Google" for Claude on Vertex AI.
 *
 * Same shape as the OpenRouter flow, and for the same reason: the verifier and
 * the organization live in an httpOnly cookie for the length of the round trip,
 * so a callback can be tied to the browser that started it.
 */

export const runtime = "nodejs";

const COOKIE_NAME = "sf_google_pkce";

export async function GET(request: Request) {
  try {
    const { activeOrganization } = await requireActiveOrganization();

    const config = readGoogleOAuthConfig();
    if (!config) {
      return jsonNoStore(
        {
          error: {
            code: "google_oauth_not_configured",
            message:
              "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not set, so Google sign-in is unavailable.",
          },
        },
        { status: 503 },
      );
    }
    if (!isCredentialStoreConfigured()) {
      return jsonNoStore(
        {
          error: {
            code: "credential_store_not_configured",
            message: "SOFTWAREFACTORY_CREDENTIAL_KEY is not set, so the connection could not be stored.",
          },
        },
        { status: 503 },
      );
    }

    const origin = new URL(request.url).origin;
    const redirectUri = `${origin}/api/bots/connect/google/callback`;
    const challenge = createPkceChallenge();

    const store = await cookies();
    store.set(COOKIE_NAME, JSON.stringify({
      verifier: challenge.verifier,
      state: challenge.state,
      organizationId: activeOrganization.id,
    }), {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      // Lax, because the callback is a top-level navigation from Google that
      // Strict would drop along with the verifier.
      sameSite: "lax",
      path: "/api/bots/connect/google",
      maxAge: 600,
    });

    return Response.redirect(
      buildGoogleAuthorizeUrl({
        config, redirectUri, state: challenge.state, codeChallenge: challenge.challenge,
      }),
      302,
    );
  } catch (error) {
    return botFabricErrorResponse(error, "connect_session_failed", "The sign-in could not be started.");
  }
}
