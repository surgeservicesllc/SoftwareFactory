// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { describeAuthFailure } from "@/lib/supabase/auth";

/**
 * Account creation broke in production and the response said only "The account
 * could not be created." Every distinct cause -- an unusable address, a
 * rejected password, disabled signups, an undeliverable confirmation email --
 * arrived as that one sentence, so nobody could tell whether to fix their
 * input, wait, or stop trying.
 *
 * These assert that each cause stays distinguishable, and that the two
 * enumeration-sensitive cases stay safe.
 */

const fallback = {
  status: 400,
  code: "sign_up_failed",
  message: "The account could not be created.",
} as const;

describe("auth failure messages", () => {
  it("reports an undeliverable confirmation email as a send problem, not a credential problem", () => {
    // This is the live production failure: the project's email quota is spent,
    // so the confirmation link never goes out. Telling someone their details
    // were wrong sends them into a retry loop that cannot succeed.
    const failure = describeAuthFailure(
      { status: 429, code: "over_email_send_rate_limit" },
      fallback,
    );

    expect(failure.status).toBe(429);
    expect(failure.code).toBe("email_send_rate_limited");
    expect(failure.message).toMatch(/confirmation email could not go out/i);
  });

  it("offers a recovery path when the account exists but was never confirmed", () => {
    const failure = describeAuthFailure(
      { status: 400, code: "email_not_confirmed" },
      { status: 401, code: "invalid_credentials", message: "Not accepted." },
    );

    expect(failure.needsConfirmation).toBe(true);
    expect(failure.message).toMatch(/resend/i);
    // Never report an unconfirmed account as a bad password: the password is
    // correct, and "wrong password" leaves the visitor with nothing to try.
    expect(failure.message).not.toMatch(/password/i);
  });

  it("keeps each actionable cause distinguishable", () => {
    expect(describeAuthFailure({ status: 400, code: "email_address_invalid" }, fallback).code)
      .toBe("email_address_invalid");
    expect(describeAuthFailure({ status: 422, code: "signup_disabled" }, fallback))
      .toMatchObject({ status: 403, code: "signup_disabled" });

    const weak = describeAuthFailure(
      { status: 422, code: "weak_password", message: "Password is too short." },
      fallback,
    );
    // Supabase states the actual policy; repeating it beats a generic guess.
    expect(weak.message).toBe("Password is too short.");
  });

  it("never confirms during sign-up that an address is already registered", () => {
    for (const code of ["email_exists", "user_already_exists"]) {
      const failure = describeAuthFailure({ status: 422, code }, fallback);
      expect(failure.message).not.toMatch(/already|exists|registered|taken/i);
      expect(failure.message).toMatch(/signing in/i);
    }
  });

  it("separates provider outages from caller mistakes", () => {
    expect(describeAuthFailure({ status: 500 }, fallback)).toMatchObject({
      status: 503,
      code: "authentication_unavailable",
    });
    // No status at all means the provider was unreachable, not a bad password.
    expect(describeAuthFailure({}, fallback).status).toBe(503);
  });

  it("falls back to the caller's own wording for an unrecognised failure", () => {
    expect(describeAuthFailure({ status: 400, code: "something_new" }, fallback))
      .toMatchObject(fallback);
  });
});

describe("marketing call-to-action routing", () => {
  it("maps a stale /sign-in content row forward to sign-up", async () => {
    const { normalizeCtaHref } = await import("@/lib/marketing/queries");

    // The hosted pricing plans still carry these, and they cannot be edited
    // from the application, so "Start Free Trial" would otherwise open the
    // sign-in page for someone who has no account.
    expect(normalizeCtaHref("/sign-in")).toBe("/auth/sign-up");
    expect(normalizeCtaHref("/sign-in?next=/solutions")).toBe("/auth/sign-up");
    expect(normalizeCtaHref("  ")).toBe("/auth/sign-up");

    // Anything else is left exactly as the content author wrote it.
    expect(normalizeCtaHref("/about")).toBe("/about");
    expect(normalizeCtaHref("/auth/sign-up")).toBe("/auth/sign-up");
  });
});
