import { z } from "zod";

import {
  botFabricErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

/**
 * Renaming a bot changes its label and nothing else — unlike PATCH, which
 * reconfigures and therefore resets readiness. A Ready bot stays Ready
 * through a rename.
 */

export const runtime = "nodejs";

const requestSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  try {
    assertSameOriginRequest(request);

    const { botId } = await params;
    if (!z.string().uuid().safeParse(botId).success) {
      return jsonNoStore(
        { error: { code: "invalid_bot_id", message: "The bot reference is invalid." } },
        { status: 400 },
      );
    }

    const parsed = requestSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_name",
            message: "The bot name must be between 1 and 80 characters.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();

    const { data, error } = await client.rpc("rename_bot", {
      p_organization_id: activeOrganization.id,
      p_bot_id: botId,
      p_name: parsed.data.name,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      return jsonNoStore(
        {
          error: {
            code: "rename_failed",
            message: code === "23505"
              ? "Another bot already uses that name."
              : "The bot could not be renamed.",
            detail: code ?? "unknown",
          },
        },
        { status: code === "23505" ? 409 : 403 },
      );
    }

    return jsonNoStore({ renamed: data === true });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "rename_failed",
      "The bot could not be renamed.",
    );
  }
}
