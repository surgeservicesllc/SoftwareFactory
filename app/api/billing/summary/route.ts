import { billingConnected } from "@/lib/billing/plans";
import { readUsage, resolveEntitlements } from "@/lib/billing/entitlements";
import { ApiRequestError, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The active organization's plan, limits, and month-to-date usage — the data
 * behind the billing page's meters. Reads only what RLS already lets the
 * member see.
 */
export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const [entitlements, usage] = await Promise.all([
      resolveEntitlements(client, activeOrganization.id),
      readUsage(client, activeOrganization.id),
    ]);

    return jsonNoStore({
      connected: billingConnected(),
      plan: {
        key: entitlements.plan.key,
        name: entitlements.plan.name,
        limits: entitlements.plan.entitlements,
      },
      subscription: entitlements.subscription,
      usage,
      role: activeOrganization.role,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "billing_unavailable", message: "Billing is unavailable right now." } },
      { status: 500 },
    );
  }
}
