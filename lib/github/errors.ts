import "server-only";

import { GitHubAuthorizationError } from "@/lib/github/access";
import { GitHubApiError } from "@/lib/github/client";
import { GitHubConfigurationError } from "@/lib/github/config";
import { GitHubStateError } from "@/lib/github/state";
import {
  ApiRequestError,
  databaseErrorResponse,
  isClientSafeDatabaseErrorCode,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";

/**
 * PostgREST reports a raised RPC exception as a plain object, not an `Error`.
 * Without this guard every GitHub lifecycle refusal — a stale disconnect, a
 * terminally deleted installation id, a cross-tenant installation binding —
 * collapses into an untruthful generic failure. Only recognized SQLSTATE codes
 * are forwarded, so an unexpected database fault still stays opaque.
 */
function clientSafeDatabaseError(error: unknown): { code: string; message: string } | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code !== "string" || typeof candidate.message !== "string") return null;
  if (!isClientSafeDatabaseErrorCode(candidate.code)) return null;
  return { code: candidate.code, message: candidate.message };
}

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
  const databaseError = clientSafeDatabaseError(error);
  if (databaseError) return databaseErrorResponse(databaseError);
  return jsonNoStore(
    { error: { code: "internal_error", message: "The GitHub request failed safely." } },
    { status: 500 },
  );
}
