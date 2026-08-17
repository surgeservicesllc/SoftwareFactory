import { z } from "zod";

import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { updateAssignmentSchema } from "@/lib/bots/schemas";
import { serializeAssignment } from "@/lib/bots/service";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const assignmentIdSchema = z.string().uuid();

const executionSchema = z
  .object({
    // "" clears the override back to the bot's default model.
    model: z.string().trim().max(128).optional(),
    workEffort: z.enum(["low", "medium", "high", "max"]).optional(),
  })
  .strict()
  .refine(
    (value) => value.model !== undefined || value.workEffort !== undefined,
    { message: "Set a model and/or a workEffort." },
  );

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { assignmentId } = await params;
    if (!assignmentIdSchema.safeParse(assignmentId).success) {
      return jsonNoStore(
        { error: { code: "invalid_assignment_id", message: "The assignment reference is invalid." } },
        { status: 400 },
      );
    }

    const body = await readBoundedJson(request, 4 * 1024);

    // Two edits share this verb: the lifecycle status, and the posting's
    // execution preferences (model override + work effort). Each validates
    // its own shape; the database enforces both again.
    const execution = executionSchema.safeParse(body);
    if (execution.success) {
      const { activeOrganization, client } = await requireBotFabricManager();
      const { data, error } = await client
        .rpc("set_bot_assignment_execution", {
          p_organization_id: activeOrganization.id,
          p_assignment_id: assignmentId,
          // Omitted leaves the stored value; an empty string clears the
          // override back to the bot's own default model.
          p_model: execution.data.model === undefined ? null : execution.data.model,
          p_work_effort: execution.data.workEffort ?? null,
        })
        .single();
      if (error) return botMutationErrorResponse(error);
      const row = data as { assignment_id: string; model: string | null; work_effort: string };
      return jsonNoStore({
        assignment: { id: row.assignment_id, model: row.model, workEffort: row.work_effort },
      });
    }

    const parsed = updateAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_assignment_update",
            message: "Send a status (active, paused, released), or a model and/or workEffort (low, medium, high, max).",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();
    const { data, error } = await client
      .rpc("update_bot_assignment", {
        p_organization_id: activeOrganization.id,
        p_assignment_id: assignmentId,
        p_status: parsed.data.status,
      })
      .single();

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore({
      assignment: serializeAssignment(data as Parameters<typeof serializeAssignment>[0]),
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "bot_assignment_update_failed",
      "The assignment could not be updated.",
    );
  }
}
