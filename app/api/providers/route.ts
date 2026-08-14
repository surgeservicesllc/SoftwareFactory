import { jsonNoStore } from "@/lib/server/http";
import { resolveProviderConfiguration } from "@/lib/providers/config";
import { loadProviderStatus } from "@/lib/providers/service";
import { PROVIDER_IDS, type ProviderHealth } from "@/lib/providers/types";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Live AI provider status for the caller's active organization.
 *
 * Every state is proven: `Connected` means a request reached the provider
 * during this call. Nothing here returns a credential, and the environment
 * variable list contains names only.
 */
export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const organization = await client
      .from("organizations")
      .select("ai_provider_execution_enabled")
      .eq("id", activeOrganization.id)
      .maybeSingle();

    if (organization.error) {
      return jsonNoStore(
        { error: { code: "database_error", message: "Provider status could not be loaded." } },
        { status: 500 },
      );
    }

    const executionEnabled = Boolean(
      (organization.data as { ai_provider_execution_enabled?: boolean } | null)
        ?.ai_provider_execution_enabled,
    );
    const noProbeHealth: readonly ProviderHealth[] | undefined = executionEnabled
      ? undefined
      : PROVIDER_IDS.map((provider) => Object.freeze({
          provider,
          state: "disabled" as const,
          checkedAt: new Date().toISOString(),
          detail: "Outbound provider execution is disabled for this organization; no provider probe ran.",
          latencyMs: null,
          defaultModel: resolveProviderConfiguration(provider).defaultModel,
        }));
    const providers = await loadProviderStatus(client, activeOrganization.id, noProbeHealth);

    return jsonNoStore({
      organization: {
        id: activeOrganization.id,
        name: activeOrganization.name,
        role: activeOrganization.role,
      },
      executionEnabled,
      providers,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "Provider status could not be loaded." } },
      { status: 500 },
    );
  }
}
