import { z } from "zod";

import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Removing an AI account is stronger than disconnecting, and the server
 * enforces the one rule that matters: bots are never deleted — they detach
 * and read "no account attached" until another account is assigned.
 */

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    assertSameOriginRequest(request);

    const { accountId } = await params;
    if (!z.string().uuid().safeParse(accountId).success) {
      return jsonNoStore(
        { error: { code: "invalid_account", message: "The account identifier is invalid." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can remove an AI account." } },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("remove_ai_account", {
      p_organization_id: activeOrganization.id,
      p_ai_account_id: accountId,
    });
    if (error) {
      return jsonNoStore(
        { error: { code: "remove_failed", message: "The account could not be removed." } },
        { status: 403 },
      );
    }

    return jsonNoStore({ removed: data === true });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "remove_failed",
      "The account could not be removed.",
    );
  }
}
