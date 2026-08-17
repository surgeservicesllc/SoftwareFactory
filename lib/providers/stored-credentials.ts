import "server-only";

import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { CLAUDE_AUTH_ENVIRONMENT_KEYS } from "@/lib/providers/claude-auth";
import { isCredentialStoreConfigured, openSecret } from "@/lib/server/secret-box";

/**
 * Bridges the credential vault to the resolvers that expect an environment.
 *
 * `resolveClaudeAuth` and `resolveCodexAuth` are pure: they take a record of
 * variables and decide. That is worth keeping — they are the modules that
 * enforce "billed mode must name itself", and a pure function is the reason
 * that rule is testable without a database.
 *
 * So instead of teaching them to read a table, this produces an overlay they
 * can be called with. A signed-in credential wins over a variable of the same
 * name, because someone who just completed a sign-in means the thing they
 * signed in with, not whatever was set in a dashboard months ago.
 *
 * Every failure here is silent and returns an empty overlay. A vault that
 * cannot be read must degrade to "no stored credential", which the resolvers
 * already handle by name — throwing would turn a missing key into an outage
 * for callers that were only ever going to use the environment.
 */

/** The variable each *named* purpose fills when a stored credential exists. */
const NAMED_OVERLAY_KEYS: Readonly<Record<string, string>> = Object.freeze({
  // A key obtained through OAuth or pasted into the console fills the same
  // variable an operator would have set by hand, so every reader downstream —
  // probe, resolver, worker — needs no knowledge of where it came from.
  openrouter: "OPENROUTER_API_KEY",
  // Pasted provider keys. Kept under distinct purposes from the subscription
  // credentials: an API key and an OAuth token bill differently, and the
  // seal is bound to the purpose so one can never be opened as the other.
  anthropic_api: "ANTHROPIC_API_KEY",
  openai_api: "OPENAI_API_KEY",
  google_api: "GEMINI_API_KEY",
  xai_api: "XAI_API_KEY",
  mistral_api: "MISTRAL_API_KEY",
  deepseek_api: "DEEPSEEK_API_KEY",
  groq_api: "GROQ_API_KEY",
  // Not an API key: a JSON document holding a Google refresh token and the
  // Cloud project to address. It fills a variable of its own because no
  // provider reads it as a bearer token — the worker exchanges it first.
  vertex: "SOFTWAREFACTORY_VERTEX_CREDENTIAL",
});

/** The base variable each subscription slot family fills. */
const SLOT_BASE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  claude: CLAUDE_AUTH_ENVIRONMENT_KEYS.oauthToken,
  codex: "SOFTWAREFACTORY_CODEX_AUTH_JSON",
});

/**
 * Which variable a purpose fills — or null for a purpose this bridge does not
 * know, which is skipped rather than guessed.
 *
 * Subscription slots are unbounded by requirement: `claude` fills the base
 * variable, `claude_2` fills `…_2`, and `claude_47` fills `…_47`. Each slot
 * is its own account under its own seal-bound purpose, so bots can reference
 * distinct accounts without any fixed maximum.
 */
export function overlayKeyForPurpose(purpose: string): string | null {
  const named = NAMED_OVERLAY_KEYS[purpose];
  if (named) return named;

  const match = /^([a-z][a-z0-9]*)(?:_([2-9]|[1-9][0-9]{1,3}))?$/.exec(purpose);
  if (!match) return null;
  const base = SLOT_BASE_KEYS[match[1]];
  if (!base) return null;
  return match[2] ? `${base}_${match[2]}` : base;
}

/**
 * The purposes the pre-enumeration fallback still probes one by one, when the
 * hosted database does not yet expose `list_provider_credential_purposes`.
 * Exactly the set the static bridge covered, so behavior before the migration
 * applies is unchanged rather than silently narrower.
 */
const FALLBACK_PURPOSES: readonly string[] = Object.freeze([
  ...Object.keys(NAMED_OVERLAY_KEYS),
  "claude", "claude_2", "claude_3",
  "codex", "codex_2", "codex_3",
]);

export type CredentialOverlay = Readonly<Record<string, string>>;

/**
 * Per-account-slot readiness for a subscription variable family, as a dense
 * boolean array: index 0 is the base variable, index n is `…_{n+1}`.
 *
 * The length is discovered, not declared — the highest slot present in the
 * stored overlay or the environment defines it, because accounts are
 * unbounded and a fixed-length answer would silently hide the fourth one.
 */
export function subscriptionSlotReadiness(
  baseRef: string,
  overlay: CredentialOverlay,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean[] {
  const present = new Set<number>();
  const suffixPattern = new RegExp(`^${baseRef}_([2-9]|[1-9][0-9]{1,3})$`);

  for (const source of [Object.keys(overlay), Object.keys(env)]) {
    for (const key of source) {
      const has = key in overlay ? Boolean(overlay[key]) : Boolean(env[key]?.trim());
      if (!has) continue;
      if (key === baseRef) present.add(1);
      else {
        const match = suffixPattern.exec(key);
        if (match) present.add(Number(match[1]));
      }
    }
  }

  const highest = present.size > 0 ? Math.max(...present) : 1;
  return Array.from({ length: highest }, (_, index) => present.has(index + 1));
}

/**
 * Reads and opens every stored credential for an organization.
 *
 * The sealed value is opened here and nowhere else in the request path, and the
 * result is returned rather than cached: a module-level cache of opened
 * credentials would keep plaintext alive between requests for no benefit.
 */
export async function loadStoredCredentialOverlay(
  organizationId: string,
): Promise<CredentialOverlay> {
  if (!isCredentialStoreConfigured()) return Object.freeze({});

  const overlay: Record<string, string> = {};

  try {
    const client = createSupabaseGitHubWebhookClient();

    // Enumerate what exists, then read each. Slots are unbounded, so the set
    // of purposes cannot be a static list. If the hosted database predates
    // the enumeration function, fall back to probing the pre-slot set — the
    // old behavior, so a not-yet-migrated deployment loses nothing.
    let purposes: readonly string[];
    const listed = await client.rpc("list_provider_credential_purposes", {
      p_organization_id: organizationId,
    });
    if (!listed.error && Array.isArray(listed.data)) {
      purposes = (listed.data as unknown[]).filter(
        (value): value is string => typeof value === "string",
      );
    } else {
      purposes = FALLBACK_PURPOSES;
    }

    for (const purpose of purposes) {
      const key = overlayKeyForPurpose(purpose);
      if (!key) continue;

      const { data, error } = await client.rpc("read_provider_credential", {
        p_organization_id: organizationId,
        p_purpose: purpose,
      });
      if (error || typeof data !== "string" || !data) continue;

      try {
        overlay[key] = openSecret(data, { organizationId, purpose });
      } catch {
        // A credential sealed under a rotated master key cannot be opened. It
        // is skipped rather than surfaced: the caller falls back to whatever
        // the environment holds, and the console reports it separately.
        continue;
      }
    }
  } catch {
    return Object.freeze({});
  }

  return Object.freeze(overlay);
}

/**
 * The environment a provider resolver should actually see.
 *
 * Stored credentials are spread last so they win. The alternative — environment
 * first — would make a stale variable silently outrank a fresh sign-in, which
 * is the exact confusion this whole flow exists to remove.
 */
export function withStoredCredentials(
  base: Readonly<Record<string, string | undefined>>,
  overlay: CredentialOverlay,
): Readonly<Record<string, string | undefined>> {
  return Object.freeze({ ...base, ...overlay });
}
