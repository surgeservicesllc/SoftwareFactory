import { z } from "zod";

import { botFabricErrorResponse } from "@/lib/bots/route";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Cancelling is changing your mind: the session ends, the account and any
 * stored credential stay exactly as they were.
 */

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    assertSameOriginRequest(request);

    const { sessionId } = await params;
    if (!z.string().uuid().safeParse(sessionId).success) {
      return jsonNoStore(
        { error: { code: "invalid_session", message: "The sign-in identifier is invalid." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can cancel a sign-in." } },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("cancel_ai_auth_session", {
      p_organization_id: activeOrganization.id,
      p_session_id: sessionId,
    });
    if (error) {
      /*
       * The database's own sentence for the codes the shared policy has
       * vetted, and nothing at all for the rest.
       *
       * Every mutation in this section used to answer with a house sentence
       * and, at best, a bare SQLSTATE — which is how an owner came to be told
       * "The account could not be removed. (42501)" and had no way to tell an
       * authorization refusal, whose message this repository wrote, from a
       * missing privilege on a table, which names the table. Both are 42501.
       */
      return databaseErrorResponse(error);
    }

    // false is a finished session — cancelled twice, or already terminal.
    // That is the state the person wanted, so it is not an error.
    return jsonNoStore({ cancelled: data === true });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "cancel_failed",
      "The sign-in could not be cancelled.",
    );
  }
}
