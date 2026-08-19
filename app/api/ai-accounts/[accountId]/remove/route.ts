import { z } from "zod";

import { botFabricErrorResponse } from "@/lib/bots/route";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
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
      /*
       * The database's own sentence, not just its SQLSTATE.
       *
       * This used to answer every failure with "The account could not be
       * removed." plus a bare code, on the reasoning that a message might leak
       * schema detail. In practice it leaked the opposite: an owner saw
       * "(42501)" and had no way to tell an authorization refusal — whose
       * message is a sentence this repository wrote, "owner or admin role is
       * required to remove an AI account" — from a missing privilege on a
       * table, which says which table. Both are 42501, and the difference is
       * the whole diagnosis.
       *
       * `databaseErrorResponse` is the shared policy for exactly this. It
       * already classifies 42501 as client-safe and maps it to 403, and it
       * still refuses to pass through the message of any code it does not
       * recognise — so a missing function or an unexpected fault stays
       * generic, which is what the original caution was actually about.
       */
      return databaseErrorResponse(error);
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
