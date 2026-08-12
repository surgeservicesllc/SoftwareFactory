import { NextResponse } from "next/server";

import { normalizeReturnPath } from "@/lib/supabase/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function redirectNoStore(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = normalizeReturnPath(
    requestUrl.searchParams.get("next"),
    "/auth/onboarding",
  );

  if (!code) {
    const signInUrl = new URL("/auth/sign-in", requestUrl.origin);
    signInUrl.searchParams.set("error", "callback_failed");
    return redirectNoStore(signInUrl);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;

    const { data, error: verificationError } = await supabase.auth.getUser();
    if (verificationError || !data.user) throw verificationError;

    return redirectNoStore(new URL(next, requestUrl.origin));
  } catch {
    const signInUrl = new URL("/auth/sign-in", requestUrl.origin);
    signInUrl.searchParams.set("error", "callback_failed");
    return redirectNoStore(signInUrl);
  }
}
