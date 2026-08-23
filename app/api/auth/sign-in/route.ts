import { z } from "zod";

import { DECISION_PATH, openDecisionGate } from "@/lib/auth/decision-gate";
import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { describeAuthFailure } from "@/lib/supabase/auth";
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
      const failure = describeAuthFailure(error, {
        status: 401,
        code: "invalid_credentials",
        message: "The email address or password was not accepted.",
      });
      return jsonNoStore(
        {
          error: {
            code: failure.code,
            message: failure.message,
            // Lets the form offer a resend link instead of leaving someone
            // stuck being told a correct password was wrong.
            ...(failure.needsConfirmation ? { needsConfirmation: true } : {}),
          },
        },
        { status: failure.status },
      );
    }

    /*
     * A session now exists, so this is the moment "initial login" refers to.
     * Opening the gate here rather than on the decision page keeps the page
     * itself incapable of granting its own access.
     */
    await openDecisionGate();

    return jsonNoStore({
      authenticated: true,
      // The chooser, not the public home page and not a console page picked
      // for them. A caller who asked for somewhere specific still gets it —
      // that is what makes a shared link to a protected page work.
      next: normalizeReturnPath(parsed.data.returnTo, DECISION_PATH),
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
