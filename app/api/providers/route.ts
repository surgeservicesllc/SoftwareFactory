import { jsonNoStore } from "@/lib/server/http";
import { loadProviderStatus } from "@/lib/providers/service";
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

    const [providers, organization] = await Promise.all([
      loadProviderStatus(client, activeOrganization.id),
      client
        .from("organizations")
        .select("ai_provider_execution_enabled")
        .eq("id", activeOrganization.id)
        .maybeSingle(),
    ]);

    if (organization.error) {
      return jsonNoStore(
        { error: { code: "database_error", message: "Provider status could not be loaded." } },
        { status: 500 },
      );
    }

    return jsonNoStore({
      organization: {
        id: activeOrganization.id,
        name: activeOrganization.name,
        role: activeOrganization.role,
      },
      executionEnabled: Boolean(
        (organization.data as { ai_provider_execution_enabled?: boolean } | null)
          ?.ai_provider_execution_enabled,
      ),
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
