import "server-only";

import { validateSupabasePublicEnvironment } from "@/lib/supabase/config";
import type { SupabasePublicEnvironment } from "@/lib/supabase/config";

export { SupabaseConfigurationError } from "@/lib/supabase/config";

export function getSupabasePublicEnvironment(): SupabasePublicEnvironment {
  return validateSupabasePublicEnvironment(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
