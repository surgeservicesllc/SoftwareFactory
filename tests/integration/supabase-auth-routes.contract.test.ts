// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("Supabase authentication route contracts", () => {
  it("configures confirmed email auth, strong passwords, and exact callback origins", () => {
    const config = source("supabase/config.toml");
    expect(config).toMatch(/enable_anonymous_sign_ins\s*=\s*false/);
    expect(config).toMatch(/minimum_password_length\s*=\s*12/);
    expect(config).toMatch(/enable_confirmations\s*=\s*true/);
    expect(config).toContain("https://softwarefactory-tan.vercel.app/auth/callback");
    expect(config).toContain("http://localhost:3000/auth/callback");
    expect(config).not.toMatch(/redirect_urls\s*=\s*\[[\s\S]*?\*/);
  });

  it.each([
    "app/api/auth/sign-in/route.ts",
    "app/api/auth/sign-up/route.ts",
    "app/api/auth/magic-link/route.ts",
    "app/api/auth/resend-confirmation/route.ts",
    "app/api/auth/sign-out/route.ts",
    "app/api/onboarding/route.ts",
    "app/api/organizations/active/route.ts",
  ])("requires exact same-origin checks for %s", (route) => {
    expect(source(route)).toMatch(/assertSameOriginRequest\(request\)/);
  });

  it("verifies callback sessions and normalizes redirect targets", () => {
    const callback = source("app/auth/callback/route.ts");
    expect(callback).toMatch(/exchangeCodeForSession\(code\)/);
    expect(callback).toMatch(/auth\.getUser\(\)/);
    expect(callback).toMatch(/normalizeReturnPath/);
  });

  it("sends magic links out of band without creating accounts or returning tokens", () => {
    const magicLink = source("app/api/auth/magic-link/route.ts");
    expect(magicLink).toMatch(/auth\.signInWithOtp/);
    expect(magicLink).toMatch(/shouldCreateUser:\s*false/);
    expect(magicLink).toMatch(/emailRedirectTo:\s*callbackUrl\.toString\(\)/);
    expect(magicLink).not.toMatch(/(?:access|refresh|id)_token\s*:/i);
  });

  it("routes every auth failure through the shared translation", () => {
    // Guards the regression this replaced: each route hand-rolled its own
    // status mapping, and all of them flattened distinct provider failures
    // into one message that told the person nothing they could act on.
    for (const route of [
      "app/api/auth/sign-in/route.ts",
      "app/api/auth/sign-up/route.ts",
      "app/api/auth/magic-link/route.ts",
      "app/api/auth/resend-confirmation/route.ts",
    ]) {
      expect(source(route)).toMatch(/describeAuthError\(error, "(sign_in|sign_up|magic_link|resend)"\)/);
    }
  });

  it("offers a confirmation resend so an undelivered email is recoverable", () => {
    const resend = source("app/api/auth/resend-confirmation/route.ts");
    expect(resend).toMatch(/auth\.resend/);
    expect(resend).toMatch(/type:\s*"signup"/);
    expect(resend).toMatch(/emailRedirectTo/);
    // The neutral 202 must stay reachable, or this becomes an account oracle.
    expect(resend).toMatch(/accepted:\s*true/);

    const form = source("app/auth/auth-form.tsx");
    expect(form).toMatch(/\/api\/auth\/resend-confirmation/);
    expect(form).toMatch(/Send a new confirmation email/);
  });

  it("uses no service-role credential in application auth boundaries", () => {
    const authSources = [
      "lib/supabase/auth.ts",
      "lib/supabase/browser.ts",
      "lib/supabase/server.ts",
      "lib/supabase/tenant.ts",
      "app/api/onboarding/route.ts",
    ]
      .map(source)
      .join("\n");

    expect(authSources).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(authSources).toMatch(/auth\.getUser\(\)/);
  });

  it("keeps active organization preference HttpOnly and revalidates membership", () => {
    const tenant = source("lib/supabase/tenant.ts");
    expect(tenant).toMatch(/httpOnly:\s*true/);
    expect(tenant).toMatch(/sameSite:\s*"lax"/);
    expect(tenant).toMatch(/listOrganizationMemberships/);
    expect(tenant).toMatch(/chooseActiveOrganization/);
  });
});
