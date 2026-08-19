import { z } from "zod";

import { botFabricErrorResponse } from "@/lib/bots/route";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * The console's polling view of a sign-in.
 *
 * Everything the browser may know about a broker session comes through here:
 * the state name, the provider login URL to open, a failure reason, and the
 * worker's heartbeat so staleness can be shown honestly. The sealed relay
 * code is structurally absent — the underlying projection's signature does
 * not include it.
 */

export const runtime = "nodejs";

type SessionRow = {
  session_id: string;
  session_account_id: string;
  status: string;
  login_url: string | null;
  failure_reason: string | null;
  heartbeat_at: string | null;
  expires_at: string;
  updated_at: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    if (!z.string().uuid().safeParse(sessionId).success) {
      return jsonNoStore(
        { error: { code: "invalid_session", message: "The sign-in identifier is invalid." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("read_ai_auth_session", {
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

    const row = ((data ?? []) as SessionRow[])[0];
    if (!row) {
      return jsonNoStore(
        { error: { code: "session_not_found", message: "That sign-in does not exist." } },
        { status: 404 },
      );
    }

    return jsonNoStore({
      session: {
        id: row.session_id,
        accountId: row.session_account_id,
        status: row.status,
        loginUrl: row.login_url,
        failureReason: row.failure_reason,
        heartbeatAt: row.heartbeat_at,
        expiresAt: row.expires_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "session_unavailable",
      "The sign-in could not be read.",
    );
  }
}
