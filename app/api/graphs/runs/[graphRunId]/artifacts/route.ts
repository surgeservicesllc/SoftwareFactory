import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The artifacts one graph run recorded, payloads included.
 *
 * `GET /api/graphs/runs` reports artifact *counts* — the right weight for a
 * listing. This is the read behind the per-run stage page, where the person
 * deciding a gate deserves the exact recorded content: the stage package the
 * node produced, the anchor's observation, the synthesis. Everything comes
 * verbatim from `list_graph_run_artifacts`, which enforces that the run
 * belongs to the caller's organization; nothing is summarised here, because
 * a summary the browser invents is a summary nobody audited.
 */

const paramsSchema = z.object({ graphRunId: z.string().uuid() }).strict();

type ArtifactRow = {
  artifact_id: string;
  node_run_id: string | null;
  node_key: string | null;
  kind: string;
  payload: unknown;
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
    const { data, error } = await client.rpc("list_graph_run_artifacts", {
      p_organization_id: activeOrganization.id,
      p_graph_run_id: parsed.data.graphRunId,
    });
    if (error) return databaseErrorResponse(error);

    const rows = (data ?? []) as ArtifactRow[];
    return jsonNoStore({
      artifacts: rows.map((row) => ({
        artifactId: row.artifact_id,
        nodeRunId: row.node_run_id,
        nodeKey: row.node_key,
        kind: row.kind,
        payload: row.payload,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "graph_run_artifacts_unavailable", message: "The run's artifacts could not be loaded." } },
      { status: 500 },
    );
  }
}
