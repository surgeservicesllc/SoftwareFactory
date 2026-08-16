import "server-only";

import { findBotProvider } from "@/lib/bots/catalog";

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

type ProviderBotRow = { id: string; provider: string };

type ProvisioningClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          limit: (count: number) => PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => {
    single: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  };
};

export type ProvisionOutcome =
  | { readonly outcome: "created"; readonly botId: string }
  | { readonly outcome: "exists" }
  | { readonly outcome: "unsupported" }
  | { readonly outcome: "skipped"; readonly reason: string };

export async function ensureProviderBot(
  clientLike: unknown,
  organizationId: string,
  providerId: string,
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

    const existing = await client
      .from("bots")
      .select("id,provider")
      .eq("organization_id", organizationId)
      .eq("provider", providerId)
      .limit(1);
    if (existing.error) {
      return { outcome: "skipped", reason: "Existing bots could not be read." };
    }
    if (((existing.data as ProviderBotRow[] | null) ?? []).length > 0) {
      return { outcome: "exists" };
    }

    const { data, error } = await client
      .rpc("register_bot", {
        p_organization_id: organizationId,
        p_name: provider.label,
        p_provider: providerId,
        p_model: provider.suggestedModels[0] ?? provider.label,
        p_credential_ref: provider.defaultCredentialRef,
        p_base_url: null,
        p_notes: "Created automatically when this provider was connected.",
      })
      .single();

    if (error) {
      return { outcome: "skipped", reason: "A default bot was not created automatically." };
    }

    const row = data as { id?: string } | null;
    return row?.id
      ? { outcome: "created", botId: row.id }
      : { outcome: "skipped", reason: "No bot id was returned." };
  } catch {
    return { outcome: "skipped", reason: "A default bot was not created automatically." };
  }
}
