import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One-click provider sign-in, by the only route that is actually one click.
 *
 * The previous flow handed someone a command to copy into a terminal. That was
 * honest — Anthropic and OpenAI have no third-party OAuth, so a subscription
 * credential can only be minted by their own tools — but it is friction, and
 * for most people the friction buys nothing they wanted.
 *
 * OpenRouter is the exception, and it is a real one: it publishes a documented
 * OAuth PKCE flow for third-party applications, and it fronts Claude, GPT,
 * Gemini and the rest behind a single credential. So signing in there is one
 * click, no terminal, no key, no variable name — and it yields Claude.
 *
 * PKCE is used rather than a client secret because this application has no
 * registered secret with OpenRouter and does not need one. The verifier never
 * leaves the server, and the authorization code is useless without it.
 */

export interface PkceChallenge {
  /** Held server-side; proves the app that redeems the code is the one that started. */
  readonly verifier: string;
  /** Sent to the provider; a hash, so interception of the redirect reveals nothing. */
  readonly challenge: string;
  /** Ties the callback to this browser, defeating a cross-site forged callback. */
  readonly state: string;
}

/**
 * Creates a fresh challenge.
 *
 * 32 bytes each. The verifier is the secret half and the state is a nonce; both
 * are generated the same way because both must be unguessable.
 */
export function createPkceChallenge(): PkceChallenge {
  const verifier = randomBytes(32).toString("base64url");

  return Object.freeze({
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  });
}

/** Constant-time state comparison: a returned state is attacker-supplied input. */
export function stateMatches(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

const AUTHORIZE_URL = "https://openrouter.ai/auth";
const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const EXCHANGE_TIMEOUT_MS = 10_000;

/**
 * Where to send the browser.
 *
 * `callback_url` must match what is registered with the redirect, and it is
 * built from the request's own origin so a preview deployment signs in against
 * itself rather than against production.
 */
export function buildAuthorizeUrl(challenge: PkceChallenge, callbackUrl: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Carried through the provider and compared on return. OpenRouter echoes
  // unknown parameters back on the callback.
  url.searchParams.set("state", challenge.state);
  return url.toString();
}

export type ExchangeResult =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Redeems an authorization code for a key.
 *
 * Never throws and never surfaces the provider's response body: an error body
 * can echo the code back, and this result is rendered. The key it returns is
 * handled by exactly one caller, which seals it immediately.
 */
export async function exchangeCodeForKey(
  code: string,
  verifier: string,
): Promise<ExchangeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);

  try {
    const response = await fetch(EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: "S256",
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, reason: `The provider refused the sign-in (HTTP ${response.status}).` };
    }

    const body = (await response.json()) as { key?: unknown };
    if (typeof body.key !== "string" || body.key.length < 8) {
      return { ok: false, reason: "The provider returned no usable key." };
    }

    return { ok: true, key: body.key };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: timedOut ? "The provider did not respond in time." : "The provider could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the start route stored, once it has been proven to be that.
 *
 * Both provider callbacks read a cookie they set themselves, so the shape
 * "should" be right — and both parsed it and used it directly. Valid JSON is
 * not a valid cookie: `{}` parses, and a cookie left over from an older format
 * across a deploy parses too. The missing field then reached `stateMatches`,
 * which throws on a non-string rather than returning false, so the route
 * answered 500 instead of an outcome — and threw before clearing the cookie,
 * so every retry failed identically until the TTL ran out.
 *
 * Returning null rather than throwing keeps the decision at the call site,
 * where the cookie can be cleared and a named outcome returned.
 */
export interface PendingSignIn {
  readonly verifier: string;
  readonly state: string;
  readonly organizationId: string;
}

export function readPendingSignIn(raw: string): PendingSignIn | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const candidate = parsed as Record<string, unknown>;
  const fields = ["verifier", "state", "organizationId"] as const;
  for (const field of fields) {
    const value = candidate[field];
    if (typeof value !== "string" || value.length === 0) return null;
  }

  return Object.freeze({
    verifier: candidate.verifier as string,
    state: candidate.state as string,
    organizationId: candidate.organizationId as string,
  });
}
