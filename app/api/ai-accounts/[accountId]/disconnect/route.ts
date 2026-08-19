import { z } from "zod";

import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Disconnecting an AI account removes its sealed credential from the vault
 * and revokes any in-flight sign-in — the account row stays, as history and
 * as the thing a Reconnect reuses. Bots referencing the account keep their
 * reference and read "AI account required" until it is reconnected.
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
        { error: { code: "forbidden", message: "Only an owner or admin can disconnect an AI account." } },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("disconnect_ai_account", {
      p_organization_id: activeOrganization.id,
      p_ai_account_id: accountId,
    });
    if (error) {
      return jsonNoStore(
        { error: { code: "disconnect_failed", message: "The account could not be disconnected." } },
        { status: 403 },
      );
    }

    return jsonNoStore({ disconnected: data === true });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "disconnect_failed",
      "The account could not be disconnected.",
    );
  }
}
