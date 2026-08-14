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

  it("states the password rule the server actually enforces", () => {
    // The server requires a letter and a number; the hint promised only length,
    // so a valid-looking 12-character password could be rejected with no clue.
    const signUpRoute = source("app/api/auth/sign-up/route.ts");
    expect(signUpRoute).toMatch(/regex\(\/\[A-Za-z\]\/\)/);
    expect(signUpRoute).toMatch(/regex\(\/\[0-9\]\/\)/);
    expect(source("app/auth/auth-form.tsx")).toMatch(/letter and a number/i);
  });
});
