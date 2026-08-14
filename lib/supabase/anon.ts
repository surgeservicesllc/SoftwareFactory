import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

/**
 * Creates a session-less Supabase client for reading world-readable content.
 *
 * Unlike `createSupabaseServerClient`, this never touches `cookies()`, so a
 * caller stays statically renderable and cacheable. It carries no session, so
 * every read runs as `anon` and sees only what the anonymous SELECT policies
 * publish — use it for public marketing copy, never for tenant data.
 *
 * It uses the publishable key. Service-role credentials must never be used by
 * request handlers.
 */
export function createSupabaseAnonClient() {
  const { publishableKey, url } = getSupabasePublicEnvironment();

  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
