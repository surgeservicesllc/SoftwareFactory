import {
  buildPortfolio,
  type ConnectionRow,
  type PortfolioSources,
  type ProjectRow,
  type StatusRow,
} from "@/lib/portfolio/aggregate";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The portfolio read.
 *
 * Every row here comes through the caller's RLS-scoped client, so this route
 * grants no visibility that the caller does not already have. A project the
 * organization cannot see is not filtered out here — it never arrives.
 *
 * The aggregate sources are fetched independently and a failure in one does not
 * fail the request. That is deliberate: a portfolio whose incidents table is
 * unreadable should still tell you your project names and health, and say that
 * incidents are unknown, rather than returning nothing. `buildPortfolio` turns
 * a null source into Unknown counts rather than zeros.
 */

/** Read one `{project_id, status}` projection, or null when it cannot be read. */
async function readStatusRows(
  client: Awaited<ReturnType<typeof requireActiveOrganization>>["client"],
  table: string,
  organizationId: string,
): Promise<readonly StatusRow[] | null> {
  const { data, error } = await client
    .from(table)
    .select("project_id,status")
    .eq("organization_id", organizationId)
    .limit(2000);

  if (error) return null;
  return (data ?? [])
    .filter((row): row is { project_id: string; status: string } =>
      typeof row?.project_id === "string" && typeof row?.status === "string")
    .map((row) => ({ projectId: row.project_id, status: row.status }));
}

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;

    // Two selects, and the reason is not tidiness.
    //
    // PostgREST fails the *whole* query when it names a column the database
    // does not have, so asking for the Phase 2E scheduling columns against a
    // database where `20260815000200` is not yet applied does not degrade — it
    // takes the entire portfolio down with it, on the one source that cannot
    // fall back to Unknown. The scheduling columns are therefore asked for
    // separately, and their absence costs exactly the fields they carry.
    const baseColumns =
      "id,name,description,status,github_repository,default_branch,production_url,health_status,autonomous_mode,maximum_autonomous_risk";
    const schedulingColumns =
      "id,engineering_priority,strategic_focus,engineering_paused,engineering_pause_reason";

    const { data: projectData, error: projectError } = await client
      .from("projects")
      .select(baseColumns)
      .eq("organization_id", organizationId)
      .order("name", { ascending: true })
      .limit(200);

    // Projects are the one source that cannot degrade to Unknown: without them
    // there is no portfolio to report on.
    if (projectError) return databaseErrorResponse(projectError);

    const { data: schedulingData } = await client
      .from("projects")
      .select(schedulingColumns)
      .eq("organization_id", organizationId)
      .limit(200);

    // Absent rather than empty when the columns do not exist, so the console
    // renders priority as Unknown instead of asserting P0.
    const schedulingById = new Map(
      (schedulingData ?? []).map((row) => [String(row.id), row]),
    );

    const projects: ProjectRow[] = (projectData ?? []).map((row) => {
      const scheduling = schedulingById.get(String(row.id));
      return {
      id: String(row.id),
      name: String(row.name),
      status: row.status as ProjectRow["status"],
      githubRepository: row.github_repository ? String(row.github_repository) : null,
      healthStatus: row.health_status as ProjectRow["healthStatus"],
      autonomousMode: Boolean(row.autonomous_mode),
      maximumAutonomousRisk: String(row.maximum_autonomous_risk).toUpperCase() as
        ProjectRow["maximumAutonomousRisk"],
      description: row.description === null || row.description === undefined
        ? null : String(row.description),
      defaultBranch: row.default_branch ? String(row.default_branch) : null,
      productionUrl: row.production_url ? String(row.production_url) : null,
      // Read as a number only when it really is one. A hosted database without
      // the Phase 2E columns returns undefined, which stays null and renders as
      // Unknown rather than silently becoming P0.
      engineeringPriority: typeof scheduling?.engineering_priority === "number"
        ? scheduling.engineering_priority
        : null,
      strategicFocus: scheduling?.strategic_focus === true,
      engineeringPaused: scheduling?.engineering_paused === true,
      engineeringPauseReason: scheduling?.engineering_pause_reason
        ? String(scheduling.engineering_pause_reason)
        : null,
    };
    });

    const [commands, runs, tasks, incidents, changeRequests, deployments, connectionRows] =
      await Promise.all([
      readStatusRows(client, "commands", organizationId),
      readStatusRows(client, "agent_runs", organizationId),
      readStatusRows(client, "tasks", organizationId),
      readStatusRows(client, "incidents", organizationId),
      readStatusRows(client, "github_change_requests", organizationId),
      readStatusRows(client, "deployments", organizationId),
      client
        .from("project_connections")
        .select("project_id,connections(status,provider)")
        .eq("organization_id", organizationId)
        .limit(500),
    ]);

    const connections: readonly ConnectionRow[] | null = connectionRows.error
      ? null
      : (connectionRows.data ?? []).flatMap((row) => {
          const joined = (row as { connections?: { status?: unknown; provider?: unknown } | null })
            .connections;
          if (!joined || typeof joined.status !== "string" || typeof joined.provider !== "string") {
            return [];
          }
          return [{
            projectId: String(row.project_id),
            status: joined.status,
            provider: joined.provider,
          }];
        });

    const sources: PortfolioSources = {
      projects,
      commands,
      runs,
      tasks,
      incidents,
      changeRequests,
      deployments,
      connections,
    };

    return jsonNoStore({ portfolio: buildPortfolio(sources) });
  } catch (error) {
    // `supabaseBoundaryErrorResponse` returns null for anything that is not a
    // tenancy or session boundary failure, so it needs a fallback rather than
    // being returned directly.
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "portfolio_unavailable", message: "The portfolio could not be loaded." } },
      { status: 500 },
    );
  }
}
