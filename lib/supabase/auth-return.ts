import "server-only";

import { cookies } from "next/headers";

import { normalizeReturnPath } from "@/lib/supabase/request";

/**
 * Carries the post-confirmation destination in a cookie rather than the
 * callback URL.
 *
 * Supabase matches `emailRedirectTo` against its redirect allowlist and, on a
 * miss, silently falls back to Site URL instead of reporting anything. An
 * allowlist entry is a bare `/auth/callback`, so appending `?next=...` misses,
 * and the emailed link resolves to the site root carrying a `?code=` that the
 * marketing page ignores. The address gets confirmed and nobody gets signed in.
 *
 * Widening the allowlist with a wildcard would fix the match and open a
 * redirect hole, so the destination travels out of band instead. The cookie is
 * host-only, HTTP-only, and short-lived, and the value is re-validated through
 * `normalizeReturnPath` on the way out as well as in -- a cookie is caller
 * input like any other.
 */

const RETURN_COOKIE = "sf-auth-return";
const MAX_AGE_SECONDS = 30 * 60;

export async function rememberAuthReturnPath(value: string | null | undefined) {
  const path = normalizeReturnPath(value, "");
  if (!path) return;

  (await cookies()).set(RETURN_COOKIE, path, {
    httpOnly: true,
    maxAge: MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function takeAuthReturnPath(fallback: string): Promise<string> {
  const store = await cookies();
  const stored = store.get(RETURN_COOKIE)?.value;
  if (stored) store.delete(RETURN_COOKIE);
  return normalizeReturnPath(stored, fallback);
}
