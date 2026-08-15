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

/** The variable each purpose fills when a stored credential exists. */
const OVERLAY_KEYS: Readonly<Record<string, string>> = Object.freeze({
  claude: CLAUDE_AUTH_ENVIRONMENT_KEYS.oauthToken,
  codex: "SOFTWAREFACTORY_CODEX_AUTH_JSON",
});

export type CredentialOverlay = Readonly<Record<string, string>>;

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

    for (const [purpose, key] of Object.entries(OVERLAY_KEYS)) {
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
