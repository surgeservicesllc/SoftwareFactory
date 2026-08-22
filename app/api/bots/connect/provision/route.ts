import { z } from "zod";

import {
  isBrokerProviderId,
  listAiAccounts,
} from "@/lib/ai-accounts/broker";
import { purposeForSlot } from "@/lib/ai-accounts/purposes";
import { accountCanBackABot } from "@/lib/bots/accounts";
import { findBotProvider, isBotProviderId } from "@/lib/bots/catalog";
import { ensureProviderBot, type ProvisionOptions } from "@/lib/bots/provisioning";
import {
  BOT_READINESS_MIGRATION_PENDING_CODE,
  BotReadinessSyncError,
  synchronizeBotReadiness,
} from "@/lib/bots/readiness-sync";
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
  /** Exact broker account identity; accepted only for subscription provisioning. */
  aiAccountId: z.string().uuid().optional(),
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
    if (parsed.data.aiAccountId && !wantsSubscription) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_request",
            message: "An AI account can only back a subscription bot.",
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
    const { activeOrganization, client, user } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can add a bot." } },
        { status: 403 },
      );
    }

    let resolvedAiAccountId: string | undefined;
    if (wantsSubscription) {
      if (!isBrokerProviderId(parsed.data.provider)) {
        return jsonNoStore(
          {
            error: {
              code: "ai_account_mismatch",
              message: "This provider cannot be resolved to a subscription account.",
            },
          },
          { status: 409 },
        );
      }

      const requestedSlotIndex = slotMatch ? Number(slotMatch[1]) - 1 : 0;
      const requestedPurpose = purposeForSlot(parsed.data.provider, requestedSlotIndex);
      const accounts = await listAiAccounts(client, activeOrganization.id);
      const candidates = parsed.data.aiAccountId
        ? accounts.filter((account) => account.account_id === parsed.data.aiAccountId)
        : accounts.filter((account) => account.provider === parsed.data.provider
          && account.credential_purpose === requestedPurpose);
      const account = candidates.length === 1 ? candidates[0] : null;
      if (!account
        || account.provider !== parsed.data.provider
        || account.auth_method !== "subscription"
        || account.credential_purpose !== requestedPurpose) {
        return jsonNoStore(
          {
            error: {
              code: "ai_account_mismatch",
              message: "The requested subscription slot does not identify one account in this organization.",
            },
          },
          { status: 409 },
        );
      }
      if (!accountCanBackABot(account.status)) {
        return jsonNoStore(
          {
            error: {
              code: "ai_account_unavailable",
              message: "That subscription account has no usable stored credential.",
            },
          },
          { status: 409 },
        );
      }
      resolvedAiAccountId = account.account_id;
    }

    const options: ProvisionOptions = wantsSubscription
      ? {
          additional: parsed.data.additional,
          aiAccountId: resolvedAiAccountId,
          credentialRef: `${provider?.subscriptionCredentialRef}${slotSuffix}`,
        }
      : { additional: parsed.data.additional };

    const result = await ensureProviderBot(
      client,
      activeOrganization.id,
      parsed.data.provider,
      options,
    );

    const hasExactBot = result.outcome === "created"
      || result.outcome === "bound"
      || result.outcome === "exists";
    let synchronizedReadiness: string | null = null;
    if (resolvedAiAccountId && hasExactBot) {
      try {
        const bot = await synchronizeBotReadiness(
          client,
          activeOrganization.id,
          result.botId,
          user.id,
        );
        if (!bot) {
          return jsonNoStore(
            {
              provisioned: result.outcome === "created" || result.outcome === "bound",
              outcome: result.outcome,
              botId: result.botId,
              error: {
                code: "bot_readback_failed",
                message: "The bot was saved, but its exact record could not be read back. Try again.",
              },
            },
            { status: 503 },
          );
        }
        synchronizedReadiness = bot.readiness;
        if (bot.readiness !== "ready") {
          return jsonNoStore(
            {
              provisioned: result.outcome === "created" || result.outcome === "bound",
              outcome: result.outcome,
              botId: result.botId,
              readiness: bot.readiness,
              error: {
                code: "bot_not_ready",
                message: "The bot was saved, but its credential could not be opened. Reconnect the account and try again.",
              },
            },
            { status: 409 },
          );
        }
      } catch (error) {
        // The identity mutation may already have committed. Return that exact
        // identity with a retryable refusal; the next idempotent call reads the
        // same bot and retries only the readiness synchronization.
        const migrationPending = error instanceof BotReadinessSyncError
          && error.databaseError.code === BOT_READINESS_MIGRATION_PENDING_CODE;
        return jsonNoStore(
          {
            provisioned: result.outcome === "created" || result.outcome === "bound",
            outcome: result.outcome,
            botId: result.botId,
            error: {
              code: migrationPending
                ? BOT_READINESS_MIGRATION_PENDING_CODE
                : "bot_readiness_sync_failed",
              message: migrationPending
                ? "The bot was saved, but readiness is waiting for a database upgrade. Try again shortly."
                : "The bot was saved, but readiness could not be verified. Try again.",
            },
          },
          { status: 503 },
        );
      }
    }

    return jsonNoStore({
      provisioned: result.outcome === "created" || result.outcome === "bound",
      outcome: result.outcome,
      ...(result.outcome === "created" || result.outcome === "bound" || result.outcome === "exists"
        ? { botId: result.botId }
        : {}),
      ...(synchronizedReadiness ? { readiness: synchronizedReadiness } : {}),
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
