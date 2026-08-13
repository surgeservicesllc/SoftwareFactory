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

    const parsed = updateAssignmentSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_assignment_status",
            message: "Status must be active, paused, or released.",
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
