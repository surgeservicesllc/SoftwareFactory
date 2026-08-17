import { BOT_PROVIDERS } from "@/lib/bots/catalog";
import {
  parseVertexCredential,
  readGoogleOAuthConfig,
  refreshGoogleAccessToken,
} from "@/lib/bots/google-oauth";
import { isCredentialPresent } from "@/lib/bots/credentials";
import { probeProviderCredential, type ProbeResult } from "@/lib/bots/provider-probe";
import {
  loadStoredCredentialOverlay,
  subscriptionSlotReadiness,
} from "@/lib/providers/stored-credentials";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Which providers are set up, and whether their keys actually work.
 *
 * Presence alone was never enough to justify a badge: a revoked key and a
 * healthy one look identical until something calls the provider. So this also
 * probes, using unbilled model-list endpoints, and reports what the provider
 * said.
 *
 * Two costs are managed here rather than in the client.
 *
 * **Money.** None. Model-list endpoints consume no tokens, so checking often
 * cannot turn into spend.
 *
 * **Rate limits.** Real. A probe is a live request, and a console that
 * re-rendered would issue ten of them. Verdicts are therefore cached briefly,
 * and only credentials that are actually present are probed — a provider with
 * no key cannot be verified and asking would be a guaranteed 401.
 *
 * The response never carries a credential value, prefix, length, or hash. It
 * carries a verdict and a sentence.
 */

export const runtime = "nodejs";

const PROBE_CACHE_TTL_MS = 60_000;

type CacheEntry = { readonly result: ProbeResult; readonly expiresAt: number };

/**
 * Per-instance and deliberately simple.
 *
 * A serverless instance may be recycled, which costs an extra probe and nothing
 * else. The cache exists to stop a re-rendering console from issuing a burst,
 * not to be a source of truth — `?refresh=1` bypasses it so a person who just
 * set a key is never told stale news.
 */
const probeCache = new Map<string, CacheEntry>();

/**
 * Verifies a Google sign-in rather than an API key.
 *
 * Claude reached through Vertex has no key to send to a model-list endpoint;
 * what it has is a refresh token, and refreshing it is exactly what a real call
 * does first. Without this the sign-in stored a credential nothing ever read,
 * and the tile stayed on "needs a key" after a successful connection.
 */
async function probeVertexCredential(sealedDocument: string): Promise<ProbeResult> {
  const credential = parseVertexCredential(sealedDocument);
  if (!credential) {
    return Object.freeze({
      verdict: "rejected" as const,
      reason: "The stored Google connection could not be read. Sign in again.",
      live: false,
    });
  }

  const config = readGoogleOAuthConfig();
  if (!config) {
    return Object.freeze({
      verdict: "not_probed" as const,
      reason: "Google sign-in is not configured on this deployment.",
      live: false,
    });
  }

  const refreshed = await refreshGoogleAccessToken({
    config, refreshToken: credential.refreshToken,
  });

  if (refreshed.ok) {
    return Object.freeze({
      verdict: "verified" as const,
      reason: `Google accepted this connection for project ${credential.projectId}.`,
      live: true,
    });
  }

  // A withdrawn grant needs another sign-in; being unreachable does not.
  return Object.freeze({
    verdict: refreshed.revoked ? ("rejected" as const) : ("unreachable" as const),
    reason: refreshed.reason,
    live: true,
  });
}

async function resolveProbe(
  providerId: string,
  credentialRef: string | null,
  refresh: boolean,
  explicitSecret: string | null,
): Promise<ProbeResult> {
  const now = Date.now();
  const cached = probeCache.get(providerId);
  if (!refresh && cached && cached.expiresAt > now) return cached.result;

  const result = await probeProviderCredential(
    providerId as Parameters<typeof probeProviderCredential>[0],
    credentialRef,
    explicitSecret,
  );
  probeCache.set(providerId, { result, expiresAt: now + PROBE_CACHE_TTL_MS });
  return result;
}

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";

    // A credential signed in through OAuth lives in the vault, not the
    // environment. Reading it here means the console reports one connection
    // state whichever way the credential arrived.
    // Membership is required: knowing which providers an organization has
    // configured is itself information about that organization.
    const { activeOrganization } = await requireActiveOrganization();
    const stored = await loadStoredCredentialOverlay(activeOrganization.id);

    const providers = await Promise.all(
      BOT_PROVIDERS.map(async (provider) => {
        const ref = provider.defaultCredentialRef;
        const storedSecret = ref ? stored[ref] ?? null : null;
        const keyReady = Boolean(storedSecret) || isCredentialPresent(ref);

        // A signed-in subscription credential (claude setup-token, codex
        // login) fills a different variable from the API key and bills
        // nothing per token. It counts toward readiness — a person who just
        // signed in is connected — but it is never probed: the unbilled
        // model-list endpoints authenticate API keys, not subscription
        // tokens, and a guaranteed 401 would read as "your sign-in is bad".
        const subscriptionRef = provider.subscriptionCredentialRef;
        // Slot 1 is the base ref; slot N is the same variable suffixed `_N`,
        // mirroring the account-slot purposes in the vault overlay. The array
        // length is discovered from what exists — accounts are unbounded.
        const subscriptionSlots = subscriptionRef
          ? subscriptionSlotReadiness(subscriptionRef, stored)
          : [];
        const subscriptionReady = subscriptionSlots.some(Boolean);

        // Claude reached through Google sign-in leaves no API key and no
        // subscription token — it leaves a Vertex document. Without this the
        // console reported "needs a key" straight after a successful sign-in,
        // because nothing read the credential the callback had stored.
        const vertexDocument = provider.id === "anthropic"
          ? stored.SOFTWAREFACTORY_VERTEX_CREDENTIAL ?? null
          : null;

        const credentialReady = keyReady || subscriptionReady || Boolean(vertexDocument);

        // Only present API keys are probed. Probing an absent one is a
        // guaranteed rejection that would read as "your key is bad" when the
        // truth is "you have not set one".
        const probe = keyReady
          ? await resolveProbe(provider.id, ref, refresh, storedSecret)
          // Only when Vertex is the sole route. A deployment holding a key too
          // should report the one it would actually use.
          : vertexDocument
            ? await probeVertexCredential(vertexDocument)
            : null;

        return {
          id: provider.id,
          label: provider.label,
          vendor: provider.vendor,
          monogram: provider.monogram,
          accent: provider.accent,
          summary: provider.summary,
          suggestedModels: provider.suggestedModels,
          defaultModel: provider.suggestedModels[0] ?? null,
          credentialRef: provider.defaultCredentialRef,
          credentialReady,
          credentialOptional: provider.defaultCredentialRef === null,
          subscriptionCredentialRef: provider.subscriptionCredentialRef,
          /** True when a signed-in subscription credential is stored or set. */
          subscriptionReady,
          /** Per-account-slot readiness, unbounded: index n is slot n+1. */
          subscriptionSlots,
          /** `verified` is the only verdict that means the bot could run. */
          probeVerdict: probe?.verdict ?? (credentialReady ? "not_probed" : "not_configured"),
          probeReason: probe?.reason ?? null,
          /** False when the verdict came from local state rather than the provider. */
          probeLive: probe?.live ?? false,
          requiresBaseUrl: provider.requiresBaseUrl,
          docsUrl: provider.docsUrl,
          apiKeyUrl: provider.apiKeyUrl,
        };
      }),
    );

    return jsonNoStore({ providers });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "provider_readiness_unavailable",
      "Provider setup state could not be read.",
    );
  }
}
