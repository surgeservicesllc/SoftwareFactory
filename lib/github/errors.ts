import "server-only";

import { GitHubAuthorizationError } from "@/lib/github/access";
import { GitHubApiError } from "@/lib/github/client";
import { GitHubConfigurationError } from "@/lib/github/config";
import { GitHubStateError } from "@/lib/github/state";
import { ApiRequestError, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";

export function githubRouteErrorResponse(error: unknown) {
  const boundaryResponse = supabaseBoundaryErrorResponse(error);
  if (boundaryResponse) return boundaryResponse;
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof GitHubAuthorizationError || error instanceof GitHubApiError) {
    return jsonNoStore(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof GitHubStateError) {
    return jsonNoStore(
      { error: { code: "github_state_invalid", message: error.message } },
      { status: 400 },
    );
  }
  if (error instanceof GitHubConfigurationError) {
    return jsonNoStore(
      {
        error: {
          code: "github_not_configured",
          message: "GitHub App integration is Not Connected because its server configuration is incomplete.",
        },
      },
      { status: 503 },
    );
  }
  if (error instanceof SupabaseConfigurationError) {
    return jsonNoStore(
      {
        error: {
          code: "supabase_not_configured",
          message: "GitHub App integration is unavailable because Supabase is not configured.",
        },
      },
      { status: 503 },
    );
  }
  return jsonNoStore(
    { error: { code: "internal_error", message: "The GitHub request failed safely." } },
    { status: 500 },
  );
}
