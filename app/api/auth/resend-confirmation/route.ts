import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { authErrorBody, describeAuthError } from "@/lib/supabase/auth-errors";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const resendSchema = z
  .object({
    email: z.string().trim().email().max(254),
  })
  .strict();

/**
 * Send another sign-up confirmation email.
 *
 * Without this, an account whose confirmation email was lost, delayed, or
 * suppressed by a mail rate limit is permanently unusable: the address cannot
 * be signed in with, and signing up again returns "already registered".
 *
 * The response is deliberately identical whether or not the address has an
 * account awaiting confirmation, so this cannot be used to enumerate users.
 * Supabase itself refuses to resend to an already-confirmed address, so a
 * successful call cannot be used to spam a confirmed user either.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = resendSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_resend_request",
            message: "Enter a valid email address.",
          },
        },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const callbackUrl = new URL("/auth/callback", request.url);
    callbackUrl.searchParams.set("next", "/auth/onboarding");

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: parsed.data.email,
      options: { emailRedirectTo: callbackUrl.toString() },
    });

    if (error) {
      const outcome = describeAuthError(error, "resend");

      /*
       * Only address-independent failures may be reported.
       *
       * Reporting a rate limit or a failed delivery here would leak exactly
       * what the neutral response exists to hide: both can only happen when
       * Supabase actually attempted a send, which it only does for an address
       * that has an account awaiting confirmation. An unknown address returns
       * immediately and consumes no quota, so "429 vs 202" answers the
       * question "is this person registered?" — verified live before this
       * branch was narrowed. A disabled email provider is project-level
       * configuration and is identical for every address, so it stays.
       */
      if (outcome.code === "email_provider_disabled") {
        return jsonNoStore(authErrorBody(outcome), { status: outcome.status });
      }
    }

    return jsonNoStore(
      {
        accepted: true,
        // The delivery caveat is stated unconditionally, so it carries no
        // signal about whether a send was attempted for this address.
        message:
          "If that address has an account awaiting confirmation, a new confirmation email is on its way. If nothing arrives within a few minutes, this workspace's email limit may be exhausted — ask an owner to check its mail configuration.",
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;

    return jsonNoStore(
      {
        error: {
          code: "resend_failed",
          message: "The confirmation email could not be sent. Try again shortly.",
        },
      },
      { status: 500 },
    );
  }
}
