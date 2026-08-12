import "server-only";

import { jsonNoStore } from "@/lib/server/http";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { RequestOriginError } from "@/lib/supabase/request";
import { SupabaseTenantError } from "@/lib/supabase/tenant";

export function supabaseBoundaryErrorResponse(error: unknown): Response | null {
  if (error instanceof SupabaseConfigurationError) {
    return jsonNoStore(
      {
        error: {
          code: "supabase_not_configured",
          message: "Supabase is not configured for this environment.",
        },
      },
      { status: 503 },
    );
  }

  if (
    error instanceof SupabaseAuthenticationError ||
    error instanceof SupabaseTenantError ||
    error instanceof RequestOriginError
  ) {
    return jsonNoStore(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  return null;
}
