import { z } from "zod";

import { ApiRequestError, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const querySchema = z.object({ graphId: z.string().uuid() });

/**
 * A graph's dependency edges, by node key, for the Agent Trail map.
 *
 * Reads only what RLS already lets the member see: graph_nodes and
 * graph_edges both carry member SELECT policies, and the organization filter
 * plus the caller's JWT is the whole authorization story. Each edge keeps
 * its recorded reason and detail — the map shows why an arrow exists, not
 * just that it does, because an edge that cannot say why it exists is a
 * fake edge (the schema's own words).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ graphId: url.searchParams.get("graphId") });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_graph", message: "Provide a graphId." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();

    const [nodes, edges] = await Promise.all([
      client
        .from("graph_nodes")
        .select("id,node_key")
        .eq("organization_id", activeOrganization.id)
        .eq("graph_id", parsed.data.graphId),
      client
        .from("graph_edges")
        .select("from_node_id,to_node_id,reason,detail")
        .eq("organization_id", activeOrganization.id)
        .eq("graph_id", parsed.data.graphId),
    ]);

    if (nodes.error || edges.error) {
      return jsonNoStore(
        { error: { code: "edges_unavailable", message: "The graph's edges could not be read." } },
        { status: 500 },
      );
    }

    const keyById = new Map(
      (nodes.data as Array<{ id: string; node_key: string }>).map((row) => [row.id, row.node_key]),
    );

    return jsonNoStore({
      edges: (edges.data as Array<{
        from_node_id: string;
        to_node_id: string;
        reason: string;
        detail: string;
      }>)
        .flatMap((row) => {
          const from = keyById.get(row.from_node_id);
          const to = keyById.get(row.to_node_id);
          return from && to ? [{ from, to, reason: row.reason, detail: row.detail }] : [];
        }),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "edges_unavailable", message: "The graph's edges could not be read." } },
      { status: 500 },
    );
  }
}
