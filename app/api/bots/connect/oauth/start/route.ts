import { cookies } from "next/headers";

import { buildAuthorizeUrl, createPkceChallenge } from "@/lib/bots/oauth-pkce";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { isCredentialStoreConfigured } from "@/lib/server/secret-box";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Begins a one-click sign-in.
 *
 * Redirects the browser to OpenRouter and keeps the PKCE verifier in an
 * httpOnly cookie. The cookie rather than the database is deliberate: the
 * verifier is only meaningful to the browser that started this, it must not
 * outlive the round trip, and storing it server-side would mean a row to expire
 * and reap for something a cookie already scopes correctly.
 */

export const runtime = "nodejs";

const COOKIE_NAME = "sf_oauth_pkce";
const COOKIE_TTL_SECONDS = 600;

export async function GET(request: Request) {
  try {
    // Membership first: this mints a redirect that will attach a credential to
    // whichever organization is active when the callback lands.
    const { activeOrganization } = await requireActiveOrganization();

    if (!isCredentialStoreConfigured()) {
      return jsonNoStore(
        {
          error: {
            code: "credential_store_not_configured",
            message:
              "SOFTWAREFACTORY_CREDENTIAL_KEY is not set, so a signed-in credential could not be stored.",
          },
        },
        { status: 503 },
      );
    }

    const origin = new URL(request.url).origin;
    const challenge = createPkceChallenge();

    const store = await cookies();
    store.set(COOKIE_NAME, JSON.stringify({
      verifier: challenge.verifier,
      state: challenge.state,
      organizationId: activeOrganization.id,
    }), {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      // Lax rather than Strict: the callback is a top-level navigation from
      // another site, which Strict would drop, taking the verifier with it.
      sameSite: "lax",
      path: "/api/bots/connect/oauth",
      maxAge: COOKIE_TTL_SECONDS,
    });

    return Response.redirect(
      buildAuthorizeUrl(challenge, `${origin}/api/bots/connect/oauth/callback`),
      302,
    );
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "connect_session_failed",
      "The sign-in could not be started.",
    );
  }
}
