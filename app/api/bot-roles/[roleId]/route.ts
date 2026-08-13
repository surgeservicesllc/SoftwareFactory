import { z } from "zod";

import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const roleIdSchema = z.string().uuid();

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { roleId } = await params;
    if (!roleIdSchema.safeParse(roleId).success) {
      return jsonNoStore(
        { error: { code: "invalid_role_id", message: "The role reference is invalid." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();
    const { error } = await client.rpc("remove_bot_role", {
      p_organization_id: activeOrganization.id,
      p_role_id: roleId,
    });

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore({ removed: true });
  } catch (error) {
    return botFabricErrorResponse(error, "bot_role_remove_failed", "The role could not be removed.");
  }
}
