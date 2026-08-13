// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authErrorBody, describeAuthError } from "@/lib/supabase/auth-errors";

describe("Supabase auth error translation", () => {
  it("separates an unconfirmed address from a rejected password", () => {
    // The defect this guards: `email_not_confirmed` was reported as
    // "invalid_credentials", which tells someone their correct password is
    // wrong and leaves the account permanently unreachable.
    const unconfirmed = describeAuthError(
      { code: "email_not_confirmed", status: 400 },
      "sign_in",
    );
    expect(unconfirmed.code).toBe("email_not_confirmed");
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.canResend).toBe(true);

    const wrongPassword = describeAuthError(
      { code: "invalid_credentials", status: 400 },
      "sign_in",
    );
    expect(wrongPassword.code).toBe("invalid_credentials");
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.canResend).toBe(false);
  });

  it("names the reason a sign-up was refused instead of one opaque failure", () => {
    expect(
      describeAuthError({ code: "email_address_invalid", status: 400 }, "sign_up").code,
    ).toBe("email_address_invalid");
    expect(describeAuthError({ code: "weak_password", status: 422 }, "sign_up").code).toBe(
      "weak_password",
    );
    expect(describeAuthError({ code: "signup_disabled", status: 403 }, "sign_up").code).toBe(
      "signup_disabled",
    );
  });

  it("marks configuration failures as the owner's to fix, not the caller's", () => {
    for (const code of [
      "signup_disabled",
      "email_provider_disabled",
      "over_email_send_rate_limit",
    ]) {
      expect(describeAuthError({ code, status: 400 }, "sign_up").ownerActionRequired).toBe(
        true,
      );
    }

    expect(
      describeAuthError({ code: "invalid_credentials", status: 400 }, "sign_in")
        .ownerActionRequired,
    ).toBe(false);
  });

  it("recognizes an undeliverable confirmation email behind a generic failure", () => {
    // Supabase reports this as `unexpected_failure`; only the message
    // distinguishes it, and it is the failure that silently breaks sign-up.
    const outcome = describeAuthError(
      {
        code: "unexpected_failure",
        status: 500,
        message: "Error sending confirmation email",
      },
      "sign_up",
    );

    expect(outcome.code).toBe("email_delivery_failed");
    expect(outcome.ownerActionRequired).toBe(true);
    expect(outcome.canResend).toBe(true);
  });

  it("never lets a magic link reveal whether an address is registered", () => {
    const magicLink = describeAuthError({ code: "user_not_found", status: 400 }, "magic_link");
    expect(magicLink.code).not.toContain("not_found");
    expect(magicLink.message).not.toMatch(/no account|not registered|does not exist/i);

    // The same code is answerable once the caller is resending to themselves.
    expect(describeAuthError({ code: "user_not_found", status: 400 }, "resend").code).toBe(
      "nothing_to_confirm",
    );
  });

  it("treats a throttled or absent provider as unavailable, not as a bad password", () => {
    expect(describeAuthError({ status: 429 }, "sign_in").status).toBe(429);
    expect(describeAuthError({ status: 500 }, "sign_in").code).toBe(
      "authentication_unavailable",
    );
    expect(describeAuthError(null, "sign_in").code).toBe("authentication_unavailable");
  });

  it("never echoes provider text back to the browser", () => {
    const leaky = describeAuthError(
      { code: "unexpected_failure", status: 400, message: "db error: role xyz missing" },
      "sign_in",
    );

    expect(leaky.message).not.toContain("db error");
    expect(leaky.message).not.toContain("xyz");
  });

  it("carries the resend and owner hints into the response body", () => {
    const body = authErrorBody(
      describeAuthError({ code: "email_not_confirmed", status: 400 }, "sign_in"),
    );

    expect(body.error.canResend).toBe(true);
    expect(body.error.ownerActionRequired).toBe(false);
    expect(body.error.code).toBe("email_not_confirmed");
  });
});
