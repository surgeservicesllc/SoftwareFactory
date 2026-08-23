import { NextResponse } from "next/server";

import { DECISION_PATH, openDecisionGate } from "@/lib/auth/decision-gate";
import { takeAuthReturnPath } from "@/lib/supabase/auth-return";
import { normalizeReturnPath } from "@/lib/supabase/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Completes an emailed sign-in (or an OAuth/PKCE return) and establishes the
 * server session cookies.
 *
 * Two lanes, because emailed links and browser-initiated flows have different
 * physics:
 *
 * `?token_hash=&type=` — the emailed magic-link lane. The Supabase email
 * template links here with `{{ .TokenHash }}`, and the server verifies it
 * directly (`verifyOtp`). This lane is deliberately independent of which
 * browser opens the link: mail apps routinely open links in their own
 * embedded browser rather than the one that requested the sign-in, and the
 * PKCE lane below cannot survive that hop (its code verifier lives in a
 * cookie in the requesting browser). This was the production `callback_failed`
 * root cause — not an expired link, but a verifier the opening browser never
 * had.
 *
 * `?code=` — the PKCE lane, kept for OAuth returns and for links opened in
 * the same browser that requested them (`exchangeCodeForSession` pairs the
 * code with the locally stored verifier).
 *
 * Failures log a bounded diagnostic — the lane and the provider's error
 * shape, never a token, hash, or code value — and land on the sign-in page
 * with a retryable notice rather than a dead end.
 */

/** The email verification types GoTrue issues token hashes for. */
const EMAIL_OTP_TYPES = [
  "email",
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
] as const;

type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

function isEmailOtpType(value: string): value is EmailOtpType {
  return (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function redirectNoStore(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function signInErrorRedirect(origin: string) {
  const signInUrl = new URL("/auth/sign-in", origin);
  signInUrl.searchParams.set("error", "callback_failed");
  return redirectNoStore(signInUrl);
}

/** Log the failure shape for operators without ever logging secret material. */
function logCallbackFailure(lane: "token_hash" | "code" | "request", error: unknown) {
  const shape = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        code: (error as { code?: unknown }).code,
        status: (error as { status?: unknown }).status,
      }
    : { name: "unknown", message: String(error) };
  console.error(`[auth/callback] ${lane} verification failed`, shape);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const code = requestUrl.searchParams.get("code");
  // A query parameter still wins when one survives, but the emailed link
  // cannot carry one, so the remembered path is the real source here.
  // `/decision` is the default rather than `/auth/onboarding`: the decision
  // page sends someone with no workspace through onboarding and brings them
  // straight back, so a returning person stops being shown "Name your
  // workspace" for a workspace they already have.
  const next = requestUrl.searchParams.get("next")
    ? normalizeReturnPath(requestUrl.searchParams.get("next"), DECISION_PATH)
    : await takeAuthReturnPath(DECISION_PATH);

  // The emailed lane: verify the token hash server-side. No cookie from the
  // requesting browser is needed, so the link works wherever it is opened.
  if (tokenHash && type) {
    if (!isEmailOtpType(type) || tokenHash.length < 8 || tokenHash.length > 512) {
      logCallbackFailure("request", new Error(`unsupported verification request shape (type=${type})`));
      return signInErrorRedirect(requestUrl.origin);
    }
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      if (error) throw error;

      const { data, error: verificationError } = await supabase.auth.getUser();
      if (verificationError || !data.user) throw verificationError ?? new Error("no user after verification");

      await openDecisionGate();
      return redirectNoStore(new URL(next, requestUrl.origin));
    } catch (error) {
      logCallbackFailure("token_hash", error);
      return signInErrorRedirect(requestUrl.origin);
    }
  }

  if (!code) {
    logCallbackFailure("request", new Error("callback carried neither token_hash nor code"));
    return signInErrorRedirect(requestUrl.origin);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;

    const { data, error: verificationError } = await supabase.auth.getUser();
    if (verificationError || !data.user) throw verificationError ?? new Error("no user after exchange");

    await openDecisionGate();
    return redirectNoStore(new URL(next, requestUrl.origin));
  } catch (error) {
    logCallbackFailure("code", error);
    return signInErrorRedirect(requestUrl.origin);
  }
}
