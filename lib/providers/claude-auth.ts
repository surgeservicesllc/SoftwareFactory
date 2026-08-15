/**
 * Resolve how the Claude executor authenticates, under the same cost rule that
 * governs Codex.
 *
 * SoftwareFactory must not require per-token AI API credit for normal operation.
 * `lib/worker/auth.ts` established the shape of the answer for Codex: the CLI
 * authenticates from credential material written by an interactive login against
 * the owner's existing subscription, and the billed path can never be reached by
 * accident. This is the Claude half of that, deliberately parallel — a reader who
 * understands one should recognise the other, and a rule that holds for only one
 * provider is a rule with a hole in it.
 *
 * Two mechanisms are accepted, because Claude Code offers two and they suit
 * different deployments:
 *
 * - **An OAuth token** (`claude setup-token`), carried in one environment
 *   variable. Preferred: nothing is written to disk, so there is no file to leak
 *   or forget to clean up.
 * - **The credentials document** (`~/.claude/.credentials.json` from
 *   `claude login`), for an operator who has one and would rather copy it than
 *   mint a token.
 *
 * The rule enforced here is that neither mechanism can silently become a billed
 * one:
 *
 * - Subscription is the default, and missing material fails closed with a named
 *   reason. It never falls back to an API key, because a fallback that spends
 *   money is the failure mode this exists to prevent.
 * - Material is inspected, not trusted. An Anthropic API key pasted into the
 *   subscription secret is refused by shape, so an operator cannot get silent
 *   per-token billing from a configuration that claims to be free.
 */

export type ClaudeAuthMode = "subscription" | "api_key";

export type ClaudeAuthFailure =
  | "SUBSCRIPTION_CREDENTIAL_MISSING"
  | "SUBSCRIPTION_CREDENTIAL_MALFORMED"
  | "SUBSCRIPTION_CREDENTIAL_IS_API_KEY"
  | "SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS"
  | "API_KEY_MODE_NOT_ENABLED"
  | "API_KEY_MISSING"
  | "UNKNOWN_AUTH_MODE";

export class ClaudeAuthError extends Error {
  constructor(
    readonly code: ClaudeAuthFailure,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeAuthError";
  }
}

export interface ClaudeAuthResolution {
  readonly mode: ClaudeAuthMode;
  /** OAuth token for `CLAUDE_CODE_OAUTH_TOKEN`; null when using the document. */
  readonly oauthToken: string | null;
  /** Contents to write to `CLAUDE_CONFIG_DIR/.credentials.json`; null otherwise. */
  readonly credentialsJson: string | null;
  /** Only ever set in api_key mode, which is opt-in and bills per token. */
  readonly apiKey: string | null;
  /** True when this configuration cannot consume per-token API credit. */
  readonly zeroToken: boolean;
}

export const CLAUDE_AUTH_ENVIRONMENT_KEYS = Object.freeze({
  mode: "SOFTWAREFACTORY_CLAUDE_AUTH_MODE",
  oauthToken: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
  credentialsJson: "SOFTWAREFACTORY_CLAUDE_AUTH_JSON",
  apiKey: "ANTHROPIC_API_KEY",
});

const REASONS: Readonly<Record<ClaudeAuthFailure, string>> = Object.freeze({
  SUBSCRIPTION_CREDENTIAL_MISSING:
    "Neither SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN nor SOFTWAREFACTORY_CLAUDE_AUTH_JSON is set. "
    + "Run `claude setup-token` on a machine signed in to the intended Claude account and store the "
    + "token as SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN.",
  SUBSCRIPTION_CREDENTIAL_MALFORMED:
    "SOFTWAREFACTORY_CLAUDE_AUTH_JSON is not a JSON object. Store the exact contents of "
    + "~/.claude/.credentials.json.",
  SUBSCRIPTION_CREDENTIAL_IS_API_KEY:
    "The subscription credential carries an Anthropic API key rather than OAuth tokens. An API key "
    + "bills per token. Run `claude setup-token` and store that value instead, or select api_key mode "
    + "deliberately.",
  SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS:
    "SOFTWAREFACTORY_CLAUDE_AUTH_JSON carries no OAuth tokens. Re-run `claude login` and copy the "
    + "resulting ~/.claude/.credentials.json.",
  API_KEY_MODE_NOT_ENABLED:
    "ANTHROPIC_API_KEY is set but api_key mode was not selected. Per-token billing is never chosen "
    + "implicitly; set SOFTWAREFACTORY_CLAUDE_AUTH_MODE=api_key to opt in deliberately.",
  API_KEY_MISSING: "api_key mode is selected but ANTHROPIC_API_KEY is not set.",
  UNKNOWN_AUTH_MODE:
    "SOFTWAREFACTORY_CLAUDE_AUTH_MODE must be `subscription` (default) or `api_key`.",
});

function fail(code: ClaudeAuthFailure): never {
  throw new ClaudeAuthError(code, REASONS[code]);
}

/**
 * Anthropic API keys are `sk-ant-api…`; OAuth tokens minted for Claude Code are
 * `sk-ant-oat…` (access) and `sk-ant-ort…` (refresh). The prefixes are what
 * separate a free credential from a billed one, so they are checked rather than
 * assumed — an operator who pastes the wrong `sk-ant-` value into the
 * subscription secret gets a named refusal, not silent spending.
 */
const API_KEY_PREFIX = /^sk-ant-api/i;
const OAUTH_TOKEN_PREFIX = /^sk-ant-(oat|ort)/i;

export function looksLikeAnthropicApiKey(value: string): boolean {
  return API_KEY_PREFIX.test(value.trim());
}

