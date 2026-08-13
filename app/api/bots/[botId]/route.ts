import { z } from "zod";

import { normalizeCredentialRef } from "@/lib/bots/credentials";
import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { updateBotSchema } from "@/lib/bots/schemas";
import { serializeBot } from "@/lib/bots/service";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const botIdSchema = z.string().uuid();

export async function PATCH(
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

    const parsed = updateBotSchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_bot", message: "Set a valid name and model identifier." } },
        { status: 400 },
      );
    }
    if (findSensitiveData(parsed.data)) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "Bot details look like they contain a credential. Reference a variable name instead.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();
    const credentialRef = normalizeCredentialRef(parsed.data.credentialRef);

    const { data, error } = await client
      .rpc("update_bot", {
        p_organization_id: activeOrganization.id,
        p_bot_id: botId,
        p_name: parsed.data.name,
        p_model: parsed.data.model,
        p_credential_ref: credentialRef,
        p_base_url: parsed.data.baseUrl || null,
        p_notes: parsed.data.notes || null,
      })
      .single();

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore({ bot: serializeBot(data as Parameters<typeof serializeBot>[0]) });
  } catch (error) {
    return botFabricErrorResponse(error, "bot_update_failed", "The bot could not be updated.");
  }
}

export async function DELETE(
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
    const { error } = await client.rpc("retire_bot", {
      p_organization_id: activeOrganization.id,
      p_bot_id: botId,
    });

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore({ retired: true });
  } catch (error) {
    return botFabricErrorResponse(error, "bot_retire_failed", "The bot could not be retired.");
  }
}
