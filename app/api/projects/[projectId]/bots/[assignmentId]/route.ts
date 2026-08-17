import { z } from "zod";

import {
  assignmentConfigSchema,
  IncoherentAssignmentError,
  normalizeAssignmentConfig,
  toDatabaseConfiguration,
} from "@/lib/bots/assignment-config";
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

/**
 * Managing one bot's posting after it exists: pause it, resume it, change what
 * it may touch, or take it off the project.
 *
 * Status and configuration travel in one request on purpose. Pausing a bot and
 * narrowing its permissions is a single intent, and splitting it into two calls
 * leaves a window where the wider grant is live and the pause is not.
 */

export const runtime = "nodejs";

const MANAGER_ROLES = ["owner", "admin"] as const;

const updateAssignmentSchema = z
  .object({
    roleId: z.string().uuid().nullish(),
    status: z.enum(["active", "paused"]).optional(),
    config: assignmentConfigSchema.optional(),
  })
  .strict();

function invalidIdResponse(field: string) {
  return jsonNoStore(
    { error: { code: "invalid_identifier", message: `${field} must be a UUID.` } },
    { status: 400 },
  );
}

function managerForbiddenResponse() {
  return jsonNoStore(
    {
      error: {
        code: "bot_assignment_forbidden",
        message: "Organization owner or administrator access is required to manage bots.",
      },
    },
    { status: 403 },
  );
}

async function resolveManager() {
  const { activeOrganization, client } = await requireActiveOrganization();
  if (!(MANAGER_ROLES as readonly string[]).includes(activeOrganization.role)) return null;
  return { activeOrganization, client };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; assignmentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { projectId, assignmentId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) return invalidIdResponse("Project id");
    if (!z.string().uuid().safeParse(assignmentId).success) {
      return invalidIdResponse("Assignment id");
    }

    const parsed = updateAssignmentSchema.safeParse(await readBoundedJson(request, 32 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_bot_assignment_update",
            message: "Send a role, a status, or a configuration to change.",
          },
        },
        { status: 400 },
      );
    }

    const resolved = await resolveManager();
    if (!resolved) return managerForbiddenResponse();

    let configuration: Record<string, unknown>;
    try {
      configuration = toDatabaseConfiguration(normalizeAssignmentConfig(parsed.data.config ?? {}));
    } catch (error) {
      if (error instanceof IncoherentAssignmentError) {
        return jsonNoStore(
          { error: { code: "incoherent_bot_permissions", message: error.message } },
          { status: 400 },
        );
      }
      throw error;
    }

    const { data, error } = await resolved.client.rpc("update_bot_assignment_configuration", {
      p_organization_id: resolved.activeOrganization.id,
      p_assignment_id: assignmentId,
      p_configuration: configuration,
      p_role_id: parsed.data.roleId ?? null,
      p_status: parsed.data.status ?? null,
    });

    if (error) return databaseErrorResponse(error);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return jsonNoStore(
        {
          error: {
            code: "assignment_not_found",
            message: "That posting is not available in this organization.",
          },
        },
        { status: 404 },
      );
    }

    return jsonNoStore({ updated: true });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      {
        error: {
          code: "bot_assignment_update_failed",
          message: "This posting could not be changed.",
        },
      },
      { status: 500 },
    );
  }
}

/**
 * Takes a bot off the project.
 *
 * Releasing rather than deleting: the posting stays as evidence that this bot
 * served this project between these times, and the activity feed already
 * reported it. Releasing also frees the bot — one open posting per bot means an
 * un-releasable posting would make removal a dead end.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string; assignmentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { projectId, assignmentId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) return invalidIdResponse("Project id");
    if (!z.string().uuid().safeParse(assignmentId).success) {
      return invalidIdResponse("Assignment id");
    }

    const resolved = await resolveManager();
    if (!resolved) return managerForbiddenResponse();

    const { data, error } = await resolved.client.rpc("update_bot_assignment", {
      p_organization_id: resolved.activeOrganization.id,
      p_assignment_id: assignmentId,
      p_status: "released",
    });

    if (error) return databaseErrorResponse(error);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return jsonNoStore(
        {
          error: {
            code: "assignment_not_found",
            message: "That posting is not available in this organization.",
          },
        },
        { status: 404 },
      );
    }

    return jsonNoStore({ released: true });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      {
        error: {
          code: "bot_assignment_release_failed",
          message: "This bot could not be taken off the project.",
        },
      },
      { status: 500 },
    );
  }
}
