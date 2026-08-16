import { z } from "zod";

import { relayCodePurpose } from "@/lib/ai-accounts/broker";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { sealSecret } from "@/lib/server/secret-box";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * The relay: the provider's login page showed the person a confirmation code,
 * and they paste it into the web app — never into a terminal.
 *
 * The code is sealed before it is stored, bound to this session, and the
 * plaintext exists only inside this request. It is never logged, never
 * returned, and never readable by a browser role once parked.
 */

export const runtime = "nodejs";

const requestSchema = z.object({
  // Provider confirmation codes vary; bound the shape, not the format. A
  // whole pasted URL is tolerated (some providers show the code inside one)
  // but anything looking like free text is refused.
  code: z.string().trim().min(4).max(512).regex(/^\S+$/, "The code cannot contain spaces."),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    assertSameOriginRequest(request);

    const { sessionId } = await params;
    if (!z.string().uuid().safeParse(sessionId).success) {
      return jsonNoStore(
        { error: { code: "invalid_session", message: "The sign-in identifier is invalid." } },
        { status: 400 },
      );
    }

    const parsed = requestSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_code",
            message: "Paste the confirmation code exactly as the provider showed it.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can continue a sign-in." } },
        { status: 403 },
      );
    }

    const sealed = sealSecret(parsed.data.code, {
      organizationId: activeOrganization.id,
      purpose: relayCodePurpose(sessionId),
    });

    const { data, error } = await client.rpc("attach_ai_auth_relay_code", {
      p_organization_id: activeOrganization.id,
      p_session_id: sessionId,
      p_relay_code_sealed: sealed,
    });
    if (error || data !== true) {
      // One message for every refusal: expired, wrong state, or unknown
      // session all read the same from the browser.
      return jsonNoStore(
        {
          error: {
            code: "code_not_accepted",
            message: "This sign-in is no longer waiting for a code. Start it again.",
          },
        },
        { status: 409 },
      );
    }

    return jsonNoStore({ accepted: true });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "code_not_accepted",
      "The confirmation code could not be recorded.",
    );
  }
}
