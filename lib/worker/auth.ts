/**
 * Resolve how the Codex CLI authenticates, under a cost rule.
 *
 * SoftwareFactory must not consume per-token AI API credit. The Codex SDK makes
 * that achievable rather than difficult: `apiKey` is optional, and the SDK
 * spawns the `codex` CLI, which authenticates from `CODEX_HOME/auth.json`
 * written by `codex login`. A subscription login runs on the owner's existing
 * ChatGPT plan and is never API-metered.
 *
 * The rule this module enforces is that the billed path can never be *reached
 * by accident*. Two things follow from that:
 *
 * - Subscription is the default, and a missing credential fails closed with a
 *   named reason. It never falls back to an API key, because a fallback that
 *   spends money is the failure mode the cost rule exists to prevent.
 * - Subscription material is inspected, not trusted. `codex login --api-key`
 *   writes an `auth.json` too, and that one bills per token. An operator who
 *   pastes it into the subscription secret would otherwise get silent billing
 *   from a configuration that claims to be free.
 */

export type CodexAuthMode = "subscription" | "api_key";

export type CodexAuthFailure =
  | "SUBSCRIPTION_CREDENTIAL_MISSING"
  | "SUBSCRIPTION_CREDENTIAL_MALFORMED"
  | "SUBSCRIPTION_CREDENTIAL_IS_API_KEY"
  | "SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS"
  | "API_KEY_MODE_NOT_ENABLED"
  | "API_KEY_MISSING"
  | "UNKNOWN_AUTH_MODE";

export class CodexAuthError extends Error {
  constructor(readonly code: CodexAuthFailure, message: string) {
    super(message);
    this.name = "CodexAuthError";
  }
}

export interface CodexAuthResolution {
  readonly mode: CodexAuthMode;
  /** Contents to write to `CODEX_HOME/auth.json`; null in api_key mode. */
  readonly authJson: string | null;
  /** Only ever set in api_key mode, which is opt-in and bills per token. */
  readonly apiKey: string | null;
  /** True when this configuration cannot consume per-token API credit. */
  readonly zeroToken: boolean;
}

const REASONS: Readonly<Record<CodexAuthFailure, string>> = Object.freeze({
  SUBSCRIPTION_CREDENTIAL_MISSING:
    "SOFTWAREFACTORY_CODEX_AUTH_JSON is not set. Run `codex login` on a machine signed in to the "
    + "intended ChatGPT account and store the resulting ~/.codex/auth.json as that secret.",
  SUBSCRIPTION_CREDENTIAL_MALFORMED:
    "SOFTWAREFACTORY_CODEX_AUTH_JSON is not a JSON object. Store the exact contents of "
    + "~/.codex/auth.json.",
  SUBSCRIPTION_CREDENTIAL_IS_API_KEY:
    "SOFTWAREFACTORY_CODEX_AUTH_JSON contains an API key rather than subscription tokens. That "
    + "file was written by `codex login --api-key`, which bills per token. Re-run `codex login` "
    + "and complete the browser flow instead.",
  SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS:
    "SOFTWAREFACTORY_CODEX_AUTH_JSON carries no subscription tokens. Re-run `codex login`.",
  API_KEY_MODE_NOT_ENABLED:
    "OPENAI_API_KEY is set but api_key mode was not selected. Per-token billing is never chosen "
    + "implicitly; set SOFTWAREFACTORY_CODEX_AUTH_MODE=api_key to opt in deliberately.",
  API_KEY_MISSING: "api_key mode is selected but OPENAI_API_KEY is not set.",
  UNKNOWN_AUTH_MODE:
    "SOFTWAREFACTORY_CODEX_AUTH_MODE must be `subscription` (default) or `api_key`.",
});

function fail(code: CodexAuthFailure): never {
  throw new CodexAuthError(code, REASONS[code]);
}

/**
 * Fields a `codex login --api-key` auth.json carries. Their presence means the
 * credential bills per token, whatever the mode claims.
 */
const API_KEY_FIELDS = ["OPENAI_API_KEY", "openai_api_key", "apiKey", "api_key"] as const;

/**
 * Fields a subscription `codex login` auth.json carries, at the top level or
 * inside `tokens`. Checked positively as well as negatively: a credential with
 * neither shape is not usable, and saying so now beats a confusing CLI failure
 * inside a claimed run.
 *
 * The check requires a non-blank token *string*, not merely the presence of a
 * `tokens` object — `{"tokens":{"access_token":"   "}}` has the right shape and
 * no usable credential in it.
 */
const TOKEN_FIELDS = ["OPENAI_AUTH_TOKEN", "id_token", "access_token", "refresh_token"] as const;

function hasNonEmpty(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function hasNonBlankToken(record: Record<string, unknown>): boolean {
  return TOKEN_FIELDS.some((field) => {
    const value = record[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function assertSubscriptionCredential(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("SUBSCRIPTION_CREDENTIAL_MALFORMED");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("SUBSCRIPTION_CREDENTIAL_MALFORMED");
  }

  const record = parsed as Record<string, unknown>;
  if (API_KEY_FIELDS.some((field) => hasNonEmpty(record, field))) {
    fail("SUBSCRIPTION_CREDENTIAL_IS_API_KEY");
  }
  const nested = record.tokens;
  const nestedRecord = nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : null;
  if (nestedRecord && API_KEY_FIELDS.some((field) => hasNonEmpty(nestedRecord, field))) {
    fail("SUBSCRIPTION_CREDENTIAL_IS_API_KEY");
  }

  const hasSubscriptionShape =
    hasNonBlankToken(record) || (nestedRecord !== null && hasNonBlankToken(nestedRecord));
  if (!hasSubscriptionShape) fail("SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS");

  return raw;
}

/**
 * Decide the authentication mode from the environment.
 *
 * Defaults to subscription. The billed mode requires naming itself, and an
 * `OPENAI_API_KEY` present without that opt-in is treated as a configuration
 * error rather than an invitation — a key left in the environment from an
 * earlier setup must not quietly resume spending.
 */
export function resolveCodexAuth(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CodexAuthResolution {
  const declared = environment.SOFTWAREFACTORY_CODEX_AUTH_MODE?.trim().toLowerCase();
  const mode: string = declared && declared.length > 0 ? declared : "subscription";

  if (mode === "subscription") {
    const raw = environment.SOFTWAREFACTORY_CODEX_AUTH_JSON?.trim();
    if (!raw) fail("SUBSCRIPTION_CREDENTIAL_MISSING");
    if (environment.OPENAI_API_KEY?.trim()) fail("API_KEY_MODE_NOT_ENABLED");

    return Object.freeze({
      mode: "subscription" as const,
      authJson: assertSubscriptionCredential(raw),
      apiKey: null,
      zeroToken: true,
    });
  }

  if (mode === "api_key") {
    const apiKey = environment.OPENAI_API_KEY?.trim();
    if (!apiKey) fail("API_KEY_MISSING");

    return Object.freeze({
      mode: "api_key" as const,
      authJson: null,
      apiKey,
      zeroToken: false,
    });
  }

  fail("UNKNOWN_AUTH_MODE");
}

/** A description safe for logs and activity events: never the credential itself. */
export function describeCodexAuth(resolution: CodexAuthResolution): string {
  return resolution.mode === "subscription"
    ? "Codex authenticates with the owner's ChatGPT subscription. No per-token API billing is possible."
    : "Codex authenticates with an OpenAI API key. Every turn is billed per token.";
}
