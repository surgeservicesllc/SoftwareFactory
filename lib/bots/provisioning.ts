import "server-only";

import { findBotProvider } from "@/lib/bots/catalog";
import { isClientSafeDatabaseErrorCode } from "@/lib/server/http";

/**
 * Auto-provision a ready default bot the moment a provider is connected.
 *
 * Logging into Claude does not hand you an empty workspace and a form; it
 * hands you a working assistant. Connecting a provider here should feel the
 * same: the instant a credential is stored, a usable bot for that provider
 * exists, named for the provider, on its first suggested model, referencing
 * the same variable the credential fills — so with the vault bridge it reads
 * ready without another step.
 *
 * Two rules keep this from being surprising:
 *
 *   It only ever *adds*, and only when the organization has no bot for that
 *   provider yet. Re-connecting never spawns a duplicate, and a person who
 *   shaped their own bots is never second-guessed.
 *
 *   It never turns a successful connection into a failure. The credential is
 *   already stored by the time this runs; a name collision or any insert
 *   error is reported as "not created" and swallowed, because the connection
 *   itself succeeded and the person can always add a bot by hand.
 */

type ProviderBotRow = { id: string; provider: string; name: string };

type ProvisioningClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        limit: (count: number) => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => {
    single: () => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  };
};

export type ProvisionOutcome =
  | { readonly outcome: "created"; readonly botId: string }
  | { readonly outcome: "exists" }
  | { readonly outcome: "unsupported" }
  | { readonly outcome: "skipped"; readonly reason: string };

export type ProvisionOptions = {
  /**
   * The credential variable the new bot should reference, when the connect
   * flow knows better than the provider default — a signed-in subscription
   * credential fills a different variable from a pasted API key. Callers
   * validate the value against the catalog; this module wires it through.
   */
  readonly credentialRef?: string | null;
  /**
   * Create a further bot even though the organization already has one for
   * this provider — the "many Claude bots, all ready" case. Named
   * "<label> <n>" so each addition is distinct; the add-only and
   * never-fails-the-connection rules still hold.
   */
  readonly additional?: boolean;
};

export async function ensureProviderBot(
  clientLike: unknown,
  organizationId: string,
  providerId: string,
  options: ProvisionOptions = {},
): Promise<ProvisionOutcome> {
  const provider = findBotProvider(providerId);
  if (!provider) return { outcome: "unsupported" };

  // A provider that needs an endpoint the person has not given cannot be
  // provisioned blind — that would create a bot that reads "needs setup", the
  // opposite of frictionless. Those keep the manual path.
  if (provider.requiresBaseUrl) {
    return { outcome: "skipped", reason: "This provider needs an endpoint before a bot can run." };
  }

  // Everything below is best-effort. The connection has already succeeded by
  // the time this runs, so no failure here — a malformed client, a read error,
  // a name collision — may propagate. The worst case is exactly the old flow:
  // a stored credential and a bot to add by hand.
  try {
    const client = clientLike as ProvisioningClient;

    /*
     * Names are unique per ORGANIZATION while bots were being counted per
     * PROVIDER, so the old `label N` numbering collided the moment a bot was
     * deleted, renamed, or shared a label across providers — and the 23505
     * was swallowed into a silent "skipped" the console answered 200 for.
     * Read every name in the organization and pick the first genuinely free
     * one instead of predicting.
     */
    const existing = await client
      .from("bots")
      .select("id,provider,name")
      .eq("organization_id", organizationId)
      .limit(200);
    if (existing.error) {
      return { outcome: "skipped", reason: "Existing bots could not be read." };
    }
    const rows = (existing.data as ProviderBotRow[] | null) ?? [];
    const providerCount = rows.filter((row) => row.provider === providerId).length;
    if (providerCount > 0 && !options.additional) {
      return { outcome: "exists" };
    }
    const taken = new Set(rows.map((row) => row.name));
    let name = provider.label;
    for (let n = 2; taken.has(name); n += 1) {
      if (n > 200) {
        return { outcome: "skipped", reason: "No free bot name is left for this provider." };
      }
      name = `${provider.label} ${n}`;
    }

    const { data, error } = await client
      .rpc("register_bot", {
        p_organization_id: organizationId,
        p_name: name,
        p_provider: providerId,
        p_model: provider.suggestedModels[0] ?? provider.label,
        p_credential_ref: options.credentialRef !== undefined
          ? options.credentialRef
          : provider.defaultCredentialRef,
        p_base_url: null,
        p_notes: "Created automatically when this provider was connected.",
      })
      .single();

    if (error) {
      return { outcome: "skipped", reason: registerRefusalReason(error) };
    }

    const row = data as { id?: string } | null;
    return row?.id
      ? { outcome: "created", botId: row.id }
      : { outcome: "skipped", reason: "No bot id was returned." };
  } catch {
    return { outcome: "skipped", reason: "A default bot was not created automatically." };
  }
}

/**
 * The database's own sentence for the codes the shared policy has vetted as
 * client-safe; a code alone otherwise. Every one of these reasons reaches
 * the person who clicked Create Bot — "skipped" used to swallow the whole
 * story, and the console celebrated a bot that was never created.
 */
function registerRefusalReason(error: { message?: string; code?: string }): string {
  if (error.code && isClientSafeDatabaseErrorCode(error.code) && error.message) {
    return `The bot could not be created: ${error.message}.`;
  }
  return error.code
    ? `The bot could not be created (database code ${error.code}).`
    : "A default bot was not created automatically.";
}
