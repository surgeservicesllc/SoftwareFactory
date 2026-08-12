import "server-only";

import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export class SupabaseAuthenticationError extends Error {
  readonly code: "authentication_required" | "authentication_unavailable";
  readonly status: 401 | 503;

  constructor(
    code: "authentication_required" | "authentication_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SupabaseAuthenticationError";
    this.code = code;
    this.status = code === "authentication_required" ? 401 : 503;
  }
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export function authProviderFailureStatus(
  error: { status?: number } | null,
  clientFailureStatus: 400 | 401,
): 400 | 401 | 429 | 503 {
  if (error?.status === 429) return 429;
  if (!error?.status || error.status >= 500) return 503;
  return clientFailureStatus;
}

/**
 * Verifies the access token with Supabase Auth. Never trust cookie contents or
 * `getSession()` alone for authorization decisions.
 */
export async function requireAuthenticatedUser(
  client?: ServerClient,
): Promise<{ client: ServerClient; user: User }> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (authProviderFailureStatus(error, 401) === 503) {
      throw new SupabaseAuthenticationError(
        "authentication_unavailable",
        "Authentication could not be verified.",
      );
    }
  }

  if (error || !data.user) {
    throw new SupabaseAuthenticationError(
      "authentication_required",
      "Authentication is required.",
    );
  }

  return { client: supabase, user: data.user };
}
