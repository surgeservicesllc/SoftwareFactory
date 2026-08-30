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
 * secret. It reports the run facts `list_graph_runs` returns — states as the
 * database holds them, node errors verbatim, artifact counts by kind — plus
 * the graph's immutable template identity read directly through RLS. It
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
  closure_note: string | null;
  started_at: string | null;
  completed_at: string | null;
  // bigint columns: postgrest hands these back as strings, and a run that
  // reported no usage has null rather than 0.
  tokens_used?: string | number | null;
  cost_micros?: string | number | null;
  budget_action?: string | null;
  discovery_rounds?: number | null;
  nodes: unknown;
  artifact_counts: unknown;
  verifications: unknown;
  is_lifecycle: boolean | null;
  iteration: number | null;
  max_iterations: number | null;
};

const graphTemplateIdentityRowsSchema = z.array(z.object({
  id: z.string().uuid(),
  template_key: z.string().min(1).nullable(),
  template_version: z.number().int().positive().nullable(),
  // Run controls (20260830000200/000400). Absent — not null — when the
  // database predates them; the fallback read below omits the columns.
  withdrawn_at: z.string().nullish(),
  pause_requested_at: z.string().nullish(),
}).strict().superRefine((row, context) => {
  if ((row.template_key === null) !== (row.template_version === null)) {
    context.addIssue({
      code: "custom",
      message: "Graph template identity must be wholly present or wholly absent.",
    });
  }
}));

type GraphTemplateIdentity = z.infer<typeof graphTemplateIdentityRowsSchema>[number];

/** A bigint the driver may hand back as a string, kept null when it is null. */
function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

    // `list_graph_runs` predates the immutable template identity added for the
    // full-lifecycle v2 release bridge. Read that identity through the same
    // authenticated, tenant-scoped client until the RPC itself can be extended
    // by a forward migration. Never infer v2 from lifecycle stages: legacy v1
    // runs have the same stage shape and must stay distinguishable.
    const graphIds = [...new Set(rows.map((row) => row.graph_id))];
    const identitiesByGraphId = new Map<string, GraphTemplateIdentity>();
    if (!briefing && graphIds.length > 0) {
      const readIdentities = (columns: string) => client
        .from("graphs")
        .select(columns)
        .eq("organization_id", activeOrganization.id)
        .in("id", graphIds);
      let identityResult: { data: unknown; error: { code?: string } | null } =
        await readIdentities("id,template_key,template_version,withdrawn_at,pause_requested_at");
      if (identityResult.error?.code === "42703") {
        // The deploy window: this build shipped before the run-control
        // columns were applied. The listing must still answer, so read the
        // identity alone; the controls simply report null until the apply.
        identityResult = await readIdentities("id,template_key,template_version");
      }
      if (identityResult.error) return databaseErrorResponse(identityResult.error);

      const parsedIdentities = graphTemplateIdentityRowsSchema.safeParse(identityResult.data ?? []);
      if (!parsedIdentities.success) {
        throw new Error("Graph template identity evidence is malformed.");
      }
      for (const identity of parsedIdentities.data) {
        identitiesByGraphId.set(identity.id, identity);
      }
      if (
        identitiesByGraphId.size !== graphIds.length
        || graphIds.some((graphId) => !identitiesByGraphId.has(graphId))
      ) {
        throw new Error("Graph template identity evidence is incomplete.");
      }
    }

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
        // Why the run ended as it did, as the engine assessed it. Null on runs
        // closed before the column existed, and on runs that ended whole with
        // nothing to explain — an absent note is not an empty one.
        closureNote: row.closure_note ?? null,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        /*
         * What the run spent, and what the budget did about it.
         *
         * Optional on the row and null-preserving here, both deliberately: a
         * database that predates 20260825000200 returns no such column, and a
         * run whose nodes never reported usage has null. Neither is zero, and
         * coalescing either to zero would put a measurement on the page that
         * nobody took.
         */
        tokensUsed: numberOrNull(row.tokens_used),
        costMicros: numberOrNull(row.cost_micros),
        budgetAction: row.budget_action ?? null,
        discoveryRounds: typeof row.discovery_rounds === "number" ? row.discovery_rounds : null,
        nodes: Array.isArray(row.nodes) ? row.nodes : [],
        artifactCounts:
          typeof row.artifact_counts === "object" && row.artifact_counts !== null
            ? row.artifact_counts
            : {},
        verifications: Array.isArray(row.verifications) ? row.verifications : [],
        // Reported rather than derived: a graph is a lifecycle because its plan
        // staged its nodes, and the database is where that was decided.
        isLifecycle: row.is_lifecycle === true,
        templateKey: identitiesByGraphId.get(row.graph_id)?.template_key ?? null,
        templateVersion: identitiesByGraphId.get(row.graph_id)?.template_version ?? null,
        // The graph's run controls, so the workspace can label a paused or
        // withdrawn build honestly instead of calling it "waiting".
        pausedAt: identitiesByGraphId.get(row.graph_id)?.pause_requested_at ?? null,
        withdrawnAt: identitiesByGraphId.get(row.graph_id)?.withdrawn_at ?? null,
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
