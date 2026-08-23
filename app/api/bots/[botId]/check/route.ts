import { z } from "zod";

import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import {
  BOT_READINESS_MIGRATION_PENDING_CODE,
  BotReadinessSyncError,
  synchronizeBotReadiness,
} from "@/lib/bots/readiness-sync";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const botIdSchema = z.string().uuid();

/**
 * Re-evaluate one bot's readiness from current server-side configuration and
 * persist the verdict with audit evidence.
 *
 * This check is entirely local: it resolves the referenced environment variable
 * or organization-vault credential to a presence boolean and validates the
 * catalog entry, model, and endpoint. It performs no provider request, so a
 * `ready` result never claims a live session.
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

    const { activeOrganization, client, user } = await requireBotFabricManager();

    let bot;
    try {
      bot = await synchronizeBotReadiness(
        client,
        activeOrganization.id,
        botId,
        user.id,
      );
    } catch (error) {
      if (error instanceof BotReadinessSyncError) {
        if (error.databaseError.code === BOT_READINESS_MIGRATION_PENDING_CODE) {
          return jsonNoStore(
            {
              error: {
                code: BOT_READINESS_MIGRATION_PENDING_CODE,
                message: "Readiness verification is temporarily waiting for a database upgrade. Try again shortly.",
              },
            },
            { status: 503 },
          );
        }
        return error.stage === "read"
          ? databaseErrorResponse(error.databaseError)
          : botMutationErrorResponse(error.databaseError);
      }
      throw error;
    }
    if (!bot) {
      return jsonNoStore(
        { error: { code: "bot_not_found", message: "That bot is not registered in this organization." } },
        { status: 404 },
      );
    }

    return jsonNoStore({
      bot,
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
