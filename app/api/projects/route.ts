import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const createProjectSchema = z
  .object({
    connectionId: z.string().uuid(),
    repositoryId: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).optional(),
    defaultBranch: z.string().trim().min(1).max(255),
  })
  .strict();

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  github_repository: string | null;
  default_branch: string;
  health_status: string;
  autonomous_mode: boolean;
  maximum_autonomous_risk: string;
  updated_at: string | null;
  project_connections?: Array<{ connection_id: string; github_repository_id: string | null; is_primary: boolean }> | null;
};

type GitHubConnectionRow = {
  id: string;
  organization_id: string;
  provider: string;
  status: string;
};

type GitHubInstallationRow = {
  id: string;
  connection_id: string;
  organization_id: string;
  status: string;
  suspended_at: string | null;
};

type GitHubRepositoryRow = {
  id: string;
  external_repository_id: number;
  installation_id: string;
  organization_id: string;
  full_name: string;
  selected: boolean;
  archived: boolean;
  disabled: boolean;
};

export async function GET(request: Request) {
  try {
    // Archived projects are excluded by default; the Archived view opts in
    // explicitly. Both reads go through the same RLS-scoped query — the flag
    // only flips which status band comes back.
    const showArchived = new URL(request.url).searchParams.get("status") === "archived";
    const { activeOrganization, client } = await requireActiveOrganization();
    const base = client
      .from("projects")
      .select(
        "id,name,description,status,github_repository,default_branch,health_status,autonomous_mode,maximum_autonomous_risk,updated_at,project_connections(connection_id,github_repository_id,is_primary)",
      )
      .eq("organization_id", activeOrganization.id);
    const { data, error } = await (showArchived
      ? base.eq("status", "archived")
      : base.neq("status", "archived"))
      .order("name", { ascending: true })
      .limit(100);

    if (error) return databaseErrorResponse(error);

    const projectRows = (data ?? []) as ProjectRow[];
    const primaryConnectionIds = Array.from(new Set(
      projectRows.flatMap((project) => {
        const primary = project.project_connections?.find(
          (connection) => connection.is_primary,
        );
        return primary ? [primary.connection_id] : [];
      }),
    ));

    const { data: connectionData, error: connectionError } = primaryConnectionIds.length
      ? await client
        .from("connections")
        .select("id,organization_id,provider,status")
        .eq("organization_id", activeOrganization.id)
        .eq("provider", "github")
        .in("id", primaryConnectionIds)
      : { data: [], error: null };
    if (connectionError) return databaseErrorResponse(connectionError);

    const connections = (connectionData ?? []) as GitHubConnectionRow[];
    const liveConnectionIds = connections.map((connection) => connection.id);
    const { data: installationData, error: installationError } = liveConnectionIds.length
      ? await client
        .from("github_installations")
        .select("id,connection_id,organization_id,status,suspended_at")
        .eq("organization_id", activeOrganization.id)
        .in("connection_id", liveConnectionIds)
      : { data: [], error: null };
    if (installationError) return databaseErrorResponse(installationError);

    const installations = (installationData ?? []) as GitHubInstallationRow[];
    const installationIds = installations.map((installation) => installation.id);
    const { data: repositoryData, error: repositoryError } = installationIds.length
      ? await client
        .from("github_repositories")
        .select("id,external_repository_id,installation_id,organization_id,full_name,selected,archived,disabled")
        .eq("organization_id", activeOrganization.id)
        .in("installation_id", installationIds)
      : { data: [], error: null };
    if (repositoryError) return databaseErrorResponse(repositoryError);

    const connectionById = new Map(
      connections.map((connection) => [connection.id, connection]),
    );
    const installationByConnectionId = new Map(
      installations.map((installation) => [installation.connection_id, installation]),
    );
    const repositories = (repositoryData ?? []) as GitHubRepositoryRow[];

    const projects = projectRows.map((project) => {
      const primaryConnectionId = project.project_connections?.find(
        (connection) => connection.is_primary,
      )?.connection_id ?? null;
      const githubRepositoryId = project.project_connections?.find(
        (connection) => connection.is_primary,
      )?.github_repository_id ?? null;
      const connection = primaryConnectionId
        ? connectionById.get(primaryConnectionId)
        : undefined;
      const installation = primaryConnectionId
        ? installationByConnectionId.get(primaryConnectionId)
        : undefined;
      const repository = installation && githubRepositoryId
        ? repositories.find(
          (candidate) => candidate.installation_id === installation.id
            && candidate.id === githubRepositoryId,
        )
        : undefined;
      const connected = Boolean(
        connection?.status === "connected"
        && connection.organization_id === activeOrganization.id
        && installation?.status === "active"
        && installation.organization_id === activeOrganization.id
        && !installation.suspended_at
        && repository?.organization_id === activeOrganization.id
        && repository.selected
        && !repository.archived
        && !repository.disabled,
      );

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        githubRepository: project.github_repository,
        githubRepositoryId: repository?.external_repository_id ?? null,
        defaultBranch: project.default_branch,
        healthStatus: project.health_status,
        autonomousMode: project.autonomous_mode,
        maximumAutonomousRisk: project.maximum_autonomous_risk,
        updatedAt: project.updated_at,
        connectionId: primaryConnectionId,
        connectionStatus: connected ? "connected" : "not_connected",
        connectionStatusLabel: connected ? "Connected" : "Not Connected",
      };
    });

    return jsonNoStore({
      activeOrganizationId: activeOrganization.id,
      connectedCount: projects.filter(
        (project) => project.connectionStatus === "connected",
      ).length,
      projects,
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "projects_unavailable", message: "Projects could not be loaded." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = createProjectSchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_project", message: "Choose a connected repository, branch, and valid project name." } },
        { status: 400 },
      );
    }
    if (findSensitiveData(parsed.data)) {
      return jsonNoStore(
        { error: { code: "sensitive_data_rejected", message: "Project details appear to contain sensitive data." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!(["owner", "admin"] as const).includes(activeOrganization.role as "owner" | "admin")) {
      return jsonNoStore(
        { error: { code: "project_management_forbidden", message: "Organization owner or administrator access is required." } },
        { status: 403 },
      );
    }

    const { data, error } = await client
      .rpc("connect_github_project", {
        p_organization_id: activeOrganization.id,
        p_connection_id: parsed.data.connectionId,
        p_external_repository_id: parsed.data.repositoryId,
        p_name: parsed.data.name,
        p_description: parsed.data.description || null,
        p_default_branch: parsed.data.defaultBranch,
      })
      .single();

    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          { error: { code: "project_already_connected", message: "That repository is already connected as an active project." } },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }

    const row = data as {
      project_id: string;
      project_name: string;
      github_repository: string;
      default_branch: string;
      project_status: string;
      connection_id: string;
    };
    return jsonNoStore(
      {
        project: {
          id: row.project_id,
          name: row.project_name,
          githubRepository: row.github_repository,
          defaultBranch: row.default_branch,
          status: row.project_status,
          connectionId: row.connection_id,
          connectionStatus: "connected",
          connectionStatusLabel: "Connected",
          autonomousMode: false,
          maximumAutonomousRisk: "green",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "project_creation_failed", message: "The project could not be connected safely." } },
      { status: 500 },
    );
  }
}
