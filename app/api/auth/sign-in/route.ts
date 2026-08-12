import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { authProviderFailureStatus } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import {
  assertSameOriginRequest,
  normalizeReturnPath,
} from "@/lib/supabase/request";

export const runtime = "nodejs";

const signInSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128),
    returnTo: z.string().max(2048).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = signInSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_sign_in",
            message: "Enter a valid email address and password.",
          },
        },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error || !data.user || !data.session) {
      const status = authProviderFailureStatus(error, 401);
      return jsonNoStore(
        {
          error: {
            code:
              status === 429
                ? "authentication_rate_limited"
                : status >= 500
                  ? "authentication_unavailable"
                  : "invalid_credentials",
            message:
              status === 429
                ? "Too many authentication attempts. Try again later."
                : status >= 500
                ? "Authentication is temporarily unavailable."
                : "The email address or password was not accepted.",
          },
        },
        { status },
      );
    }

    return jsonNoStore({
      authenticated: true,
      next: normalizeReturnPath(parsed.data.returnTo, "/"),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;

    return jsonNoStore(
      {
        error: {
          code: "sign_in_failed",
          message: "Sign in failed safely. Try again.",
        },
      },
      { status: 500 },
    );
  }
}
