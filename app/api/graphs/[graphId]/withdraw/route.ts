import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Stop, at the route boundary.
 *
 * Withdrawal marks a graph so no future worker claim selects it; the
 * database owns every rule (membership, the RUNNING refusal, idempotence,
 * the audit event). This route passes the caller's organization and the
 * graph through unchanged and answers with what actually happened — a
 * refusal comes back in the database's words, because "Stop" pretending to
 * stop a live claim would be a dead button wearing a label.
 */

const paramsSchema = z.object({ graphId: z.string().uuid() }).strict();
const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ graphId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_graph_id", message: "The graph id is not a UUID." } },
        { status: 400 },
      );
    }
    const body = bodySchema.safeParse(await readBoundedJson(request) ?? {});
    if (!body.success) {
      return jsonNoStore(
        { error: { code: "invalid_withdrawal", message: "The withdrawal reason is not usable." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("withdraw_graph_as_member", {
      p_organization_id: activeOrganization.id,
      p_graph_id: parsed.data.graphId,
      p_reason: body.data.reason ?? null,
    });
    if (error) {
      if (error.message?.includes("graph_run_in_flight")) {
        return jsonNoStore(
          {
            error: {
              code: "graph_run_in_flight",
              message: "A worker is running this graph right now. The run stops through its "
                + "own budget and failure paths; withdrawal stops future claims once it is not running.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }

    const graph = data as { id?: string; withdrawn_at?: string | null } | null;
    return jsonNoStore({
      graphId: graph?.id ?? parsed.data.graphId,
      withdrawnAt: graph?.withdrawn_at ?? null,
      note: "The graph is withdrawn: no worker will claim it again. Nothing already running was interrupted.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "graph_withdrawal_unavailable", message: "The graph could not be withdrawn." } },
      { status: 500 },
    );
  }
}
