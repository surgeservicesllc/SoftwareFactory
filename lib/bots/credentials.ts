import "server-only";

import { BOT_PROVIDERS } from "@/lib/bots/catalog";

/**
 * Server-side resolution of bot credential references.
 *
 * A bot never stores credential material. It stores the *name* of a server-side
 * environment variable, and this module is the only place that name is turned
 * into a presence signal. Nothing here returns, logs, or echoes a value — the
 * public surface is deliberately boolean.
 */

export const CREDENTIAL_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Namespace reserved for references an operator invents for a custom endpoint. */
const CUSTOM_CREDENTIAL_REF_PATTERN = /^BOT_CREDENTIAL_[A-Z0-9_]{1,48}$/;

/**
 * References that would hand a bot the control plane's own keys. These are
 * rejected before the allowlist is consulted, so widening the allowlist can
 * never accidentally re-admit one.
 */
const PRIVILEGED_CREDENTIAL_REFS: ReadonlySet<string> = new Set([
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_ACCESS_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_STATE_SECRET",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "POSTGRES_URL",
  "VERCEL_TOKEN",
  "VERCEL_OIDC_TOKEN",
]);

/**
 * The same names, exported so the database constraint can be checked against
 * them rather than restating them. They are two enforcement points for one
 * rule, and they had drifted by five names before anything compared them.
 */
export const PRIVILEGED_CREDENTIAL_REF_NAMES: readonly string[] = Object.freeze(
  [...PRIVILEGED_CREDENTIAL_REFS].sort(),
);

/** Conventional provider variables an operator is likely to already have set. */
const PROVIDER_CREDENTIAL_ALTERNATES: readonly string[] = [
  "ANTHROPIC_AUTH_TOKEN",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "PERPLEXITY_API_KEY",
  "COHERE_API_KEY",
];

/**
 * Every reference the catalogue itself declares, plus the conventional
 * alternates.
 *
 * Both of the catalogue's reference fields belong here. Only
 * `defaultCredentialRef` was included, so the two subscription references it
 * declares — `SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN` and
 * `SOFTWAREFACTORY_CODEX_AUTH_JSON` — were rejected by a list built from the
 * same catalogue that names them. A bot created from a connected
 * subscription account, which is the path the product recommends over API
 * keys, carried a reference that could never resolve: it read "Needs
 * credential" forever and the assignment wizard disabled it, so the AI
 * Factory's Assign Bots step was unreachable by that route.
 */
const ALLOWED_CREDENTIAL_REFS: ReadonlySet<string> = new Set([
  ...BOT_PROVIDERS.flatMap((provider) => [
    provider.defaultCredentialRef,
    provider.subscriptionCredentialRef,
  ].filter((reference): reference is string => Boolean(reference))),
  ...PROVIDER_CREDENTIAL_ALTERNATES,
]);

export class BotCredentialError extends Error {
  readonly code:
    | "credential_ref_malformed"
    | "credential_ref_privileged"
    | "credential_ref_not_allowed"
    | "credential_ref_looks_like_value";

  constructor(code: BotCredentialError["code"], message: string) {
    super(message);
    this.name = "BotCredentialError";
    this.code = code;
  }
}

/**
 * The set of reference names a person may choose, for display in the UI. This
 * is a list of variable *names*; it says nothing about which are populated.
 */
export function listSelectableCredentialRefs(): string[] {
  return [...ALLOWED_CREDENTIAL_REFS].sort();
}

/**
 * Normalize and authorize a credential reference. Returns `null` for an absent
 * reference (valid for providers that need no credential) and throws for a
 * reference this application refuses to resolve.
 */
export function normalizeCredentialRef(value: string | null | undefined): string | null {
  const candidate = (value ?? "").trim().toUpperCase();
  if (!candidate) return null;

  if (!CREDENTIAL_REF_PATTERN.test(candidate)) {
    throw new BotCredentialError(
      "credential_ref_malformed",
      "Use the NAME of a server-side environment variable, such as ANTHROPIC_API_KEY.",
    );
  }
  // A pasted key is long and mixed-case; the uppercase form still fails the
  // pattern above in practice, so this is a second, explicit guard.
  if (candidate.length > 64) {
    throw new BotCredentialError(
      "credential_ref_looks_like_value",
      "That looks like a credential value. Reference the variable name instead.",
    );
  }
  if (PRIVILEGED_CREDENTIAL_REFS.has(candidate) || candidate.startsWith("NEXT_PUBLIC_")) {
    throw new BotCredentialError(
      "credential_ref_privileged",
      "That variable holds control-plane credentials and cannot be referenced by a bot.",
    );
  }
  if (!ALLOWED_CREDENTIAL_REFS.has(candidate) && !CUSTOM_CREDENTIAL_REF_PATTERN.test(candidate)) {
    throw new BotCredentialError(
      "credential_ref_not_allowed",
      "Use a known provider variable, or name your own as BOT_CREDENTIAL_<NAME>.",
    );
  }

  return candidate;
}

/**
 * Whether the referenced secret is populated on this server. The value is read
 * only to test for a non-empty string and is never returned or retained.
 */
export function isCredentialPresent(credentialRef: string | null): boolean {
  if (!credentialRef) return false;

  let normalized: string | null;
  try {
    normalized = normalizeCredentialRef(credentialRef);
  } catch {
    return false;
  }
  if (!normalized) return false;

  return (process.env[normalized] ?? "").trim().length > 0;
}
