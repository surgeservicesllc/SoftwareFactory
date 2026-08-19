import { cookies } from "next/headers";

import { exchangeCodeForKey, readPendingSignIn, stateMatches } from "@/lib/bots/oauth-pkce";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { sealSecret } from "@/lib/server/secret-box";

/**
 * Completes a one-click sign-in.
 *
 * The browser arrives here from OpenRouter carrying an authorization code. Two
 * things are checked before that code is worth anything:
 *
 *   The state must match the cookie. Without it, any site could send a browser
 *   here with a code of its own choosing and attach an attacker's credential to
 *   the signed-in person's workspace. The comparison is constant-time because
 *   the returned value is attacker-supplied.
 *
 *   The verifier must come from the cookie, not the request. That is the whole
 *   point of PKCE: a code intercepted in the redirect is useless without a
 *   secret that never travelled.
 *
 * The organization is read from the cookie too, set when the flow began. Reading
 * it from the session here instead would let a person who switched workspaces
 * mid-flow attach the credential to the wrong one.
 *
 * The key is sealed the moment it exists and is never logged, echoed, or put in
 * a redirect URL.
 */

export const runtime = "nodejs";

const COOKIE_NAME = "sf_oauth_pkce";
const CONSOLE_PATH = "/solutions/bot-manager";

/** Every failure returns here. The reason is a code, never a provider message. */
function back(origin: string, outcome: string) {
  return Response.redirect(`${origin}${CONSOLE_PATH}?connect=${outcome}`, 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const store = await cookies();

  // Cleared on every path, success or failure. A verifier that outlives its
  // round trip is a credential waiting to be replayed.
  const clear = () => store.delete({ name: COOKIE_NAME, path: "/api/bots/connect/oauth" });

  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return back(origin, "expired");

  const pending = readPendingSignIn(raw);
  if (!pending) {
    clear();
    return back(origin, "invalid");
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  if (!code || !returnedState || !stateMatches(returnedState, pending.state)) {
    clear();
    return back(origin, "invalid");
  }

  const exchanged = await exchangeCodeForKey(code, pending.verifier);
  clear();

  if (!exchanged.ok) return back(origin, "refused");

  try {
    const sealed = sealSecret(exchanged.key, {
      organizationId: pending.organizationId,
      purpose: "openrouter",
    });

    const client = createSupabaseGitHubWebhookClient();
    const { error } = await client.rpc("store_provider_credential", {
      p_organization_id: pending.organizationId,
      p_purpose: "openrouter",
      p_sealed_envelope: sealed,
    });

    if (error) return back(origin, "failed");

    return back(origin, "connected");
  } catch {
    // Never surface the failure: it can carry the key in a stack frame.
    return back(origin, "failed");
  }
}
