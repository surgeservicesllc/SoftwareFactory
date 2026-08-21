import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The graph runs a member's organization has recorded, newest first.
 *
 * The worker executes graphs and persists every node transition and
 * artifact; this is the read that makes those rows a surface instead of a
 * secret. It reports exactly what `list_graph_runs` returns — states as the
 * database holds them, node errors verbatim, artifact counts by kind — and
 * derives nothing, because a summary a browser invents is a summary nobody
 * audited.
 */

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

type GraphRunRow = {
  graph_run_id: string;
  graph_id: string;
  goal: string;
  topology: string;
  risk_level: string;
  project_id: string;
  state: string;
  had_partial_input: boolean;
  started_at: string | null;
  completed_at: string | null;
  nodes: unknown;
  artifact_counts: unknown;
  verifications: unknown;
  is_lifecycle: boolean | null;
  iteration: number | null;
  max_iterations: number | null;
};

function briefingVerifications(value: unknown): Array<{ verdict: string }> | null {
  if (!Array.isArray(value)) return null;

  const projected: Array<{ verdict: string }> = [];
  for (const verification of value) {
    if (
      typeof verification !== "object"
      || verification === null
      || !("verdict" in verification)
      || typeof verification.verdict !== "string"
    ) {
      return null;
    }
    projected.push({ verdict: verification.verdict });
  }
  return projected;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const briefing = url.searchParams.get("view") === "briefing";
    const parsed = querySchema.safeParse({ limit: url.searchParams.get("limit") ?? undefined });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_graph_runs_query", message: "The graph runs query is invalid." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("list_graph_runs", {
      p_organization_id: activeOrganization.id,
      p_limit: parsed.data.limit,
    });
    if (error) return databaseErrorResponse(error);

    const rows = (data ?? []) as GraphRunRow[];
    const briefingRuns = briefing
      ? rows.map((row) => {
          const verifications = briefingVerifications(row.verifications);
          if (verifications === null) {
            throw new Error("Graph-run verification evidence is malformed.");
          }
          return {
            graphRunId: row.graph_run_id,
            goal: row.goal,
            topology: row.topology,
            state: row.state,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            verifications,
          };
        })
      : null;
    return jsonNoStore({
      activeOrganizationId: activeOrganization.id,
      runs: briefingRuns ?? rows.map((row) => ({
        graphRunId: row.graph_run_id,
        graphId: row.graph_id,
        goal: row.goal,
        topology: row.topology,
        riskLevel: row.risk_level,
        projectId: row.project_id,
        state: row.state,
        hadPartialInput: row.had_partial_input,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        nodes: Array.isArray(row.nodes) ? row.nodes : [],
        artifactCounts:
          typeof row.artifact_counts === "object" && row.artifact_counts !== null
            ? row.artifact_counts
            : {},
        verifications: Array.isArray(row.verifications) ? row.verifications : [],
        // Reported rather than derived: a graph is a lifecycle because its plan
        // staged its nodes, and the database is where that was decided.
        isLifecycle: row.is_lifecycle === true,
        iteration: row.iteration ?? 1,
        maxIterations: row.max_iterations ?? 1,
      })),
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "graph_runs_unavailable", message: "Graph runs could not be loaded." } },
      { status: 500 },
    );
  }
}
