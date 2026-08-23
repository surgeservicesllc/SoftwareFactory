import { forgetDecision } from "@/lib/auth/decision-gate";
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
    // The chooser's marker belongs to a session. Clearing it here means a
    // shared browser never inherits the previous person's choice.
    await forgetDecision();
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
