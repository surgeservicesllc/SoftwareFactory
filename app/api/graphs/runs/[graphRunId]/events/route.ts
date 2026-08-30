import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The events one graph run recorded — the factory's own log.
 *
 * `graph_events` is the engine's append-only account of what actually
 * happened: node transitions, verifications, gate movements, closures. This
 * read surfaces it for the Build workspace's activity log, verbatim under
 * RLS (members of the owning organization only, enforced by policy and
 * re-stated in the filter). Nothing is summarised or reworded here — a log
 * the browser paraphrases is a log nobody can audit.
 *
 * The read is bounded to the newest 500 rows and says so: a truncated log
 * that admits truncation beats an unbounded read that times out.
 */

const paramsSchema = z.object({ graphRunId: z.string().uuid() }).strict();

const EVENT_LIMIT = 500;

type EventRow = {
  id: string;
  event_type: string;
  detail: string | null;
  node_run_id: string | null;
  created_at: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ graphRunId: string }> },
) {
  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_graph_run_id", message: "The graph run id is not a UUID." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const eventsRead = await client
      .from("graph_events")
      .select("id, event_type, detail, node_run_id, created_at")
      .eq("organization_id", activeOrganization.id)
      .eq("graph_run_id", parsed.data.graphRunId)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT + 1);
    if (eventsRead.error) return databaseErrorResponse(eventsRead.error);

    const newestFirst = (eventsRead.data ?? []) as EventRow[];
    const truncated = newestFirst.length > EVENT_LIMIT;
    // Chronological for reading; the newest rows are the ones kept.
    const rows = newestFirst.slice(0, EVENT_LIMIT).reverse();

    // Name the node each event belongs to. Two bounded lookups instead of a
    // join the projection does not carry: node_run → node → node_key.
    const nodeRunIds = [...new Set(rows.flatMap((row) => row.node_run_id === null ? [] : [row.node_run_id]))];
    const nodeKeyByRunId = new Map<string, string>();
    if (nodeRunIds.length > 0) {
      const nodeRunsRead = await client
        .from("node_runs")
        .select("id, node_id")
        .eq("organization_id", activeOrganization.id)
        .in("id", nodeRunIds);
      if (nodeRunsRead.error) return databaseErrorResponse(nodeRunsRead.error);
      const nodeRunRows = (nodeRunsRead.data ?? []) as { id: string; node_id: string }[];
      const nodeIds = [...new Set(nodeRunRows.map((row) => row.node_id))];
      if (nodeIds.length > 0) {
        const nodesRead = await client
          .from("graph_nodes")
          .select("id, node_key")
          .eq("organization_id", activeOrganization.id)
          .in("id", nodeIds);
        if (nodesRead.error) return databaseErrorResponse(nodesRead.error);
        const keyByNodeId = new Map(
          ((nodesRead.data ?? []) as { id: string; node_key: string }[])
            .map((row) => [row.id, row.node_key]),
        );
        for (const nodeRun of nodeRunRows) {
          const key = keyByNodeId.get(nodeRun.node_id);
          if (key !== undefined) nodeKeyByRunId.set(nodeRun.id, key);
        }
      }
    }

    return jsonNoStore({
      events: rows.map((row) => ({
        eventId: row.id,
        eventType: row.event_type,
        detail: row.detail,
        nodeKey: row.node_run_id === null ? null : nodeKeyByRunId.get(row.node_run_id) ?? null,
        createdAt: row.created_at,
      })),
      truncated,
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "graph_run_events_unavailable", message: "The run's events could not be loaded." } },
      { status: 500 },
    );
  }
}
