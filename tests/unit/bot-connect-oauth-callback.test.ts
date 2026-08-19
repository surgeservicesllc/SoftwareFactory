// @vitest-environment node

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const cookieStore = {
  get: vi.fn(),
  delete: vi.fn(),
  set: vi.fn(),
};
const rpc = vi.fn();

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc }),
}));

const { GET: callback } = await import("@/app/api/bots/connect/oauth/callback/route");
const { GET: googleCallback } = await import("@/app/api/bots/connect/google/callback/route");
const { readPendingSignIn } = await import("@/lib/bots/oauth-pkce");

/**
 * The OAuth callback's failure paths.
 *
 * Every one of them has to end in a redirect carrying an outcome code, and
 * every one has to clear the cookie. A verifier that outlives its round trip is
 * a credential waiting to be replayed, and a cookie that cannot be parsed but
 * is never cleared makes the next attempt fail exactly the same way.
 */

const organizationId = "11111111-2222-4333-8444-555555555555";
const origin = "https://factory.test";

function callbackRequest(params: Record<string, string>) {
  const url = new URL(`${origin}/api/bots/connect/oauth/callback`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url, { method: "GET" });
}

function outcomeOf(response: Response): string {
  return new URL(response.headers.get("location") ?? "").searchParams.get("connect") ?? "";
}

beforeEach(() => {
  vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  cookieStore.get.mockReset();
  cookieStore.delete.mockReset();
  rpc.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("a cookie that parses but is not a pending sign-in", () => {
  // Valid JSON is not a valid cookie. Each of these reached `stateMatches`,
  // which throws on a non-string rather than returning false -- so the route
  // answered 500 instead of an outcome, and threw before clearing, leaving the
  // bad cookie to fail the same way on every retry until its TTL ran out.
  const shapes: Record<string, string> = {
    "an empty object": "{}",
    "a missing state": JSON.stringify({ verifier: "v", organizationId }),
    "a missing verifier": JSON.stringify({ state: "s", organizationId }),
    "a missing organization": JSON.stringify({ verifier: "v", state: "s" }),
    "a null": "null",
    "an array": "[]",
    "a non-string state": JSON.stringify({ verifier: "v", state: 7, organizationId }),
    "an empty-string state": JSON.stringify({ verifier: "v", state: "", organizationId }),
  };

  for (const [name, raw] of Object.entries(shapes)) {
    it(`answers "invalid" and clears the cookie for ${name}`, async () => {
      cookieStore.get.mockReturnValue({ value: raw });

      const response = await callback(callbackRequest({ code: "c", state: "s" }));

      expect(response.status).toBe(302);
      expect(outcomeOf(response)).toBe("invalid");
      // Clearing is the half that makes the next attempt able to succeed.
      expect(cookieStore.delete).toHaveBeenCalled();
      // Nothing may reach the database on a cookie that was never valid.
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it("still answers \"invalid\" for a cookie that is not JSON at all", async () => {
    cookieStore.get.mockReturnValue({ value: "not json" });

    const response = await callback(callbackRequest({ code: "c", state: "s" }));

    expect(outcomeOf(response)).toBe("invalid");
    expect(cookieStore.delete).toHaveBeenCalled();
  });
});

describe("the checks that make the code worth anything", () => {
  const pending = JSON.stringify({ verifier: "verifier-value", state: "state-value", organizationId });

  it("answers \"expired\" when there is no cookie, without touching the database", async () => {
    cookieStore.get.mockReturnValue(undefined);

    const response = await callback(callbackRequest({ code: "c", state: "state-value" }));

    expect(outcomeOf(response)).toBe("expired");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a state that does not match the cookie", async () => {
    cookieStore.get.mockReturnValue({ value: pending });

    // A forged callback carrying an attacker's code would otherwise attach
    // their credential to this workspace.
    const response = await callback(callbackRequest({ code: "c", state: "someone-elses-state" }));

    expect(outcomeOf(response)).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a callback with no code", async () => {
    cookieStore.get.mockReturnValue({ value: pending });

    const response = await callback(callbackRequest({ state: "state-value" }));

    expect(outcomeOf(response)).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the shared pending-sign-in reader", () => {
  const valid = { verifier: "v", state: "s", organizationId };

  it("accepts a complete record and freezes it", () => {
    const pending = readPendingSignIn(JSON.stringify(valid));
    expect(pending).toEqual(valid);
    expect(Object.isFrozen(pending)).toBe(true);
  });

  it("rejects every shape that parses but is not a pending sign-in", () => {
    for (const raw of [
      "{}", "null", "[]", "\"a string\"", "7", "not json",
      JSON.stringify({ verifier: "v", state: "s" }),
      JSON.stringify({ verifier: "v", state: 7, organizationId }),
      JSON.stringify({ verifier: "", state: "s", organizationId }),
    ]) {
      expect(readPendingSignIn(raw), `expected ${raw} to be rejected`).toBeNull();
    }
  });

  it("returns null rather than throwing, so the caller can clear the cookie", () => {
    // Throwing here is what made the route answer 500 before it could clear.
    expect(() => readPendingSignIn("{}")).not.toThrow();
  });
});

describe("the Google callback uses the same reader", () => {
  it("answers \"invalid\" and clears for a cookie that parses but is empty", async () => {
    cookieStore.get.mockReturnValue({ value: "{}" });

    const url = new URL(`${origin}/api/bots/connect/google/callback`);
    url.searchParams.set("code", "c");
    url.searchParams.set("state", "s");
    const response = await googleCallback(new Request(url, { method: "GET" }));

    expect(outcomeOf(response)).toBe("invalid");
    expect(cookieStore.delete).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
