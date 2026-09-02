import { ApiRequestError, databaseErrorResponse, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Assign every account with no territory by the postal code in its
 * billing address. Runs as the caller; every assignment writes a history
 * line naming the postal code and the territory it matched. Returns how
 * many were assigned — and an account whose address carries no postal
 * code inside any territory's coverage is left exactly as it was.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client.rpc("crm_assign_accounts_by_postal", {
      p_organization: activeOrganization.id,
    });
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ assigned: Number(data ?? 0) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_assignment_failed", message: "Accounts could not be assigned." } },
      { status: 500 },
    );
  }
}
