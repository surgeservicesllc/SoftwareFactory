import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseServiceRoleKey } from "@/lib/github/config";
import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

export function createSupabaseGitHubWebhookClient() {
  const { url } = getSupabasePublicEnvironment();
  return createClient(url, getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
