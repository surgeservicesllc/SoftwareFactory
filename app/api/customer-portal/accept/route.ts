import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * Turning an invitation into a login.
 *
 * The caller here is authenticated but is not yet a portal user, so there
 * is nothing to resolve them against — this is the one portal route that
 * runs before `crm_portal_me()` can answer. Everything that decides the
 * outcome happens in the database: the function matches the verified
 * address behind the caller's own session against an open invitation, and
 * `portalUserId` only narrows that search. Sending somebody else's id
 * cannot claim it.
 */

const schema = z
  .object({ portalUserId: z.string().uuid().nullish() })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = schema.parse(await readBoundedJson(request, 4_000).catch(() => ({})));
    const { client } = await requireAuthenticatedUser();

    const { data, error } = await client.rpc("crm_portal_accept_invitation", {
      p_portal_user: payload.portalUserId ?? null,
    });
    if (error) {
      /*
       * The database refuses "never invited", "already claimed" and
       * "switched off" with one message on purpose — telling them apart
       * would turn this route into a way to ask whether an address is a
       * customer. The API keeps that indistinguishable too.
       */
      if (error.code === "P0002" || /no open invitation|no verified address/i.test(error.message ?? "")) {
        return jsonNoStore(
          {
            error: {
              code: "invitation_not_open",
              message: "There is no open portal invitation for your address.",
            },
          },
          { status: 404 },
        );
      }
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "login_already_linked",
              message: "This sign-in is already linked to a customer account.",
            },
          },
          { status: 409 },
        );
      }
      throw error;
    }

    return jsonNoStore({ portalUserId: data as string }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_invitation_claim", message: "The invitation could not be accepted." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "portal_invitation_not_accepted", message: "The invitation could not be accepted." } },
      { status: 500 },
    );
  }
}
