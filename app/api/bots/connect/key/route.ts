import { z } from "zod";

import { probeProviderCredential } from "@/lib/bots/provider-probe";
import { ensureProviderBot } from "@/lib/bots/provisioning";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { isCredentialStoreConfigured, sealSecret } from "@/lib/server/secret-box";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Accepts a provider API key pasted into the console.
 *
 * Why this exists, given the repository spent months refusing to accept a
 * credential at all: Anthropic restricted OAuth to Claude Code and Claude.ai in
 * February 2026, and using an OAuth token in a third-party application is a
 * terms violation. An API key from the Console is the *only* supported way for
 * software like this to reach Claude. So the choice is not "OAuth or key" — it
 * is "key, or nothing that is allowed to work".
 *
 * Given that, the friction worth removing is everything around the key. Before
 * this, connecting Claude meant: create a key, open the Vercel dashboard, find
 * the right variable name, set it, wait for the environment to propagate. Now
 * it is: create a key, paste it here.
 *
 * The key is sealed the moment it arrives and is never logged, echoed, or
 * returned. The response says whether the provider accepted it and nothing
 * else — no prefix, no length, no hash.
 */

export const runtime = "nodejs";

/** Purposes that map to a pasteable provider key. */
const PURPOSE_BY_PROVIDER: Readonly<Record<string, { purpose: string; envKey: string }>> =
  Object.freeze({
    anthropic: { purpose: "anthropic_api", envKey: "ANTHROPIC_API_KEY" },
    openai: { purpose: "openai_api", envKey: "OPENAI_API_KEY" },
    google: { purpose: "google_api", envKey: "GEMINI_API_KEY" },
    xai: { purpose: "xai_api", envKey: "XAI_API_KEY" },
    mistral: { purpose: "mistral_api", envKey: "MISTRAL_API_KEY" },
    deepseek: { purpose: "deepseek_api", envKey: "DEEPSEEK_API_KEY" },
    groq: { purpose: "groq_api", envKey: "GROQ_API_KEY" },
    openrouter: { purpose: "openrouter", envKey: "OPENROUTER_API_KEY" },
  });

const requestSchema = z.object({
  provider: z.string().min(1).max(40),
  // Bounded, and trimmed by the client before it arrives. The floor rejects a
  // stray character; the ceiling stops a paste of the wrong thing entirely.
  key: z.string().min(16).max(512),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = requestSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_request", message: "That does not look like an API key." } },
        { status: 400 },
      );
    }

    const target = PURPOSE_BY_PROVIDER[parsed.data.provider];
    if (!target) {
      return jsonNoStore(
        { error: { code: "unsupported_provider", message: "That provider does not take a key here." } },
        { status: 400 },
      );
    }

    if (!isCredentialStoreConfigured()) {
      return jsonNoStore(
        {
          error: {
            code: "credential_store_not_configured",
            message: "SOFTWAREFACTORY_CREDENTIAL_KEY is not set, so the key could not be stored.",
          },
        },
        { status: 503 },
      );
    }

    const { activeOrganization, client: tenantClient } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can connect a provider." } },
        { status: 403 },
      );
    }

    const key = parsed.data.key.trim();

    // Verified before it is stored. A key that does not work should never
    // become a stored credential that reads as configured — that is the exact
    // failure the live probe was added to prevent, and storing first would
    // reintroduce it one layer down.
    const probe = await probeProviderCredential(
      parsed.data.provider as Parameters<typeof probeProviderCredential>[0],
      target.envKey,
      key,
    );

    if (probe.verdict !== "verified" && probe.verdict !== "not_probed") {
      return jsonNoStore(
        { connected: false, verdict: probe.verdict, message: probe.reason },
        { status: 400 },
      );
    }

    const sealed = sealSecret(key, {
      organizationId: activeOrganization.id,
      purpose: target.purpose,
    });

    const client = createSupabaseGitHubWebhookClient();
    const { error } = await client.rpc("store_provider_credential", {
      p_organization_id: activeOrganization.id,
      p_purpose: target.purpose,
      p_sealed_envelope: sealed,
    });

    if (error) {
      return jsonNoStore(
        { error: { code: "store_failed", message: "The key could not be stored." } },
        { status: 500 },
      );
    }

    // The credential is stored; the connection has succeeded. Now make it
    // useful without a second step: if this organization has no bot for the
    // provider yet, create a ready default one. This never fails the
    // connection — a provisioning problem leaves the person exactly where the
    // old flow did, with a stored key and a bot to add by hand.
    const provisioned = await ensureProviderBot(tenantClient, activeOrganization.id, parsed.data.provider);

    return jsonNoStore({
      connected: true,
      verdict: probe.verdict,
      botProvisioned: provisioned.outcome === "created",
      message:
        provisioned.outcome === "created"
          ? "Connected and verified. A ready bot is waiting in your fleet."
          : "Connected and verified.",
    });
  } catch (error) {
    // Never surface the failure: it can carry the key in a request context.
    return botFabricErrorResponse(
      error,
      "connect_failed",
      "The key could not be saved.",
    );
  }
}
