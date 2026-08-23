import { closeDecisionGate } from "@/lib/auth/decision-gate";
import { jsonNoStore } from "@/lib/server/http";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { clearActiveOrganizationId } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { client } = await requireAuthenticatedUser();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) {
      return jsonNoStore(
        {
          error: {
            code: "sign_out_failed",
            message: "The session could not be cleared.",
          },
        },
        { status: 503 },
      );
    }

    await clearActiveOrganizationId();
    // The chooser belongs to a session. Signing in sets the marker again, so
    // this only makes sure a signed-out browser is not carrying one.
    await closeDecisionGate();
    return jsonNoStore({ signedOut: true });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;

    return jsonNoStore(
      {
        error: {
          code: "sign_out_failed",
          message: "The session could not be cleared.",
        },
      },
      { status: 500 },
    );
  }
}
