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
  project_connections?: Array<{ connection_id: string; is_primary: boolean }> | null;
};

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("projects")
      .select(
        "id,name,description,status,github_repository,default_branch,health_status,autonomous_mode,maximum_autonomous_risk,project_connections(connection_id,is_primary)",
      )
      .eq("organization_id", activeOrganization.id)
      .neq("status", "archived")
      .order("name", { ascending: true })
      .limit(100);

    if (error) return databaseErrorResponse(error);

    const projects = ((data ?? []) as ProjectRow[]).map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      githubRepository: project.github_repository,
      defaultBranch: project.default_branch,
      healthStatus: project.health_status,
      autonomousMode: project.autonomous_mode,
      maximumAutonomousRisk: project.maximum_autonomous_risk,
      connectionId:
        project.project_connections?.find((connection) => connection.is_primary)
          ?.connection_id ?? project.project_connections?.[0]?.connection_id ?? null,
    }));

    return jsonNoStore({
      activeOrganizationId: activeOrganization.id,
      connectedCount: projects.filter((project) => project.githubRepository && project.connectionId).length,
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
