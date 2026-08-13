import { normalizeCredentialRef } from "@/lib/bots/credentials";
import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { registerBotSchema } from "@/lib/bots/schemas";
import { canManageBotFabric, loadBotFabric, serializeBot } from "@/lib/bots/service";
import { PHASE_1D_SAFETY_DEFAULTS } from "@/lib/constants";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const snapshot = await loadBotFabric(client, activeOrganization.id);

    return jsonNoStore({
      activeOrganizationId: activeOrganization.id,
      canManage: canManageBotFabric(activeOrganization.role),
      ...snapshot,
      executor: {
        connected: false,
        label: "Not Connected",
        detail:
          "Bots, roles, and assignments are control-plane records. No worker executes them in this phase.",
        globalKillSwitchActive: PHASE_1D_SAFETY_DEFAULTS.globalKillSwitchActive,
      },
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "bot_fabric_unavailable",
      "The bot fabric could not be loaded.",
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = registerBotSchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_bot",
            message: "Choose a provider, then set a name and model identifier.",
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
            message: "Bot details look like they contain a credential. Reference a variable name instead.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();
    const credentialRef = normalizeCredentialRef(parsed.data.credentialRef);

    const { data, error } = await client
      .rpc("register_bot", {
        p_organization_id: activeOrganization.id,
        p_name: parsed.data.name,
        p_provider: parsed.data.provider,
        p_model: parsed.data.model,
        p_credential_ref: credentialRef,
        p_base_url: parsed.data.baseUrl || null,
        p_notes: parsed.data.notes || null,
      })
      .single();

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore(
      { bot: serializeBot(data as Parameters<typeof serializeBot>[0]) },
      { status: 201 },
    );
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "bot_registration_failed",
      "The bot could not be registered.",
    );
  }
}
