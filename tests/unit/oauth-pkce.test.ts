// @vitest-environment node

import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  buildAuthorizeUrl, createPkceChallenge, exchangeCodeForKey, stateMatches,
} = await import("@/lib/bots/oauth-pkce");

/**
 * The one-click sign-in.
 *
 * PKCE exists because the authorization code travels through a browser
 * redirect, where it can be observed. These assert the two properties that make
 * observing it useless: the verifier never leaves the server, and only its hash
 * is sent to the provider.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the challenge", () => {
  it("sends a hash, never the verifier", () => {
    const challenge = createPkceChallenge();

    expect(challenge.challenge).toBe(
      createHash("sha256").update(challenge.verifier).digest("base64url"),
    );
    // The redirect is observable. If it carried the verifier, PKCE would be
    // decoration.
    expect(challenge.challenge).not.toBe(challenge.verifier);
  });

  it("is unguessable and never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const challenge = createPkceChallenge();
      seen.add(challenge.verifier);
      seen.add(challenge.state);
      expect(challenge.verifier.length).toBeGreaterThanOrEqual(40);
      expect(challenge.state.length).toBeGreaterThanOrEqual(40);
    }
    expect(seen.size).toBe(400);
  });

  it("puts only the hash and the state in the authorize URL", () => {
    const challenge = createPkceChallenge();
    const url = new URL(buildAuthorizeUrl(challenge, "https://factory.test/cb"));

    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.searchParams.get("code_challenge")).toBe(challenge.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(challenge.state);
    expect(url.searchParams.get("callback_url")).toBe("https://factory.test/cb");
    expect(url.toString()).not.toContain(challenge.verifier);
  });
});

describe("state comparison", () => {
  it("accepts only an exact match", () => {
    const challenge = createPkceChallenge();

    expect(stateMatches(challenge.state, challenge.state)).toBe(true);
    expect(stateMatches(challenge.state, createPkceChallenge().state)).toBe(false);
    expect(stateMatches(challenge.state, `${challenge.state}x`)).toBe(false);
  });

  it("refuses an empty state rather than matching one", () => {
    // Without this, a callback that omitted the parameter entirely would match
    // a cookie that had also lost it.
    expect(stateMatches("", "")).toBe(false);
  });
});

describe("exchanging the code", () => {
  function stubFetch(handler: (init?: RequestInit) => unknown) {
    const mock = vi.fn(async (_url: string, init?: RequestInit) => handler(init));
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("sends the verifier and returns the key", async () => {
    const mock = stubFetch(() => ({
      ok: true, status: 200, json: async () => ({ key: "sk-or-v1-issued-key" }),
    }));

    const result = await exchangeCodeForKey("auth-code", "the-verifier");

    expect(result).toEqual({ ok: true, key: "sk-or-v1-issued-key" });
    const body = JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({
      code: "auth-code", code_verifier: "the-verifier", code_challenge_method: "S256",
    });
  });

  it("refuses a response with no usable key", async () => {
    stubFetch(() => ({ ok: true, status: 200, json: async () => ({ key: "" }) }));
    expect((await exchangeCodeForKey("c", "v")).ok).toBe(false);

    stubFetch(() => ({ ok: true, status: 200, json: async () => ({}) }));
    expect((await exchangeCodeForKey("c", "v")).ok).toBe(false);
  });

  it("never surfaces the provider's error body", async () => {
    // An error body can echo the code back, and this reason is rendered.
    stubFetch(() => ({
      ok: false, status: 400,
      json: async () => ({ error: "bad code auth-code-secret" }),
    }));

    const result = await exchangeCodeForKey("auth-code-secret", "v");

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("auth-code-secret");
  });

  it("treats a network failure and a timeout as a refusal, never a success", async () => {
    stubFetch(() => { throw new Error("ECONNREFUSED"); });
    expect((await exchangeCodeForKey("c", "v")).ok).toBe(false);

    stubFetch(() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    const timedOut = await exchangeCodeForKey("c", "v");
    expect(timedOut.ok).toBe(false);
    expect(timedOut.ok === false && timedOut.reason).toMatch(/did not respond in time/i);
  });

  it("never throws, whatever the provider returns", async () => {
    stubFetch(() => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));

    await expect(exchangeCodeForKey("c", "v")).resolves.toMatchObject({ ok: false });
  });
});
