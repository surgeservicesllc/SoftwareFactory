import { z } from "zod";

import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import {
  embedded,
  forbidden,
  invalidRequest,
  isOrganizationManager,
  row,
  rows,
  withTenant,
} from "@/lib/server/tenant-route";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(["draft", "active", "paused", "archived"]).optional(),
    productionUrl: z.string().trim().url().startsWith("https://").max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    vercelProjectId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,120}$/).optional(),
    vercelTeamSlug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional(),
    supabaseProjectRef: z.string().trim().regex(/^[a-z]{20}$/).optional(),
  })
  .strict();

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  github_repository: string | null;
  default_branch: string;
  production_url: string | null;
  health_status: string;
  autonomous_mode: boolean;
  maximum_autonomous_risk: string;
  auto_approve: boolean;
  auto_merge: boolean;
  auto_deploy: boolean;
  auto_rollback: boolean;
  tags: string[];
  vercel_project_id: string | null;
  vercel_team_slug: string | null;
  supabase_project_ref: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  project_connections: Array<{ connection_id: string; is_primary: boolean }> | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) {
    return invalidRequest("invalid_project_id", "The project id is invalid.");
  }

  return withTenant(
    async ({ activeOrganization, client }) => {
      const { data, error } = await client
        .from("projects")
        .select(
          "id,name,description,status,github_repository,default_branch,production_url,health_status,"
            + "autonomous_mode,maximum_autonomous_risk,auto_approve,auto_merge,auto_deploy,auto_rollback,"
            + "tags,vercel_project_id,vercel_team_slug,supabase_project_ref,created_at,updated_at,archived_at,"
            + "project_connections(connection_id,is_primary)",
        )
        .eq("id", projectId)
        .eq("organization_id", activeOrganization.id)
        .maybeSingle();
      if (error) return databaseErrorResponse(error);

      const project = row<ProjectRow>(data);
      if (!project) {
        return jsonNoStore(
          { error: { code: "project_not_found", message: "The project was not found." } },
          { status: 404 },
        );
      }

      const primaryConnectionId =
        project.project_connections?.find((link) => link.is_primary)?.connection_id ?? null;

      const [connectionResult, tasksResult, runsResult, pullRequestsResult, activityResult, reportResult] =
        await Promise.all([
          primaryConnectionId
            ? client
              .from("connections")
              .select("id,provider,status,external_account_label,last_verified_at,github_installations(status,suspended_at)")
              .eq("id", primaryConnectionId)
              .eq("organization_id", activeOrganization.id)
              .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          client
            .from("tasks")
            .select("id,title,status,risk_level,priority,source,created_at")
            .eq("project_id", projectId)
            .eq("organization_id", activeOrganization.id)
            .order("priority", { ascending: false })
            .limit(25),
          client
            .from("agent_runs")
            .select("id,status,provider,model,step,failure_kind,created_at,completed_at,agents(name,role)")
            .eq("project_id", projectId)
            .eq("organization_id", activeOrganization.id)
            .order("created_at", { ascending: false })
            .limit(15),
          client
            .from("pull_requests")
            .select("id,external_number,title,url,status,head_branch,base_branch,opened_at")
            .eq("project_id", projectId)
            .eq("organization_id", activeOrganization.id)
            .order("created_at", { ascending: false })
            .limit(15),
          client
            .from("activity_events")
            .select("id,event_type,description,occurred_at")
            .eq("project_id", projectId)
            .eq("organization_id", activeOrganization.id)
            .order("occurred_at", { ascending: false })
            .limit(15),
          client
            .from("reports")
            .select("id,type,title,summary,status,published_at,created_at")
            .eq("project_id", projectId)
            .eq("organization_id", activeOrganization.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      const connection = row<{
        id: string;
        provider: string;
        status: string;
        external_account_label: string | null;
        last_verified_at: string | null;
        github_installations: unknown;
      }>(connectionResult.data);
      const installation = embedded<{ status: string; suspended_at: string | null }>(
        connection?.github_installations,
      );
      const connected = Boolean(
        connection?.status === "connected"
        && installation?.status === "active"
        && !installation.suspended_at
        && project.github_repository,
      );

      const taskRows = rows<{
        id: string;
        title: string;
        status: string;
        risk_level: string;
        priority: number;
        source: string;
        created_at: string;
      }>(tasksResult.data);

      return jsonNoStore({
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          githubRepository: project.github_repository,
          defaultBranch: project.default_branch,
          productionUrl: project.production_url,
          healthStatus: project.health_status,
          tags: project.tags ?? [],
          vercelProjectId: project.vercel_project_id,
          vercelTeamSlug: project.vercel_team_slug,
          supabaseProjectRef: project.supabase_project_ref,
          createdAt: project.created_at,
          updatedAt: project.updated_at,
          archivedAt: project.archived_at,
          connectionId: primaryConnectionId,
          connectionStatus: connected ? "connected" : "not_connected",
          connectionStatusLabel: connected ? "Connected" : "Not Connected",
          connectionAccount: connection?.external_account_label ?? null,
          connectionVerifiedAt: connection?.last_verified_at ?? null,
          autonomy: {
            autonomousMode: project.autonomous_mode,
            maximumAutonomousRisk: project.maximum_autonomous_risk,
            autoApprove: project.auto_approve,
            autoMerge: project.auto_merge,
            autoDeploy: project.auto_deploy,
            autoRollback: project.auto_rollback,
            locked: true,
          },
        },
        canManage: isOrganizationManager(activeOrganization),
        backlog: {
          total: taskRows.length,
          open: taskRows.filter((task) => !["completed", "cancelled", "superseded"].includes(task.status)).length,
          items: taskRows.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            risk: task.risk_level,
            priority: task.priority,
            source: task.source,
            createdAt: task.created_at,
          })),
        },
        runs: rows<{
          id: string;
          status: string;
          provider: string | null;
          model: string | null;
          step: string | null;
          failure_kind: string | null;
          created_at: string;
          completed_at: string | null;
          agents: unknown;
        }>(runsResult.data).map((run) => ({
          id: run.id,
          status: run.status,
          provider: run.provider,
          model: run.model,
          step: run.step,
          failureKind: run.failure_kind,
          createdAt: run.created_at,
          completedAt: run.completed_at,
          agent: embedded<{ name: string; role: string }>(run.agents),
        })),
        pullRequests: rows<{
          id: string;
          external_number: number;
          title: string;
          url: string;
          status: string;
          head_branch: string;
          base_branch: string;
          opened_at: string | null;
        }>(pullRequestsResult.data).map((pullRequest) => ({
          id: pullRequest.id,
          number: pullRequest.external_number,
          title: pullRequest.title,
          url: pullRequest.url,
          status: pullRequest.status,
          headBranch: pullRequest.head_branch,
          baseBranch: pullRequest.base_branch,
          openedAt: pullRequest.opened_at,
        })),
        activity: rows<{ id: string; event_type: string; description: string; occurred_at: string }>(
          activityResult.data,
        ).map((event) => ({
          id: event.id,
          type: event.event_type,
          description: event.description,
          occurredAt: event.occurred_at,
        })),
        latestReport: row<{
          id: string;
          type: string;
          title: string;
          summary: string | null;
          status: string;
          published_at: string | null;
        }>(reportResult.data),
        deployments: {
          // No in-product deployment adapter exists in this phase.
          availability: "unavailable" as const,
          detail: "Deployment visibility requires a connected deployment provider.",
        },
      });
    },
    { code: "project_unavailable", message: "The project could not be loaded." },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) {
    return invalidRequest("invalid_project_id", "The project id is invalid.");
  }

  return withTenant(
    async ({ activeOrganization, client }) => {
      assertSameOriginRequest(request);
      if (!isOrganizationManager(activeOrganization)) {
        return forbidden("Organization owner or administrator access is required to change a project.");
      }

      const parsed = updateSchema.safeParse(await readBoundedJson(request, 16 * 1024));
      if (!parsed.success) {
        return invalidRequest(
          "invalid_project_update",
          "The project update is invalid.",
          z.flattenError(parsed.error).fieldErrors,
        );
      }
      if (Object.keys(parsed.data).length === 0) {
        return invalidRequest("empty_project_update", "No project fields were supplied.");
      }
      if (findSensitiveData(parsed.data)) {
        return invalidRequest(
          "sensitive_data_rejected",
          "Project details cannot contain credentials or likely secret values.",
        );
      }

      const { data, error } = await client
        .rpc("update_project_metadata", {
          p_project_id: projectId,
          p_name: parsed.data.name ?? null,
          p_description: parsed.data.description ?? null,
          p_status: parsed.data.status ?? null,
          p_production_url: parsed.data.productionUrl ?? null,
          p_tags: parsed.data.tags ?? null,
          p_vercel_project_id: parsed.data.vercelProjectId ?? null,
          p_vercel_team_slug: parsed.data.vercelTeamSlug ?? null,
          p_supabase_project_ref: parsed.data.supabaseProjectRef ?? null,
        })
        .single();
      if (error) return databaseErrorResponse(error);

      const project = data as ProjectRow;
      return jsonNoStore({
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          productionUrl: project.production_url,
          tags: project.tags ?? [],
          archivedAt: project.archived_at,
        },
      });
    },
    { code: "project_update_failed", message: "The project could not be updated." },
  );
}
