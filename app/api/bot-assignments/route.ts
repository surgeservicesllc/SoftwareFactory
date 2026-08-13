import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { assignBotSchema } from "@/lib/bots/schemas";
import { serializeAssignment } from "@/lib/bots/service";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * Post a bot to a project under a role.
 *
 * A bot holds at most one open posting, so this endpoint covers first
 * assignment, moving between projects, and changing role. The database function
 * decides which transition occurred and records the matching audit event. An
 * assignment is routing intent; nothing executes as a result of it.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = assignBotSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_assignment",
            message: "Choose a bot, a project, and a role.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();
    const { data, error } = await client
      .rpc("assign_bot", {
        p_organization_id: activeOrganization.id,
        p_bot_id: parsed.data.botId,
        p_project_id: parsed.data.projectId,
        p_role_id: parsed.data.roleId,
      })
      .single();

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore(
      {
        assignment: serializeAssignment(data as Parameters<typeof serializeAssignment>[0]),
        executorConnected: false,
      },
      { status: 201 },
    );
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "bot_assignment_failed",
      "The bot could not be assigned.",
    );
  }
}
