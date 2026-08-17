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

const CALLBACK_ERROR_CODE = /^[a-z][a-z0-9_]{0,62}$/;
const CALLBACK_ERROR_MESSAGE_LIMIT = 240;

/**
 * Reduces any GitHub route error to a browser-safe `{ code, message }` pair for
 * a redirect notice. It reuses `githubRouteErrorResponse` so the code and
 * message shown to a person exactly match what an API client would receive,
 * clamped to a short, control-character-free notice.
 */
export async function safeGitHubClientError(
  error: unknown,
): Promise<{ code: string; message: string }> {
  const apiResponse = githubRouteErrorResponse(error);
  let code = "github_callback_failed";
  let message = "GitHub authorization could not be completed safely.";
  try {
    const body = (await apiResponse.clone().json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (typeof body.error?.code === "string" && CALLBACK_ERROR_CODE.test(body.error.code)) {
      code = body.error.code;
    }
    if (typeof body.error?.message === "string" && body.error.message.trim()) {
      message = body.error.message.trim().slice(0, CALLBACK_ERROR_MESSAGE_LIMIT);
    }
  } catch {
    // Fall back to the fixed, client-safe failure notice.
  }
  return { code, message };
}

/**
 * A 303 redirect to the Connections console carrying a bounded error notice.
 * Both the installation callback and the installation launcher fail this way so
 * a person on any device lands on a page that explains what happened rather
 * than a raw JSON error or a dead end.
 */
export function githubConnectionsErrorRedirect(
  baseUrl: string | URL,
  code: string,
  message: string,
): Response {
  const redirect = new URL("/solutions/connections", baseUrl);
  redirect.searchParams.set("github", "error");
  redirect.searchParams.set("githubError", code);
  redirect.searchParams.set("githubMessage", message);
  return new Response(null, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Location: redirect.toString(),
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    },
    status: 303,
  });
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
