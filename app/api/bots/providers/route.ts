import { BOT_PROVIDERS } from "@/lib/bots/catalog";
import { isCredentialPresent } from "@/lib/bots/credentials";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Which providers are already set up on this server.
 *
 * This is what turns registering a bot from a typing exercise into a click: the
 * console can say "Claude is ready" instead of asking someone to remember that
 * the variable is spelled `ANTHROPIC_API_KEY`.
 *
 * The response is deliberately, boringly boolean. `isCredentialPresent` reads
 * the variable only to test it for a non-empty string, and nothing here returns
 * a value, a prefix, a length, or a hash. A length would narrow which key it is;
 * a prefix would identify the account. Presence is the entire useful signal and
 * also the entire safe one.
 *
 * `credentialReady` is not a claim that the credential *works*. It says a
 * variable is populated. A revoked or credit-exhausted key is indistinguishable
 * from a good one without calling the provider, so the field is named for what
 * it actually knows and the interface must not relabel it "Connected".
 */

export const runtime = "nodejs";

export async function GET() {
  try {
    // Membership is required: knowing which providers an organization has
    // configured is itself information about that organization.
    await requireActiveOrganization();

    return jsonNoStore({
      providers: BOT_PROVIDERS.map((provider) => ({
        id: provider.id,
        label: provider.label,
        vendor: provider.vendor,
        monogram: provider.monogram,
        accent: provider.accent,
        summary: provider.summary,
        suggestedModels: provider.suggestedModels,
        defaultModel: provider.suggestedModels[0] ?? null,
        credentialRef: provider.defaultCredentialRef,
        credentialReady: isCredentialPresent(provider.defaultCredentialRef),
        /** True when the provider needs no credential at all. */
        credentialOptional: provider.defaultCredentialRef === null,
        requiresBaseUrl: provider.requiresBaseUrl,
        docsUrl: provider.docsUrl,
        apiKeyUrl: provider.apiKeyUrl,
      })),
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "provider_readiness_unavailable",
      "Provider setup state could not be read.",
    );
  }
}
