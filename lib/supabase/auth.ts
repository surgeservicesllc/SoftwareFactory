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

export type AuthFailure = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** True when the caller has an account but has not confirmed their email. */
  readonly needsConfirmation?: boolean;
};

/**
 * Turns a Supabase auth error into something a person can act on.
 *
 * Every failure used to collapse into one sentence — "The account could not be
 * created." — which covers an unusable address, a rejected password, disabled
 * signups, and an undeliverable confirmation email alike. A visitor cannot tell
 * whether to fix their input, wait, or give up, so they retry forever.
 *
 * Deliberate disclosure choice: `email_not_confirmed` on sign-in reveals that
 * an address is registered. Without it the only alternative is to tell someone
 * their correct password was wrong and leave them permanently stuck, so the
 * enumeration signal is accepted here and the resend path stays neutral.
 */
export function describeAuthFailure(
  error: { status?: number; code?: string; message?: string } | null,
  fallback: { status: 400 | 401; code: string; message: string },
): AuthFailure {
  const status = authProviderFailureStatus(error, fallback.status);

  switch (error?.code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return {
        status: 429,
        code: "email_send_rate_limited",
        message:
          "Too many emails have been sent from this project recently, so the confirmation email could not go out. Wait a few minutes and try again.",
      };
    case "email_address_invalid":
      return {
        status: 400,
        code: "email_address_invalid",
        message: "That email address was not accepted. Check it and try again.",
      };
    case "weak_password":
      return {
        status: 400,
        code: "weak_password",
        message:
          error.message?.trim()
          || "That password does not meet the requirements. Use at least 12 characters with letters and numbers.",
      };
    case "signup_disabled":
      return {
        status: 403,
        code: "signup_disabled",
        message: "Account creation is currently switched off for this workspace.",
      };
    case "email_not_confirmed":
      return {
        status: 403,
        code: "email_not_confirmed",
        message:
          "This account still needs its email confirmed. Use the resend button below to get a new confirmation link.",
        needsConfirmation: true,
      };
    case "email_exists":
    case "user_already_exists":
      // Never confirm an address is taken during sign-up. Point at sign-in,
      // which is the right next step whether or not the account exists.
      return {
        status: 400,
        code: "sign_up_unavailable",
        message: "That address cannot be used to create a new account. Try signing in instead.",
      };
    default:
      break;
  }

  if (status === 429) {
    return {
      status: 429,
      code: "authentication_rate_limited",
      message: "Too many authentication attempts. Try again later.",
    };
  }
  if (status === 503) {
    return {
      status: 503,
      code: "authentication_unavailable",
      message: "Authentication is temporarily unavailable. Try again shortly.",
    };
  }
  return { status, code: fallback.code, message: fallback.message };
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
