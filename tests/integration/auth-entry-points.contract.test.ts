// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

/**
 * The way in has to lead to account creation.
 *
 * "Get Started Free" -- the primary call to action on every marketing page --
 * pointed at /sign-in, so a visitor with no account landed on a page headed
 * "Sign in / Welcome back to SoftwareFactory" with sign-up reachable only
 * through a small link at the bottom. Signing in then returned them to the
 * public home page rather than the console. Both are asserted here because
 * both are one-character regressions.
 */
describe("authentication entry points", () => {
  const header = source("components/marketing/site-header.tsx");

  it("sends the primary call to action to sign-up, not sign-in", () => {
    expect(header).toContain('href="/auth/sign-up"');

    const getStarted = header.slice(0, header.indexOf("Get Started Free"));
    const nearestHref = getStarted.lastIndexOf("href=");
    expect(getStarted.slice(nearestHref, nearestHref + 40)).toContain("/auth/sign-up");
  });

  it("keeps a separate sign-in entry that returns to the console", () => {
    expect(header).toContain('href="/auth/sign-in?next=/solutions"');
  });

  it("routes every account-creation call to action to sign-up", () => {
    // Fixing the header alone was not enough: the homepage hero, the closing
    // band, the platform page and all three pricing plans each carried their
    // own "Get Started Free" pointing at /sign-in.
    const surfaces = [
      "app/(marketing)/page.tsx",
      "app/(marketing)/platform/page.tsx",
      "components/marketing/site-header.tsx",
      "components/marketing/site-footer.tsx",
      "lib/marketing/content.ts",
      "lib/marketing/queries.ts",
    ];

    for (const surface of surfaces) {
      const body = source(surface);
      // Match links and call-to-action values, not every mention of the path:
      // normalizeCtaHref has to name the legacy value in order to map it away.
      // /sign-in only redirects to /auth/sign-in, so a call to action aimed
      // there sends a visitor without an account to the wrong page.
      expect(body, `${surface} still links to the legacy /sign-in redirect`)
        .not.toMatch(/(?:href|primaryHref|secondaryHref|ctaHref)\s*[:=]\s*["'`{]*\s*["'`]\/sign-in/);
    }
  });

  it("lands a signed-in caller in the console rather than the marketing home page", () => {
    expect(source("app/api/auth/sign-in/route.ts"))
      .toContain('normalizeReturnPath(parsed.data.returnTo, "/solutions")');
    expect(source("app/auth/sign-in/page.tsx")).toContain('"/solutions"');
    expect(source("app/auth/sign-in/page.tsx")).not.toMatch(
      /normalizeReturnPath\(query\.next, "\/"\)/,
    );
  });

  it("gives an unconfirmed account a way back in", () => {
    // Sign-up refuses to remake the account and sign-in refuses to admit it,
    // so without a resend route that visitor has no path at all.
    const resend = source("app/api/auth/resend-confirmation/route.ts");
    expect(resend).toContain('type: "signup"');
    expect(resend).toContain("assertSameOriginRequest");
    // Enumeration-safe: identical response whether or not the account exists.
    expect(resend).toMatch(/If that address needs confirming/);

    const form = source("app/auth/auth-form.tsx");
    expect(form).toContain("/api/auth/resend-confirmation");
    expect(form).toContain("Resend the confirmation email");
  });

  it("never appends a query string to an emailed callback URL", () => {
    // Supabase matches emailRedirectTo against a bare /auth/callback entry and
    // silently falls back to Site URL on a miss. A query string here made the
    // confirmation link resolve to the site root carrying a ?code= the
    // marketing page ignores: the address was confirmed and nobody was signed
    // in. Verified end to end in tests/e2e/auth-lifecycle.spec.ts.
    for (const route of [
      "app/api/auth/sign-up/route.ts",
      "app/api/auth/resend-confirmation/route.ts",
      "app/api/auth/magic-link/route.ts",
    ]) {
      expect(source(route), `${route} puts a query string on the callback URL`)
        .not.toMatch(/callbackUrl\.searchParams\.set/);
    }

    // Widening the allowlist with a wildcard would fix the match and open a
    // redirect hole, so the destination travels in a cookie instead.
    expect(source("app/api/auth/magic-link/route.ts")).toContain("rememberAuthReturnPath");
    expect(source("app/auth/callback/route.ts")).toContain("takeAuthReturnPath");
  });

  it("states the password rule the server actually enforces", () => {
    // The server requires a letter and a number; the hint promised only length,
    // so a valid-looking 12-character password could be rejected with no clue.
    const signUpRoute = source("app/api/auth/sign-up/route.ts");
    expect(signUpRoute).toMatch(/regex\(\/\[A-Za-z\]\/\)/);
    expect(signUpRoute).toMatch(/regex\(\/\[0-9\]\/\)/);
    expect(source("app/auth/auth-form.tsx")).toMatch(/letter and a number/i);
  });
});
