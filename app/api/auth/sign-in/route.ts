import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { authErrorBody, describeAuthError } from "@/lib/supabase/auth-errors";
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
      // An unconfirmed address is the single most common reason a correct
      // password is refused. Reporting it as a credential failure sends people
      // to reset a password that was never wrong, so it keeps its own code and
      // the browser is told a resend is available.
      const outcome = describeAuthError(error, "sign_in");
      return jsonNoStore(authErrorBody(outcome), { status: outcome.status });
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
