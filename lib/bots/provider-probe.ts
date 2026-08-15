import "server-only";

import type { BotProviderId } from "@/lib/bots/catalog";

/**
 * Does this credential actually work?
 *
 * Presence answers "a variable is populated", which is not the same question. A
 * revoked key, a key on an account with no credit, and a healthy key are all
 * indistinguishable until something calls the provider. That gap is what let
 * Phase 1C report a configured worker and then fail on the first real turn with
 * an exhausted balance.
 *
 * Every endpoint below is a **model-list** endpoint. They are unbilled: they
 * enumerate what the account may use and consume no tokens, so verification
 * costs nothing per check and cannot be turned into spend by checking often.
 * Nothing here ever performs a completion.
 *
 * This module is server-only for a reason beyond convention. It is the only
 * place a bot credential's *value* is read, and it never returns, logs, echoes,
 * measures, or stores it. Callers receive a verdict and a sentence.
 */

export type ProbeVerdict =
  /** The provider accepted the credential. */
  | "verified"
  /** The provider rejected it: wrong, revoked, or lacking permission. */
  | "rejected"
  /** Authenticated correctly, but the account cannot serve requests. */
  | "no_credit"
  /** Authenticated correctly, but throttled right now. Transient. */
  | "rate_limited"
  /** The provider could not be reached, or answered with its own fault. */
  | "unreachable"
  /** No credential is configured, so there is nothing to verify. */
  | "not_configured"
  /** Verification is not possible for this provider's shape. */
  | "not_probed";

export interface ProbeResult {
  readonly verdict: ProbeVerdict;
  readonly reason: string;
  /** Whether this verdict came from actually contacting the provider. */
  readonly live: boolean;
}

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Where each provider answers "which models may this credential use".
 *
 * `query` marks providers that take the key as a URL parameter rather than a
 * header — Gemini is the only one. That URL must never be logged or surfaced,
 * which is why the request below builds it locally and no error path includes
 * it in a message.
 */
type ProbeEndpoint = {
  readonly url: string;
  readonly auth: "bearer" | "x-api-key" | "query";
  readonly extraHeaders?: Readonly<Record<string, string>>;
};

const PROBE_ENDPOINTS: Partial<Record<BotProviderId, ProbeEndpoint>> = {
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    auth: "x-api-key",
    extraHeaders: { "anthropic-version": "2023-06-01" },
  },
  openai: { url: "https://api.openai.com/v1/models", auth: "bearer" },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    auth: "query",
  },
  xai: { url: "https://api.x.ai/v1/models", auth: "bearer" },
  mistral: { url: "https://api.mistral.ai/v1/models", auth: "bearer" },
  deepseek: { url: "https://api.deepseek.com/models", auth: "bearer" },
  groq: { url: "https://api.groq.com/openai/v1/models", auth: "bearer" },
  // `/key` rather than `/models`: OpenRouter serves its model catalogue
  // publicly, so listing it would succeed with no credential at all and every
  // key would verify. This endpoint requires the credential.
  openrouter: { url: "https://openrouter.ai/api/v1/key", auth: "bearer" },
};

/** Error codes that mean "authenticated, but the account cannot pay". */
const NO_CREDIT_CODES = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "billing_hard_limit_reached",
  "quota_exceeded",
  "insufficient_balance",
]);

function verdict(verdictName: ProbeVerdict, reason: string, live: boolean): ProbeResult {
  return Object.freeze({ verdict: verdictName, reason, live });
}

/**
 * Reads only the machine-readable code from an error body.
 *
 * The body is never surfaced. A provider error message can echo request data,
 * and this result reaches a browser.
 */
async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; type?: unknown; status?: unknown };
    };
    const raw = body.error?.code ?? body.error?.type ?? body.error?.status;
    return typeof raw === "string" ? raw.toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Verifies one credential against its provider.
 *
 * Never throws. Every failure mode is a verdict, because a caller rendering a
 * badge needs an answer rather than an exception, and an exception would tempt
 * a caller into treating "we could not check" as "it is fine".
 */
export async function probeProviderCredential(
  providerId: BotProviderId,
  credentialRef: string | null,
): Promise<ProbeResult> {
  if (!credentialRef) {
    return verdict("not_probed", "This provider needs no credential to verify.", false);
  }

  const secret = (process.env[credentialRef] ?? "").trim();
  if (!secret) {
    return verdict("not_configured", "No key is set for this provider yet.", false);
  }

  const endpoint = PROBE_ENDPOINTS[providerId];
  if (!endpoint) {
    // Self-hosted and custom endpoints are operator-defined; there is no known
    // URL to check, and guessing one would produce a confident wrong answer.
    return verdict("not_probed", "This provider has no standard endpoint to verify against.", false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { ...endpoint.extraHeaders };
    let url = endpoint.url;

    if (endpoint.auth === "bearer") headers.Authorization = `Bearer ${secret}`;
    else if (endpoint.auth === "x-api-key") headers["x-api-key"] = secret;
    else url = `${endpoint.url}?key=${encodeURIComponent(secret)}`;

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.ok) {
      return verdict("verified", "The provider accepted this key.", true);
    }

    const code = await readErrorCode(response);

    if (response.status === 401 || response.status === 403) {
      return verdict("rejected", "The provider rejected this key as invalid or revoked.", true);
    }
    if (response.status === 402 || NO_CREDIT_CODES.has(code)) {
      // The Phase 1C failure exactly: the key is valid and the account cannot
      // serve a request. Reported separately because the fix is different.
      return verdict("no_credit", "The key is valid but the account has no available credit.", true);
    }
    if (response.status === 429) {
      return verdict("rate_limited", "The provider is throttling requests right now.", true);
    }
    if (response.status >= 500) {
      return verdict("unreachable", "The provider reported an error on its side.", true);
    }
    return verdict("unreachable", `The provider answered with HTTP ${response.status}.`, true);
  } catch (error) {
    // The URL is deliberately absent from both branches: for Gemini it carries
    // the key.
    const timedOut = error instanceof Error && error.name === "AbortError";
    return verdict(
      "unreachable",
      timedOut ? "The provider did not respond in time." : "The provider could not be reached.",
      false,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a verdict means the bot could actually run. */
export function isUsable(result: ProbeResult): boolean {
  return result.verdict === "verified";
}
