import "server-only";

import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

/**
 * Whether a visitor can actually finish creating an account right now.
 *
 * Sign-up broke in production for a reason nothing in the product surfaced:
 * the project requires a confirmation email and sends it through Supabase's
 * built-in sender, which allows roughly two messages an hour. Visitors saw a
 * failure; nobody operating the system saw anything at all. A configuration
 * that silently rejects most sign-ups should be visible where the rest of this
 * control plane reports its truth, next to every other **Not Connected**.
 *
 * Reads only Supabase's public settings endpoint with the publishable key. It
 * makes no claim about deliverability -- that cannot be observed without
 * sending a message -- and reports the conditions that make delivery a
 * bottleneck instead.
 */

export type AuthReadinessState = "ready" | "degraded" | "blocked" | "unknown";

export type AuthReadiness = {
  readonly state: AuthReadinessState;
  readonly signupEnabled: boolean | null;
  readonly emailConfirmationRequired: boolean | null;
  /** Present only when something needs an owner decision. */
  readonly findings: readonly string[];
};

type SupabaseAuthSettings = {
  disable_signup?: boolean;
  mailer_autoconfirm?: boolean;
  external?: Record<string, boolean>;
};

const REQUEST_TIMEOUT_MS = 4_000;

export async function readAuthReadiness(
  fetchImpl: typeof fetch = fetch,
): Promise<AuthReadiness> {
  let settings: SupabaseAuthSettings;
  try {
    const { url, publishableKey } = getSupabasePublicEnvironment();
    const response = await fetchImpl(`${url}/auth/v1/settings`, {
      cache: "no-store",
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`settings responded ${response.status}`);
    settings = (await response.json()) as SupabaseAuthSettings;
  } catch {
    // Never let a diagnostic take down the page it reports on.
    return {
      state: "unknown",
      signupEnabled: null,
      emailConfirmationRequired: null,
      findings: ["Supabase auth settings could not be read, so sign-up readiness is unknown."],
    };
  }

  const signupEnabled = settings.disable_signup !== true;
  const emailConfirmationRequired = settings.mailer_autoconfirm === false;
  const findings: string[] = [];

  if (!signupEnabled) {
    findings.push(
      "Sign-ups are disabled for this Supabase project, so no account can be created.",
    );
  }

  if (emailConfirmationRequired) {
    findings.push(
      "Every sign-up needs a confirmation email. Unless custom SMTP is configured, "
      + "Supabase's built-in sender allows about two messages an hour for the whole "
      + "project, so one sign-up blocks the next. Configure SMTP or turn off email "
      + "confirmation. See docs/AUTH_RUNBOOK.md.",
    );
  }

  return {
    state: !signupEnabled ? "blocked" : emailConfirmationRequired ? "degraded" : "ready",
    signupEnabled,
    emailConfirmationRequired,
    findings,
  };
}
