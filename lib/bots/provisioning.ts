import "server-only";

import { findBotProvider } from "@/lib/bots/catalog";
import {
  isMissingDatabaseColumn,
  isMissingDatabaseFunction,
} from "@/lib/bots/schema-compat";
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

type ProviderBotRow = {
  id: string;
  provider: string;
  name: string;
  credential_ref?: string | null;
  ai_account_id?: string | null;
  created_at?: string;
};

type ProvisioningQuery = {
  order: (
    column: string,
    options: { ascending: boolean },
  ) => ProvisioningQuery;
  limit: (count: number) => PromiseLike<{ data: unknown; error: unknown }>;
};

type ProvisioningClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => ProvisioningQuery;
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
  | { readonly outcome: "bound"; readonly botId: string }
  | { readonly outcome: "exists"; readonly botId: string }
  | { readonly outcome: "unsupported" }
  | { readonly outcome: "skipped"; readonly reason: string };

export type ProvisionOptions = {
  /**
   * The exact subscription account this bot executes as. When present, the
   * database derives the credential reference from that tenant-scoped account
   * and returns the exact bot id; the browser never gets to bind an arbitrary
   * account id to an arbitrary credential variable.
   */
  readonly aiAccountId?: string;
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
    let existing = await client
      .from("bots")
      .select("id,provider,name,credential_ref,ai_account_id,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(200);
    if (isMissingDatabaseColumn(existing.error, "ai_account_id")) {
      existing = await client
        .from("bots")
        .select("id,provider,name,credential_ref,created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(200);
    }
    if (existing.error) {
      return { outcome: "skipped", reason: "Existing bots could not be read." };
    }
    const rows = [...((existing.data as ProviderBotRow[] | null) ?? [])].sort((left, right) => {
      const created = (left.created_at ?? "").localeCompare(right.created_at ?? "");
      return created !== 0 ? created : left.id.localeCompare(right.id);
    });
    const providerBots = rows.filter((row) => row.provider === providerId);
    if (providerBots.length > 0 && !options.additional && !options.aiAccountId) {
      return { outcome: "exists", botId: providerBots[0]!.id };
    }
    const taken = new Set(rows.map((row) => row.name));
    let name = provider.label;
    for (let n = 2; taken.has(name); n += 1) {
      if (n > 200) {
        return { outcome: "skipped", reason: "No free bot name is left for this provider." };
      }
      name = `${provider.label} ${n}`;
    }

    const legacyCredentialRef = options.credentialRef !== undefined
      ? options.credentialRef
      : provider.defaultCredentialRef;
    const legacyArguments = {
      p_organization_id: organizationId,
      p_name: name,
      p_provider: providerId,
      p_model: provider.suggestedModels[0] ?? provider.label,
      p_credential_ref: legacyCredentialRef,
      p_base_url: null,
      p_notes: "Created automatically when this provider was connected.",
    };

    if (options.aiAccountId) {
      const exactArguments = {
          p_organization_id: organizationId,
          p_ai_account_id: options.aiAccountId,
          p_provider: providerId,
          p_name: name,
          p_model: provider.suggestedModels[0] ?? provider.label,
          p_additional: options.additional ?? false,
          p_base_url: null,
          p_notes: "Created automatically when this provider was connected.",
      };
      const exact = await client.rpc("ensure_ai_account_bot", exactArguments).single();
      if (!exact.error) {
        const row = exact.data as { bot_id?: string; provision_outcome?: string } | null;
        if (!row?.bot_id) return { outcome: "skipped", reason: "No bot id was returned." };
        if (row.provision_outcome === "created"
          || row.provision_outcome === "bound"
          || row.provision_outcome === "exists") {
          return { outcome: row.provision_outcome, botId: row.bot_id };
        }
        return { outcome: "skipped", reason: "The database returned an unknown bot outcome." };
      }
      if (!isMissingDatabaseFunction(exact.error, "ensure_ai_account_bot")) {
        return { outcome: "skipped", reason: registerRefusalReason(exact.error) };
      }

      // Without the account-aware RPC the server cannot validate that an
      // arbitrary UUID belongs to this tenant/account. Never infer identity
      // from a credential slot and never create an unbound row. An already
      // exact-bound row came from a validated prior write and is safe to reuse
      // deterministically; additional creation waits for the upgrade.
      const exactAccountRows = providerBots.filter(
        (row) => row.ai_account_id === options.aiAccountId,
      );
      if (!options.additional && exactAccountRows.length > 0) {
        return { outcome: "exists", botId: exactAccountRows[0]!.id };
      }
      return {
        outcome: "skipped",
        reason: "Exact account bot creation is waiting for the account-binding database upgrade.",
      };
    }

    const { data, error } = await client.rpc("register_bot", legacyArguments).single();
    if (error) return { outcome: "skipped", reason: registerRefusalReason(error) };
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
