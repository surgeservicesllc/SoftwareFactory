import { BOT_PROVIDERS } from "@/lib/bots/catalog";
import { PROVIDER_IDS, type ProviderId } from "@/lib/providers/types";

/**
 * The standard model catalogue, offered as a one-click seed.
 *
 * A logical agent can only be assigned a model that is an *enabled catalogue
 * configuration* for the organization — `set_agent_provider_assignment`
 * refuses anything else — and a fresh organization has an empty catalogue,
 * which left the Agents page saying "no enabled models are configured" with
 * no way forward on the page itself.
 *
 * The models come from the bot catalog's per-provider suggested lists, so
 * this file cannot drift into naming models the rest of the console does not
 * know. Display names are spelled here because the catalogue schema requires
 * one and an id is not a name. An entry is metadata only: seeding it claims
 * no provider connection and enables no execution.
 */

export type StandardCatalogueEntry = Readonly<{
  provider: ProviderId;
  model: string;
  displayName: string;
  capabilities: readonly string[];
}>;

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "claude-fable-5": "Claude Fable 5",
  "claude-opus-5": "Claude Opus 5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.1-codex": "GPT-5.1 Codex",
  "gpt-5.1": "GPT-5.1",
  "gpt-5-mini": "GPT-5 Mini",
  "o4-mini": "o4-mini",
};

function displayNameFor(model: string): string {
  return DISPLAY_NAMES[model] ?? model;
}

export const STANDARD_MODEL_CATALOGUE: readonly StandardCatalogueEntry[] = BOT_PROVIDERS
  .filter((provider): provider is typeof provider & { id: ProviderId } =>
    (PROVIDER_IDS as readonly string[]).includes(provider.id))
  .flatMap((provider) =>
    provider.suggestedModels.map((model) => ({
      provider: provider.id,
      model,
      displayName: displayNameFor(model),
      capabilities: [],
    })),
  );
