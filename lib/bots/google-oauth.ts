import "server-only";

/**
 * Sign in with Google, and reach Claude.
 *
 * Anthropic restricted its own OAuth to Claude Code and Claude.ai, so a
 * "Sign in with Claude" button cannot exist in a third-party application. But
 * Claude models are served on Google Cloud's Vertex AI, authenticated with
 * ordinary Google Cloud credentials — and Google OAuth is explicitly available
 * to third parties.
 *
 * So this is the standard login flow, reaching the intended model, through a
 * door that is actually open: one click, Google's own consent screen, back and
 * connected. No key to find, nothing to paste, and no borrowed client id.
 *
 * The scope is `cloud-platform` because that is what Vertex AI requires. It is
 * broad, which is why the consent screen matters: Google shows the person
 * exactly what they are granting, and the refresh token is sealed before it
 * touches storage.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PROJECTS_URL = "https://cloudresourcemanager.googleapis.com/v1/projects";
const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TIMEOUT_MS = 10_000;

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Reads the OAuth client from the environment.
 *
 * Returns `null` when unconfigured rather than throwing, so a deployment that
 * has not set one renders "not available" instead of failing a request. This
 * is the one piece an owner must create once; every person afterwards clicks.
 */
export function readGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return Object.freeze({ clientId, clientSecret });
}

/**
 * Where to send the browser.
 *
 * `access_type=offline` with `prompt=consent` is what makes Google return a
 * refresh token. Without both, a second sign-in returns only an access token
 * that expires in an hour, and the connection silently dies overnight.
 */
export function buildGoogleAuthorizeUrl(input: {
  readonly config: GoogleOAuthConfig;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", VERTEX_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type GoogleTokenResult =
  | { readonly ok: true; readonly refreshToken: string; readonly accessToken: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Redeems the authorization code.
 *
 * The refresh token is the durable half and the only thing worth storing; the
 * access token is used once, here, to find out which project to talk to. The
 * provider's response body is never surfaced — it can echo the code back.
 */
export async function exchangeGoogleCode(input: {
  readonly config: GoogleOAuthConfig;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}): Promise<GoogleTokenResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, reason: `Google refused the sign-in (HTTP ${response.status}).` };
    }

    const body = (await response.json()) as { refresh_token?: unknown; access_token?: unknown };
    if (typeof body.access_token !== "string" || !body.access_token) {
      return { ok: false, reason: "Google returned no usable token." };
    }
    if (typeof body.refresh_token !== "string" || !body.refresh_token) {
      // Without it the connection expires in an hour and cannot renew itself,
      // which would read as "connected" and then quietly stop working.
      return {
        ok: false,
        reason: "Google returned no refresh token, so the connection could not be kept alive.",
      };
    }

    return { ok: true, refreshToken: body.refresh_token, accessToken: body.access_token };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: timedOut ? "Google did not respond in time." : "Google could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finds a Cloud project the person can actually use.
 *
 * Vertex AI calls are scoped to a project, and asking someone to paste a
 * project id would put back the typing this flow exists to remove. Only active
 * projects are considered; a deleted or pending one would resolve and then fail
 * at the first request.
 */
export async function discoverFirstProject(accessToken: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(PROJECTS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      projects?: Array<{ projectId?: unknown; lifecycleState?: unknown }>;
    };

    const active = (body.projects ?? []).find(
      (project) => project.lifecycleState === "ACTIVE" && typeof project.projectId === "string",
    );
    return (active?.projectId as string | undefined) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The shape sealed under the `vertex` purpose by the sign-in callback. */
export interface VertexCredential {
  readonly refreshToken: string;
  readonly projectId: string;
}

/**
 * Reads a stored Vertex connection.
 *
 * Both halves are required. A document with a token and no project is half a
 * credential: there is nothing for Vertex to address, and accepting it would
 * let a broken connection read as ready.
 */
export function parseVertexCredential(opened: string): VertexCredential | null {
  try {
    const parsed = JSON.parse(opened) as Partial<VertexCredential>;
    if (typeof parsed.refreshToken !== "string" || !parsed.refreshToken) return null;
    if (typeof parsed.projectId !== "string" || !parsed.projectId) return null;
    return Object.freeze({ refreshToken: parsed.refreshToken, projectId: parsed.projectId });
  } catch {
    return null;
  }
}

/**
 * Proves a stored Vertex connection still works.
 *
 * Refreshing is the right liveness check for this credential: it is exactly
 * what every real call does first, it costs nothing, and it fails in the ways
 * that matter — a withdrawn grant, a deleted client, a disabled account.
 */
export async function refreshGoogleAccessToken(input: {
  readonly config: GoogleOAuthConfig;
  readonly refreshToken: string;
}): Promise<{ ok: true; accessToken: string } | { ok: false; reason: string; revoked: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        refresh_token: input.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      // Google answers a withdrawn or expired grant with 400 invalid_grant.
      // That needs another sign-in, which being unreachable does not.
      const revoked = response.status === 400 || response.status === 401;
      return {
        ok: false,
        revoked,
        reason: revoked
          ? "Google no longer accepts this connection. Sign in again."
          : `Google returned HTTP ${response.status}.`,
      };
    }

    const body = (await response.json()) as { access_token?: unknown };
    if (typeof body.access_token !== "string" || !body.access_token) {
      return { ok: false, revoked: false, reason: "Google returned no access token." };
    }
    return { ok: true, accessToken: body.access_token };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      revoked: false,
      reason: timedOut ? "Google did not respond in time." : "Google could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}
