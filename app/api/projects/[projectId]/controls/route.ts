import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const controlsRequestSchema = z.object({
  autonomousMode: z.boolean().optional(),
  maximumAutonomousRisk: z.enum(["green", "yellow", "red"]).optional(),
  autoApprove: z.boolean().optional(),
  autoMerge: z.boolean().optional(),
  autoDeploy: z.boolean().optional(),
  autoRollback: z.boolean().optional(),
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
  maximum_autonomous_risk: "green" | "yellow" | "red";
  auto_approve: boolean;
  auto_merge: boolean;
  auto_deploy: boolean;
  auto_rollback: boolean;
  updated_at: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return jsonNoStore(
        { error: { code: "invalid_project_id", message: "Project id must be a UUID." } },
        { status: 400 },
      );
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

    const supabase = await createSupabaseServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return jsonNoStore(
        { error: { code: "unauthorized", message: "Authentication is required." } },
        { status: 401 },
      );
    }

    const { data, error } = await supabase.rpc("update_project_controls", {
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
    return jsonNoStore({
      projectId: result.project_id,
      controls: {
        autonomousMode: result.autonomous_mode,
        maximumAutonomousRisk: result.maximum_autonomous_risk,
        autoApprove: result.auto_approve,
        autoMerge: result.auto_merge,
        autoDeploy: result.auto_deploy,
        autoRollback: result.auto_rollback,
        updatedAt: result.updated_at,
      },
      safety: {
        redExecutionAlwaysRequiresOwnerApproval: true,
        executionStarted: false,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return requestErrorResponse(error);
    }
    if (error instanceof SupabaseConfigurationError) {
      return jsonNoStore(
        {
          error: {
            code: "supabase_not_configured",
            message: "Project controls are unavailable because Supabase is not configured.",
          },
        },
        { status: 503 },
      );
    }

    return jsonNoStore(
      { error: { code: "internal_error", message: "Project controls were not changed." } },
      { status: 500 },
    );
  }
}

