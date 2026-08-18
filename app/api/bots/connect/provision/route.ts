import { z } from "zod";

import { findBotProvider, isBotProviderId } from "@/lib/bots/catalog";
import { ensureProviderBot, type ProvisionOptions } from "@/lib/bots/provisioning";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Provisions a ready default bot for a just-connected provider.
 *
 * The pasted-key route provisions inline, because it already holds an
 * owner-authenticated session. The one-click OAuth callback cannot: it runs as
 * the service role, and creating a bot is owner-authorized work
 * (`register_bot` asserts the caller is a fabric manager). So the console calls
 * this the moment it returns from a sign-in, as the authenticated owner, and
 * the front door's promise — "sign in and add my first bot" — is kept without
 * the callback ever holding authority it should not.
 *
 * It is safe to call unconditionally: `ensureProviderBot` only adds a bot when
 * the organization has none for the provider, and reports "exists" otherwise,
 * so a refresh or a second sign-in never duplicates anything.
 */

export const runtime = "nodejs";

const requestSchema = z.object({
  provider: z.string().min(1).max(40).refine(isBotProviderId, "Unknown provider."),
  /**
   * Which of the provider's credential variables the bot should reference:
   * the pasted/OAuth API key ("default"), the signed-in subscription
   * credential ("subscription"), or any numbered account slot
   * ("subscription_2", "subscription_47", …) — slots are unbounded by
   * requirement. Resolved against the catalog plus a numeric suffix here, so
   * an arbitrary variable name can never arrive from the browser.
   */
  credential: z.string().regex(
    /^(default|subscription(?:_(?:[2-9]|[1-9][0-9]{1,3}))?)$/,
    "Unknown credential choice.",
  ).default("default"),
  /** Create a further numbered bot even when one already exists. */
  additional: z.boolean().default(false),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = requestSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_request", message: "Name a provider to provision." } },
        { status: 400 },
      );
    }

    const provider = findBotProvider(parsed.data.provider);
    const wantsSubscription = parsed.data.credential.startsWith("subscription");
    if (wantsSubscription && !provider?.subscriptionCredentialRef) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_request",
            message: "This provider has no subscription sign-in.",
          },
        },
        { status: 400 },
      );
    }
    // "subscription" is account slot 1 (the base variable); "subscription_N"
    // is the suffixed slot variable, for any N. The browser only ever names a
    // pattern-checked choice — the variable itself comes from the catalog.
    const slotMatch = /^subscription_(\d+)$/.exec(parsed.data.credential);
    const slotSuffix = slotMatch ? `_${slotMatch[1]}` : "";
    const options: ProvisionOptions = wantsSubscription
      ? {
          additional: parsed.data.additional,
          credentialRef: `${provider?.subscriptionCredentialRef}${slotSuffix}`,
        }
      : { additional: parsed.data.additional };

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can add a bot." } },
        { status: 403 },
      );
    }

    const result = await ensureProviderBot(
      client,
      activeOrganization.id,
      parsed.data.provider,
      options,
    );

    return jsonNoStore({
      provisioned: result.outcome === "created",
      outcome: result.outcome,
      // The refusal's sentence travels: "skipped" with no reason is how the
      // console ended up celebrating a bot that was never created.
      ...(result.outcome === "skipped" ? { reason: result.reason } : {}),
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "provision_failed",
      "A default bot could not be added.",
    );
  }
}
