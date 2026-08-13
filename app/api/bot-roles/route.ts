import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { saveBotRoleSchema, toDatabaseRiskLevel } from "@/lib/bots/schemas";
import { serializeBotRole } from "@/lib/bots/service";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * Create or update a role. Roles are authored by the organization, so the same
 * audited function handles both; supplying `roleId` edits in place.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = saveBotRoleSchema.safeParse(await readBoundedJson(request, 32 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_bot_role",
            message: "A role needs a name, URL-safe slug, summary, and instructions.",
          },
        },
        { status: 400 },
      );
    }
    if (findSensitiveData(parsed.data)) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "Role instructions must not contain credentials or keys.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();
    const { data, error } = await client
      .rpc("save_bot_role", {
        p_organization_id: activeOrganization.id,
        p_role_id: parsed.data.roleId ?? null,
        p_name: parsed.data.name,
        p_slug: parsed.data.slug,
        p_summary: parsed.data.summary,
        p_instructions: parsed.data.instructions,
        p_risk_ceiling: toDatabaseRiskLevel(parsed.data.riskCeiling),
        p_capabilities: parsed.data.capabilities,
      })
      .single();

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore(
      { role: serializeBotRole(data as Parameters<typeof serializeBotRole>[0]) },
      { status: parsed.data.roleId ? 200 : 201 },
    );
  } catch (error) {
    return botFabricErrorResponse(error, "bot_role_save_failed", "The role could not be saved.");
  }
}