/**
 * Field names a Claude credentials document may carry an OAuth token under,
 * across the shapes `claude login` has written. Checked positively as well as
 * negatively: a document with neither shape is not usable, and saying so now
 * beats a confusing CLI failure inside a claimed run.
 */
const TOKEN_FIELDS = ["accessToken", "access_token", "refreshToken", "refresh_token"] as const;
const API_KEY_FIELDS = ["ANTHROPIC_API_KEY", "anthropic_api_key", "apiKey", "api_key"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Walk the whole document: the token nests differently across versions. */
function collectStrings(value: unknown, into: { key: string; value: string }[], key = ""): void {
  if (typeof value === "string") {
    if (value.trim().length > 0) into.push({ key, value: value.trim() });
    return;
  }
  if (isRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) collectStrings(child, into, childKey);
  }
}

function assertSubscriptionCredential(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("SUBSCRIPTION_CREDENTIAL_MALFORMED");
  }
  if (!isRecord(parsed)) fail("SUBSCRIPTION_CREDENTIAL_MALFORMED");

  const strings: { key: string; value: string }[] = [];
  collectStrings(parsed, strings);

  // An API key anywhere in the document disqualifies it, whether it sits under
  // an obviously-named field or is nested somewhere unexpected.
  const carriesApiKey = strings.some(
    (entry) =>
      looksLikeAnthropicApiKey(entry.value) ||
      ((API_KEY_FIELDS as readonly string[]).includes(entry.key) && entry.value.length > 0),
  );
  if (carriesApiKey) fail("SUBSCRIPTION_CREDENTIAL_IS_API_KEY");

  const carriesToken = strings.some(
    (entry) =>
      OAUTH_TOKEN_PREFIX.test(entry.value) ||
      (TOKEN_FIELDS as readonly string[]).includes(entry.key),
  );
  if (!carriesToken) fail("SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS");

  return raw;
}

/**
 * Decide the authentication mode from the environment.
 *
 * Defaults to subscription. The billed mode requires naming itself, and an
 * `ANTHROPIC_API_KEY` present without that opt-in is treated as a configuration
 * error rather than an invitation — a key left in the environment from an
 * earlier setup must not quietly resume spending.
 */
export function resolveClaudeAuth(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ClaudeAuthResolution {
  const keys = CLAUDE_AUTH_ENVIRONMENT_KEYS;
  const declared = environment[keys.mode]?.trim().toLowerCase();
  const mode: string = declared && declared.length > 0 ? declared : "subscription";

  if (mode === "subscription") {
    const token = environment[keys.oauthToken]?.trim();
    const document = environment[keys.credentialsJson]?.trim();
    if (!token && !document) fail("SUBSCRIPTION_CREDENTIAL_MISSING");
    if (environment[keys.apiKey]?.trim()) fail("API_KEY_MODE_NOT_ENABLED");

    if (token) {
      // The same shape check as the document path: a token variable holding an
      // API key would otherwise bill per token under a subscription label.
      if (looksLikeAnthropicApiKey(token)) fail("SUBSCRIPTION_CREDENTIAL_IS_API_KEY");
      return Object.freeze({
        mode: "subscription" as const,
        oauthToken: token,
        credentialsJson: null,
        apiKey: null,
        zeroToken: true,
      });
    }

    return Object.freeze({
      mode: "subscription" as const,
      oauthToken: null,
      credentialsJson: assertSubscriptionCredential(document as string),
      apiKey: null,
      zeroToken: true,
    });
  }

  if (mode === "api_key") {
    const apiKey = environment[keys.apiKey]?.trim();
    if (!apiKey) fail("API_KEY_MISSING");
    return Object.freeze({
      mode: "api_key" as const,
      oauthToken: null,
      credentialsJson: null,
      apiKey,
      zeroToken: false,
    });
  }

  fail("UNKNOWN_AUTH_MODE");
}

/**
 * Resolve without throwing, for a surface that needs to render a state rather
 * than handle an exception.
 */
export function tryResolveClaudeAuth(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { readonly resolution: ClaudeAuthResolution } | { readonly failure: ClaudeAuthError } {
  try {
    return { resolution: resolveClaudeAuth(environment) };
  } catch (error) {
    if (error instanceof ClaudeAuthError) return { failure: error };
    throw error;
  }
}

/** A description safe for logs and activity events: never the credential itself. */
export function describeClaudeAuth(resolution: ClaudeAuthResolution): string {
  if (resolution.mode === "api_key") {
    return "Claude authenticates with an Anthropic API key. Every request is billed per token.";
  }
  return resolution.oauthToken
    ? "Claude authenticates with the owner's subscription OAuth token. No per-token API billing is possible."
    : "Claude authenticates with the owner's subscription credentials document. No per-token API billing is possible.";
}

/**
 * Every secret value this resolution carries, for redaction before an error
 * message is persisted.
 *
 * The credentials document is decomposed rather than redacted whole: a CLI error
 * is unlikely to quote the file verbatim, but very capable of quoting one token
 * out of it.
 */
export function claudeRedactionSecrets(resolution: ClaudeAuthResolution): readonly string[] {
  if (resolution.apiKey) return Object.freeze([resolution.apiKey]);
  if (resolution.oauthToken) return Object.freeze([resolution.oauthToken]);
  if (!resolution.credentialsJson) return Object.freeze([]);

  const strings: { key: string; value: string }[] = [];
  try {
    collectStrings(JSON.parse(resolution.credentialsJson), strings);
  } catch {
    // Resolution already validated the shape; a parse failure here means the
    // value cannot be decomposed, so fall back to redacting it whole.
    return Object.freeze([resolution.credentialsJson]);
  }
  return Object.freeze(strings.map((entry) => entry.value).filter((value) => value.length >= 8));
}
