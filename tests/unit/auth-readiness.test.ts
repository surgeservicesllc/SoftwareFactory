// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readAuthReadiness } from "@/lib/supabase/auth-readiness";

/**
 * Sign-up failed in production for a condition nothing in the product
 * reported: confirmation email required, built-in sender, roughly two messages
 * an hour. Visitors saw an error; nobody operating the system saw anything.
 */

function settingsResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth readiness", () => {
  it("flags the exact production condition: confirmation required with no custom sender", async () => {
    const readiness = await readAuthReadiness(
      async () => settingsResponse({ disable_signup: false, mailer_autoconfirm: false }),
    );

    expect(readiness.state).toBe("degraded");
    expect(readiness.emailConfirmationRequired).toBe(true);
    expect(readiness.findings.join(" ")).toMatch(/two messages an hour/i);
    expect(readiness.findings.join(" ")).toMatch(/AUTH_RUNBOOK/);
  });

  it("reports disabled signups as blocked rather than merely slow", async () => {
    const readiness = await readAuthReadiness(
      async () => settingsResponse({ disable_signup: true, mailer_autoconfirm: true }),
    );

    expect(readiness.state).toBe("blocked");
    expect(readiness.findings.join(" ")).toMatch(/no account can be created/i);
  });

  it("says nothing when sign-up is healthy", async () => {
    const readiness = await readAuthReadiness(
      async () => settingsResponse({ disable_signup: false, mailer_autoconfirm: true }),
    );

    expect(readiness.state).toBe("ready");
    expect(readiness.findings).toEqual([]);
  });

  it("never takes down the page it reports on", async () => {
    for (const failing of [
      async () => { throw new Error("network down"); },
      async () => settingsResponse({}, 500),
    ]) {
      const readiness = await readAuthReadiness(failing as typeof fetch);
      expect(readiness.state).toBe("unknown");
      // Unknown is not a pass: it still says so rather than implying health.
      expect(readiness.findings.join(" ")).toMatch(/unknown/i);
    }
  });
});
