import { jsonNoStore } from "@/lib/server/http";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import {
  chooseActiveOrganization,
  clearActiveOrganizationId,
  listOrganizationMemberships,
  readActiveOrganizationId,
} from "@/lib/supabase/tenant";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { client, user } = await requireAuthenticatedUser();
    const organizations = await listOrganizationMemberships(client, user.id);
    const requestedId = await readActiveOrganizationId();
    const activeOrganization = chooseActiveOrganization(organizations, requestedId);

    if (requestedId && !activeOrganization) {
      await clearActiveOrganizationId();
    }

    return jsonNoStore({
      activeOrganizationId: activeOrganization?.id ?? null,
      organizations,
      needsOnboarding: organizations.length === 0,
      needsSelection: organizations.length > 1 && !activeOrganization,
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;

    return jsonNoStore(
      {
        error: {
          code: "organizations_unavailable",
          message: "Organizations could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}
