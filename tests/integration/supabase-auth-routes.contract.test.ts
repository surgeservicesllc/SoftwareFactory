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

    // Supabase builds confirmation links from site_url and falls back to it
    // whenever an emailRedirectTo is not allowlisted. Pointing either at a
    // preview host sends production visitors to an origin where their session
    // cookie cannot apply, which is how sign-up broke in production.
    expect(config).toMatch(/site_url\s*=\s*"https:\/\/www\.theagoras\.com"/);
    expect(config).toContain("https://www.theagoras.com/auth/callback");
    expect(config).toContain("https://theagoras.com/auth/callback");
  });

  it.each([
    "app/api/auth/sign-in/route.ts",
    "app/api/auth/sign-up/route.ts",
    "app/api/auth/magic-link/route.ts",
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
