import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseServiceRoleKey } from "@/lib/github/config";
import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

/**
 * Creates the narrow server-only Supabase client used by verified machine
 * boundaries: the signed GitHub webhook and the durable worker tick.
 *
 * Holding this client is not authorization. Every privileged operation still
 * goes through an audited SECURITY DEFINER function that validates the actor,
 * organization, and resource. It must never reach a browser bundle or an
 * interactive request handler, which continue to use the caller's JWT and RLS.
 */
export function createSupabaseServiceRoleClient() {
  const { url } = getSupabasePublicEnvironment();
  return createClient(url, getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
