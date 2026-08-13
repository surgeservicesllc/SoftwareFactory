import "server-only";

/**
 * Supabase Auth failures, translated into outcomes a person can act on.
 *
 * Every auth route previously collapsed each provider failure into a single
 * opaque sentence. That hid the two failures that actually stop people from
 * using the product: an unconfirmed email address (reported as "the email
 * address or password was not accepted", which sends people to reset a
 * password that was always correct) and a confirmation email that the project
 * could not deliver at all.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. Provider error text is never echoed. Messages here are fixed strings,
 *      so a provider cannot dictate what the browser renders.
 *   2. Nothing distinguishes "this address has an account" from "this address
 *      does not" unless the caller has already proven control of the address
 *      by supplying its password.
 */

/** Which call produced the failure. The same code can mean different things. */
export type AuthErrorContext = "sign_in" | "sign_up" | "magic_link" | "resend";

export type AuthErrorOutcome = {
  readonly status: 400 | 401 | 403 | 409 | 429 | 503;
  readonly code: string;
  readonly message: string;
  /** The caller's useful next step is to ask for another email. */
  readonly canResend: boolean;
  /**
   * Only a Supabase project owner can clear this. The condition is project
   * configuration, not anything the person at the keyboard typed.
   */
  readonly ownerActionRequired: boolean;
};

type ProviderError = { code?: string; status?: number; message?: string } | null;

const RATE_LIMITED: AuthErrorOutcome = {
  status: 429,
  code: "authentication_rate_limited",
  message: "Too many attempts. Wait a few minutes and try again.",
  canResend: false,
  ownerActionRequired: false,
};

const UNAVAILABLE: AuthErrorOutcome = {
  status: 503,
  code: "authentication_unavailable",
  message: "Authentication is temporarily unavailable. Try again shortly.",
  canResend: false,
  ownerActionRequired: false,
};

/**
 * Supabase reports a failed confirmation-email send as a generic
 * `unexpected_failure`, so the code alone cannot identify it. The message is
 * matched narrowly and is never shown to the caller — it only selects which
 * fixed message this module returns.
 */
function isEmailDeliveryFailure(error: ProviderError): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("email") && /send|deliver|smtp/.test(message);
}

const EMAIL_DELIVERY_FAILED: AuthErrorOutcome = {
  status: 503,
  code: "email_delivery_failed",
  message:
    "The confirmation email could not be sent, so the account is not usable yet. This is a mail configuration problem in the workspace, not a problem with what you entered.",
  canResend: true,
  ownerActionRequired: true,
};

/**
 * Translate a Supabase Auth error into a response outcome.
 *
 * `context` decides how an ambiguous code is read: `user_not_found` is a real
 * answer when resending a confirmation, but returning it for a magic link
 * would turn that endpoint into an account-existence oracle.
 */
export function describeAuthError(
  error: ProviderError,
  context: AuthErrorContext,
): AuthErrorOutcome {
  if (error?.status === 429) return RATE_LIMITED;

  switch (error?.code) {
    case "email_not_confirmed":
      return {
        status: 403,
        code: "email_not_confirmed",
        message:
          "This account still needs its email address confirmed. Your password was accepted — check your inbox for the confirmation link, or send a new one.",
        canResend: true,
        ownerActionRequired: false,
      };

    case "invalid_credentials":
      return {
        status: 401,
        code: "invalid_credentials",
        message: "The email address or password was not accepted.",
        canResend: false,
        ownerActionRequired: false,
      };

    case "user_banned":
      return {
        status: 403,
        code: "account_suspended",
        message: "This account is suspended. Contact the workspace owner.",
        canResend: false,
        ownerActionRequired: true,
      };

    case "user_already_exists":
    case "email_exists":
      return {
        status: 409,
        code: "email_unavailable",
        message:
          "That email address cannot be used to create a new account. If it is yours, sign in instead or request a sign-in link.",
        canResend: false,
        ownerActionRequired: false,
      };

    case "email_address_invalid":
      return {
        status: 400,
        code: "email_address_invalid",
        message:
          "That email address was rejected as undeliverable. Placeholder domains such as example.com are not accepted — use a real address you can receive mail at.",
        canResend: false,
        ownerActionRequired: false,
      };

    case "weak_password":
      return {
        status: 400,
        code: "weak_password",
        message:
          "That password was rejected. Use at least 12 characters with a mix of letters and numbers, and avoid a password you have used elsewhere.",
        canResend: false,
        ownerActionRequired: false,
      };

    case "signup_disabled":
      return {
        status: 403,
        code: "signup_disabled",
        message:
          "Account creation is switched off for this workspace. A Supabase project owner must re-enable sign-ups.",
        canResend: false,
        ownerActionRequired: true,
      };

    case "email_provider_disabled":
      return {
        status: 503,
        code: "email_provider_disabled",
        message:
          "Email sign-in is switched off for this workspace. A Supabase project owner must re-enable the email provider.",
        canResend: false,
        ownerActionRequired: true,
      };

    case "over_email_send_rate_limit":
      return {
        status: 429,
        code: "email_rate_limited",
        message:
          "This workspace has hit its limit for outgoing email. Supabase's built-in mail service allows only a few messages per hour; wait, or ask an owner to configure a real SMTP provider.",
        canResend: false,
        ownerActionRequired: true,
      };

    case "over_request_rate_limit":
      return RATE_LIMITED;

    case "validation_failed":
      return {
        status: 400,
        code: "invalid_request",
        message: "Check the details you entered and try again.",
        canResend: false,
        ownerActionRequired: false,
      };

    case "user_not_found":
      // Only meaningful where the caller is already resending to themselves.
      return context === "resend"
        ? {
            status: 400,
            code: "nothing_to_confirm",
            message:
              "There is no account awaiting confirmation for that address. Create an account first.",
            canResend: false,
            ownerActionRequired: false,
          }
        : UNAVAILABLE;

    default:
      break;
  }

  if (isEmailDeliveryFailure(error)) return EMAIL_DELIVERY_FAILED;

  // No status, or a provider-side fault: this is not the caller's error.
  if (!error?.status || error.status >= 500) return UNAVAILABLE;

  switch (context) {
    case "sign_in":
      return {
        status: 401,
        code: "invalid_credentials",
        message: "The email address or password was not accepted.",
        canResend: false,
        ownerActionRequired: false,
      };
    case "sign_up":
      return {
        status: 400,
        code: "sign_up_failed",
        message:
          "The account could not be created. Check the email address and password and try again.",
        canResend: false,
        ownerActionRequired: false,
      };
    default:
      return {
        status: 400,
        code: "email_send_failed",
        message: "That email could not be sent. Try again shortly.",
        canResend: false,
        ownerActionRequired: false,
      };
  }
}

/** Shape an outcome as the error body every auth route returns. */
export function authErrorBody(outcome: AuthErrorOutcome) {
  return {
    error: {
      code: outcome.code,
      message: outcome.message,
      canResend: outcome.canResend,
      ownerActionRequired: outcome.ownerActionRequired,
    },
  };
}
