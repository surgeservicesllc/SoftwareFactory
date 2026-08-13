import { z } from "zod";

import { isCredentialPresent } from "@/lib/bots/credentials";
import { evaluateBotReadiness } from "@/lib/bots/readiness";
import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { serializeBot } from "@/lib/bots/service";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const botIdSchema = z.string().uuid();

/**
 * Re-evaluate one bot's readiness from current server-side configuration and
 * persist the verdict with audit evidence.
 *
 * This check is entirely local: it resolves the referenced environment variable
 * to a presence boolean and validates the catalog entry, model, and endpoint. It
 * performs no provider request, so a `ready` result never claims a live session.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { botId } = await params;
    if (!botIdSchema.safeParse(botId).success) {
      return jsonNoStore(
        { error: { code: "invalid_bot_id", message: "The bot reference is invalid." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();

    const { data: existing, error: readError } = await client
      .from("bots")
      .select("id,provider,model,credential_ref,base_url")
      .eq("organization_id", activeOrganization.id)
      .eq("id", botId)
      .maybeSingle();

    if (readError) return databaseErrorResponse(readError);
    if (!existing) {
      return jsonNoStore(
        { error: { code: "bot_not_found", message: "That bot is not registered in this organization." } },
        { status: 404 },
      );
    }

    const row = existing as {
      provider: string;
      model: string;
      credential_ref: string | null;
      base_url: string | null;
    };
    const verdict = evaluateBotReadiness({
      provider: row.provider,
      model: row.model,
      credentialRef: row.credential_ref,
      baseUrl: row.base_url,
      credentialPresent: isCredentialPresent(row.credential_ref),
    });

    const { data, error } = await client
      .rpc("record_bot_readiness", {
        p_organization_id: activeOrganization.id,
        p_bot_id: botId,
        p_readiness: verdict.readiness,
        p_detail: verdict.detail,
      })
      .single();

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore({
      bot: serializeBot(data as Parameters<typeof serializeBot>[0]),
      executorConnected: false,
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "bot_check_failed",
      "The readiness check could not be completed.",
    );
  }
}
