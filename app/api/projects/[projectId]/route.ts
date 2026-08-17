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

/**
 * Edit a project's identity — name and description. The bounds mirror the
 * create path exactly; authorization, the archived-record refusal, and the
 * immutable `project.updated` audit event live in `update_project_details`
 * so no browser payload can widen them.
 */

const projectIdSchema = z.string().uuid();

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { projectId } = await params;
    if (!projectIdSchema.safeParse(projectId).success) {
      return jsonNoStore(
        { error: { code: "invalid_project_id", message: "Project id must be a UUID." } },
        { status: 400 },
      );
    }

    const parsed = updateProjectSchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_project", message: "Set a project name of 1 to 160 characters; the description may hold up to 2000." } },
        { status: 400 },
      );
    }
    if (findSensitiveData(parsed.data)) {
      return jsonNoStore(
        { error: { code: "sensitive_data_rejected", message: "Project details appear to contain sensitive data." } },
        { status: 400 },
      );
    }

    const { client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("update_project_details", {
        p_project_id: projectId,
        p_name: parsed.data.name,
        p_description: parsed.data.description || null,
      })
      .single();

    if (error) return databaseErrorResponse(error);

    const row = data as {
      project_id: string;
      name: string;
      description: string | null;
      updated_at: string;
    };
    return jsonNoStore({
      project: {
        id: row.project_id,
        name: row.name,
        description: row.description,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "project_update_failed", message: "The project could not be updated safely." } },
      { status: 500 },
    );
  }
}
