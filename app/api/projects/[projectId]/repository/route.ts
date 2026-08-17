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

const setRepositorySchema = z
  .object({
    connectionId: z.string().uuid(),
    repositoryId: z.number().int().positive(),
  })
  .strict();

type SetRepositoryResult = {
  project_id: string;
  project_name: string;
  github_repository: string;
  default_branch: string;
  connection_id: string;
  github_repository_id: string;
};

type UnlinkRepositoryResult = {
  project_id: string;
  project_name: string;
  previous_github_repository: string | null;
  previous_connection_id: string | null;
  previous_github_repository_id: string | null;
};

function invalidProjectIdResponse() {
  return jsonNoStore(
    { error: { code: "invalid_project_id", message: "Project id must be a UUID." } },
    { status: 400 },
  );
}

function managerForbiddenResponse() {
  return jsonNoStore(
    {
      error: {
        code: "project_management_forbidden",
        message: "Organization owner or administrator access is required.",
      },
    },
    { status: 403 },
  );
}

/**
 * The linking functions serialize on advisory locks and check uniqueness by
 * name, so 23505 is reachable only through a raw constraint race. It is not a
 * client-safe SQLSTATE, so map it to the same human-readable refusal the
 * function raises rather than an opaque database error.
 */
function repositoryConflictResponse() {
  return jsonNoStore(
    {
      error: {
        code: "repository_already_linked",
        message: "That repository is already linked to another active project.",
      },
    },
    { status: 409 },
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return invalidProjectIdResponse();
    }

    const parsed = setRepositorySchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_repository_link",
            message: "Choose a repository from a connected GitHub installation.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!(["owner", "admin"] as const).includes(activeOrganization.role as "owner" | "admin")) {
      return managerForbiddenResponse();
    }

    const { data, error } = await client
      .rpc("set_project_github_repository", {
        p_organization_id: activeOrganization.id,
        p_project_id: projectId,
        p_connection_id: parsed.data.connectionId,
        p_external_repository_id: parsed.data.repositoryId,
      })
      .single();

    if (error) {
      if (error.code === "23505") return repositoryConflictResponse();
      return databaseErrorResponse(error);
    }

    const row = data as SetRepositoryResult;
    return jsonNoStore({
      project: {
        id: row.project_id,
        name: row.project_name,
        githubRepository: row.github_repository,
        githubRepositoryId: row.github_repository_id,
        defaultBranch: row.default_branch,
        connectionId: row.connection_id,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      {
        error: {
          code: "repository_link_failed",
          message: "The project repository could not be changed safely.",
        },
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return invalidProjectIdResponse();
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!(["owner", "admin"] as const).includes(activeOrganization.role as "owner" | "admin")) {
      return managerForbiddenResponse();
    }

    const { data, error } = await client
      .rpc("unlink_project_github_repository", {
        p_organization_id: activeOrganization.id,
        p_project_id: projectId,
      })
      .single();

    if (error) return databaseErrorResponse(error);

    const row = data as UnlinkRepositoryResult;
    return jsonNoStore({
      project: {
        id: row.project_id,
        name: row.project_name,
        githubRepository: null,
        githubRepositoryId: null,
        connectionId: null,
        previousGithubRepository: row.previous_github_repository,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      {
        error: {
          code: "repository_unlink_failed",
          message: "The project repository could not be unlinked safely.",
        },
      },
      { status: 500 },
    );
  }
}
