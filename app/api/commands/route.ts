import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

    const supabase = await createSupabaseServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return jsonNoStore(
        { error: { code: "unauthorized", message: "Authentication is required." } },
        { status: 401 },
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

