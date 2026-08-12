import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

/**
 * Creates a fresh, user-scoped Supabase client for each server request.
 *
 * This intentionally uses the publishable key and the caller's auth cookies.
 * Service-role credentials must never be used by request handlers.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { publishableKey, url } = getSupabasePublicEnvironment();

  return createServerClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, options, value } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

