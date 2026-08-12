import { z } from "zod";

import { evaluateAutonomyObservation } from "@/lib/autonomy";
import { PHASE_1D_SAFETY_DEFAULTS } from "@/lib/constants";
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

const controlsRequestSchema = z.object({
  autonomousMode: z.literal(false).optional(),
  maximumAutonomousRisk: z.literal("green").optional(),
  autoApprove: z.literal(false).optional(),
  autoMerge: z.literal(false).optional(),
  autoDeploy: z.literal(false).optional(),
  autoRollback: z.literal(false).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict().refine(
  (value) => [
    value.autonomousMode,
    value.maximumAutonomousRisk,
    value.autoApprove,
    value.autoMerge,
    value.autoDeploy,
    value.autoRollback,
  ].some((control) => control !== undefined),
  { message: "At least one control must be supplied." },
);

type ProjectControlsResult = {
  project_id: string;
  autonomous_mode: boolean;
  maximum_autonomous_risk: "green";
  auto_approve: boolean;
  auto_merge: boolean;
  auto_deploy: boolean;
  auto_rollback: boolean;
  updated_at: string;
};

type ProjectControlsRow = {
  id: string;
  autonomous_mode: boolean;
  maximum_autonomous_risk: "green";
  auto_approve: boolean;
  auto_merge: boolean;
  auto_deploy: boolean;
  auto_rollback: boolean;
  updated_at: string;
};

function safetyEnvelope(autonomousMode: boolean) {
  return {
    phase: "1D_OBSERVATION_ONLY",
    ...PHASE_1D_SAFETY_DEFAULTS,
    observation: evaluateAutonomyObservation({
      autonomousMode,
      risk: "GREEN",
      protectedResourceTouched: false,
      evidenceFresh: false,
      requiredChecksPassing: false,
      ownerAttentionRequired: false,
    }),
  } as const;
}

function controlsResponse(row: ProjectControlsRow | ProjectControlsResult) {
  return {
    projectId: "project_id" in row ? row.project_id : row.id,
    controls: {
      autonomousMode: row.autonomous_mode,
      maximumAutonomousRisk: row.maximum_autonomous_risk,
      autoApprove: row.auto_approve,
      autoMerge: row.auto_merge,
      autoDeploy: row.auto_deploy,
      autoRollback: row.auto_rollback,
      updatedAt: row.updated_at,
    },
    safety: safetyEnvelope(row.autonomous_mode),
  };
}

function invalidProjectIdResponse() {
  return jsonNoStore(
    { error: { code: "invalid_project_id", message: "Project id must be a UUID." } },
    { status: 400 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return invalidProjectIdResponse();
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("projects")
      .select(
        "id,autonomous_mode,maximum_autonomous_risk,auto_approve,auto_merge,auto_deploy,auto_rollback,updated_at",
      )
      .eq("id", projectId)
      .eq("organization_id", activeOrganization.id)
      .maybeSingle();

    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "project_not_found", message: "Project not found." } },
        { status: 404 },
      );
    }

    return jsonNoStore(controlsResponse(data as ProjectControlsRow));
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "controls_unavailable", message: "Project controls could not be loaded." } },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return invalidProjectIdResponse();
    }

    const rawBody = await readBoundedJson(request, 8 * 1024);
    const parsed = controlsRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_controls",
            message: "Project control update is invalid.",
            fields: z.flattenError(parsed.error).fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner") {
      return jsonNoStore(
        {
          error: {
            code: "owner_required",
            message: "Only the organization owner may change autonomy observation controls.",
          },
        },
        { status: 403 },
      );
    }

    const { data: project, error: projectError } = await client
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("organization_id", activeOrganization.id)
      .maybeSingle();
    if (projectError) return databaseErrorResponse(projectError);
    if (!project) {
      return jsonNoStore(
        { error: { code: "project_not_found", message: "Project not found." } },
        { status: 404 },
      );
    }

    const { data, error } = await client.rpc("update_project_controls", {
      p_project_id: projectId,
      p_autonomous_mode: parsed.data.autonomousMode ?? null,
      p_maximum_autonomous_risk: parsed.data.maximumAutonomousRisk ?? null,
      p_auto_approve: parsed.data.autoApprove ?? null,
      p_auto_merge: parsed.data.autoMerge ?? null,
      p_auto_deploy: parsed.data.autoDeploy ?? null,
      p_auto_rollback: parsed.data.autoRollback ?? null,
      p_expected_updated_at: parsed.data.expectedUpdatedAt ?? null,
    }).single();

    if (error) {
      return databaseErrorResponse(error);
    }

    const result = data as ProjectControlsResult;
    return jsonNoStore(controlsResponse(result));
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return requestErrorResponse(error);
    }
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;

    return jsonNoStore(
      { error: { code: "internal_error", message: "Project controls were not changed." } },
      { status: 500 },
    );
  }
}
