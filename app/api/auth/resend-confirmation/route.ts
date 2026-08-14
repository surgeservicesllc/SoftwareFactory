import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { describeAuthFailure } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Resends the sign-up confirmation email.
 *
 * Without this an account whose first confirmation email never arrived is
 * permanently unreachable: sign-up refuses to make a second account, and
 * sign-in refuses to admit an unconfirmed one. That is the state a visitor
 * lands in whenever the project's email quota is exhausted, so the recovery
 * path has to exist independently of why the first message failed.
 */
const resendSchema = z
  .object({ email: z.string().trim().email().max(254) })
  .strict();

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

    const callbackUrl = new URL("/auth/callback", request.url);
    callbackUrl.searchParams.set("next", "/auth/onboarding");

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: parsed.data.email,
      options: { emailRedirectTo: callbackUrl.toString() },
    });

    if (error) {
      // A send failure is worth reporting plainly -- it is the difference
      // between "wait and check your inbox" and "this will never arrive".
      const failure = describeAuthFailure(error, {
        status: 400,
        code: "confirmation_resend_failed",
        message: "The confirmation email could not be sent.",
      });
      return jsonNoStore(
        { error: { code: failure.code, message: failure.message } },
        { status: failure.status },
      );
    }

    // Enumeration-safe: the same response whether or not the address has an
    // account awaiting confirmation.
    return jsonNoStore(
      {
        accepted: true,
        message: "If that address needs confirming, a new link has been sent.",
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
          code: "confirmation_resend_failed",
          message: "The confirmation email could not be sent.",
        },
      },
      { status: 500 },
    );
  }
}
