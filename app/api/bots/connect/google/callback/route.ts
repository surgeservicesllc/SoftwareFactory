import { cookies } from "next/headers";

import {
  discoverFirstProject,
  exchangeGoogleCode,
  readGoogleOAuthConfig,
} from "@/lib/bots/google-oauth";
import { stateMatches } from "@/lib/bots/oauth-pkce";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { sealSecret } from "@/lib/server/secret-box";

/**
 * Completes "Sign in with Google" and stores the Vertex connection.
 *
 * Two credentials come back and only one is worth keeping. The refresh token is
 * durable and is sealed; the access token is used once, here, to discover which
 * Cloud project to address, and is then discarded rather than stored — an hour
 * from now it is worthless, and storing it would mean holding a second secret
 * that buys nothing.
 *
 * The project id is stored beside the token because Vertex calls are scoped to
 * one, and asking someone to paste a project id would put back exactly the
 * typing this flow removes.
 */

export const runtime = "nodejs";

const COOKIE_NAME = "sf_google_pkce";
const CONSOLE_PATH = "/solutions/bot-manager";

function back(origin: string, outcome: string) {
  return Response.redirect(`${origin}${CONSOLE_PATH}?connect=${outcome}`, 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const store = await cookies();
  const clear = () => store.delete({ name: COOKIE_NAME, path: "/api/bots/connect/google" });

  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return back(origin, "expired");

  let pending: { verifier: string; state: string; organizationId: string };
  try {
    pending = JSON.parse(raw);
  } catch {
    clear();
    return back(origin, "invalid");
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  // Without this, another site could send a signed-in person here with a code
  // of its choosing and attach its own Google account to their workspace.
  if (!code || !returnedState || !stateMatches(returnedState, pending.state)) {
    clear();
    return back(origin, "invalid");
  }

  const config = readGoogleOAuthConfig();
  if (!config) {
    clear();
    return back(origin, "failed");
  }

  const exchanged = await exchangeGoogleCode({
    config,
    code,
    codeVerifier: pending.verifier,
    redirectUri: `${origin}/api/bots/connect/google/callback`,
  });
  clear();

  if (!exchanged.ok) return back(origin, "refused");

  try {
    const projectId = await discoverFirstProject(exchanged.accessToken);
    if (!projectId) {
      // Connecting without a project would store a credential that cannot
      // address anything, and would read as connected until the first run.
      return back(origin, "no_project");
    }

    // Sealed as one document: the token is useless for Vertex without the
    // project, and keeping them together means they cannot drift apart.
    const sealed = sealSecret(
      JSON.stringify({ refreshToken: exchanged.refreshToken, projectId }),
      { organizationId: pending.organizationId, purpose: "vertex" },
    );

    const client = createSupabaseGitHubWebhookClient();
    const { error } = await client.rpc("store_provider_credential", {
      p_organization_id: pending.organizationId,
      p_purpose: "vertex",
      p_sealed_envelope: sealed,
    });

    if (error) return back(origin, "failed");

    return back(origin, "connected");
  } catch {
    // Never surfaced: the failure can carry the token in a stack frame.
    return back(origin, "failed");
  }
}
