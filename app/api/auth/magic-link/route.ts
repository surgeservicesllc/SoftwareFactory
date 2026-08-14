import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { authProviderFailureStatus } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import {
  assertSameOriginRequest,
  normalizeReturnPath,
} from "@/lib/supabase/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const magicLinkSchema = z
  .object({
    email: z.string().trim().email().max(254),
    returnTo: z.string().max(2048).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = magicLinkSchema.safeParse(
      await readBoundedJson(request, 4 * 1024),
    );
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_magic_link_request",
            message: "Enter a valid email address.",
          },
        },
        { status: 400 },
      );
    }

    const next = normalizeReturnPath(parsed.data.returnTo, "/auth/onboarding");
    const callbackUrl = new URL("/auth/callback", request.url);
    callbackUrl.searchParams.set("next", next);

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: false,
      },
    });

    if (error) {
      const status = authProviderFailureStatus(error, 400);
      return jsonNoStore(
        {
          error: {
            code:
              status === 429
                ? "authentication_rate_limited"
                : "magic_link_unavailable",
            message:
              status === 429
                ? "Too many authentication attempts. Try again later."
                : "A sign-in link could not be sent.",
          },
        },
        { status },
      );
    }

    // Keep the response account-enumeration safe and never return an OTP or
    // provider response. Supabase sends the one-time link out of band.
    return jsonNoStore(
      {
        accepted: true,
        message: "If the account exists, a one-time sign-in link has been sent.",
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
          code: "magic_link_unavailable",
          message: "A sign-in link could not be sent.",
        },
      },
      { status: 500 },
    );
  }
}
