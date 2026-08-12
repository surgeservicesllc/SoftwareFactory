import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { authProviderFailureStatus } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const signUpSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(254),
    password: z
      .string()
      .min(12)
      .max(128)
      .regex(/[A-Za-z]/)
      .regex(/[0-9]/),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = signUpSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_sign_up",
            message:
              "Use a valid email and a password of at least 12 characters containing letters and numbers.",
          },
        },
        { status: 400 },
      );
    }

    if (
      parsed.data.displayName &&
      findSensitiveData({ displayName: parsed.data.displayName })
    ) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "The display name appears to contain sensitive data.",
          },
        },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const callbackUrl = new URL("/auth/callback", request.url);
    callbackUrl.searchParams.set("next", "/auth/onboarding");

    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: parsed.data.displayName
          ? { full_name: parsed.data.displayName }
          : undefined,
        emailRedirectTo: callbackUrl.toString(),
      },
    });

    if (error || !data.user) {
      const status = authProviderFailureStatus(error, 400);
      return jsonNoStore(
        {
          error: {
            code: status === 429 ? "authentication_rate_limited" : "sign_up_failed",
            message:
              status === 429
                ? "Too many authentication attempts. Try again later."
                : "The account could not be created.",
          },
        },
        { status },
      );
    }

    const confirmationRequired = !data.session;
    return jsonNoStore(
      {
        confirmationRequired,
        next: confirmationRequired ? "/auth/sign-in?message=check-email" : "/auth/onboarding",
      },
      { status: confirmationRequired ? 202 : 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;

    return jsonNoStore(
      {
        error: {
          code: "sign_up_failed",
          message: "Account creation failed safely. Try again.",
        },
      },
      { status: 500 },
    );
  }
}
