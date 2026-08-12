"use client";

import { createBrowserClient } from "@supabase/ssr";

import { validateSupabasePublicEnvironment } from "@/lib/supabase/config";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

/**
 * Returns a singleton browser client backed only by the publishable Supabase
 * credential. Database authorization still relies on RLS and the user JWT.
 */
export function createSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const { publishableKey, url } = validateSupabasePublicEnvironment(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  browserClient = createBrowserClient(url, publishableKey, {
    auth: {
      detectSessionInUrl: false,
      persistSession: true,
    },
  });

  return browserClient;
}
