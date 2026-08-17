import { wakeAuthBrokerWorker } from "@/lib/ai-accounts/dispatch";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Requests a fresh verification sweep for the organization's AI accounts.
 *
 * A refresh that merely re-read the database would show the same stale
 * evidence and call it new. This route produces the real thing: it wakes the
 * auth-broker worker, whose startup sweep re-verifies every stored credential
 * and captures fresh usage, exactly as the scheduled cadence does. The
 * browser then watches `lastVerifiedAt` advance — evidence, not optimism.
 *
 * The response is truthful about delivery: `workerWoken: false` means the
 * wake could not be posted (no executable project binding, or GitHub
 * refused) and the scheduled sweep is the path that will pick it up.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can refresh AI accounts." } },
        { status: 403 },
      );
    }

    const workerWoken = await wakeAuthBrokerWorker(client, activeOrganization.id);
    return jsonNoStore({ requested: true, workerWoken });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "refresh_failed",
      "The refresh request failed safely.",
    );
  }
}
