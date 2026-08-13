import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { tenantRpcListResponse } from "@/lib/server/tenant-list";
import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const commandRequestSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(4000),
  risk: z.enum(["green", "yellow", "red"]).default("green"),
  parameters: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

type SubmissionResult = {
  command_id: string;
  task_id: string;
  command_state: "submitted" | "awaiting_approval" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  task_state: "backlog" | "awaiting_approval" | "queued" | "in_progress" | "blocked" | "completed" | "failed" | "cancelled";
  requires_owner_approval: boolean;
  was_created: boolean;
};

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const rawBody = await readBoundedJson(request);
    const parsed = commandRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_command",
            message: "Command submission is invalid.",
            fields: z.flattenError(parsed.error).fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    const sensitiveFinding = findSensitiveData({
      prompt: parsed.data.prompt,
      parameters: parsed.data.parameters,
    });
    if (sensitiveFinding) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "Commands cannot contain credentials, sensitive keys, or likely secret values.",
            path: sensitiveFinding.path,
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client: supabase } = await requireActiveOrganization();
    const { data: activeProject, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", parsed.data.projectId)
      .eq("organization_id", activeOrganization.id)
      .maybeSingle();
    if (projectError) return databaseErrorResponse(projectError);
    if (!activeProject) {
      return jsonNoStore(
        {
          error: {
            code: "project_not_in_active_organization",
            message: "The project does not belong to the active organization.",
          },
        },
        { status: 409 },
      );
    }

    const { data, error } = await supabase.rpc("submit_command", {
      p_project_id: parsed.data.projectId,
      p_prompt: parsed.data.prompt,
      p_requested_risk: parsed.data.risk,
      p_parameters: parsed.data.parameters,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    }).single();

    if (error) {
      return databaseErrorResponse(error);
    }

    const result = data as SubmissionResult;
    return jsonNoStore(
      {
        command: {
          id: result.command_id,
          status: result.command_state,
        },
        task: {
          id: result.task_id,
          status: result.task_state,
        },
        execution: {
          started: false,
          message: result.requires_owner_approval
            ? "Persisted only. RED execution is blocked until an organization owner approves it."
            : "Persisted and queued only. No AI worker is connected in Phase 1A.",
        },
        requiresOwnerApproval: result.requires_owner_approval,
        idempotentReplay: !result.was_created,
      },
      { status: result.was_created ? 202 : 200 },
    );
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    if (error instanceof ApiRequestError) {
      return requestErrorResponse(error);
    }
    if (error instanceof SupabaseConfigurationError) {
      return jsonNoStore(
        {
          error: {
            code: "supabase_not_configured",
            message: "Command persistence is unavailable because Supabase is not configured.",
          },
        },
        { status: 503 },
      );
    }

    return jsonNoStore(
      { error: { code: "internal_error", message: "Command submission failed safely." } },
      { status: 500 },
    );
  }
}


type CommandRow = {
  id: string;
  project_id: string | null;
  prompt: string;
  requested_risk: string;
  status: string;
  submitted_at: string;
  completed_at: string | null;
  project_name: string | null;
};

/**
 * Lists the commands the caller's organization has saved. `parameters` is
 * excluded: it is caller-supplied and screened for secrets on write, but it
 * has no reason to travel back to the browser in a list view.
 */
export async function GET(request: Request) {
  return tenantRpcListResponse<CommandRow>({
    request,
    rpc: "list_commands",
    unavailableCode: "commands_unavailable",
    unavailableMessage: "Saved requests could not be loaded.",
    shape: (rows) => ({
        commands: rows.map((row) => ({
          id: row.id,
          prompt: row.prompt,
          risk: row.requested_risk,
          status: row.status,
          submittedAt: row.submitted_at,
          completedAt: row.completed_at,
          project: row.project_id
            ? { id: row.project_id, name: row.project_name ?? "Project" }
            : null,
        })),
      }),
  });
}
