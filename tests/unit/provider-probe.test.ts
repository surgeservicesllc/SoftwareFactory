// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { probeProviderCredential, isUsable } = await import("@/lib/bots/provider-probe");

/**
 * The probe exists to close the gap that bit Phase 1C: a key that is present,
 * valid, and attached to an account with no credit reads as "configured" and
 * fails on the first real turn.
 *
 * So the interesting assertions are the ones that separate failures which look
 * alike from the outside — rejected, out of credit, throttled, unreachable —
 * because each has a different fix and a badge that merges them is no better
 * than the presence check it replaced.
 */

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function response(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-secret-value-123");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("verdicts", () => {
  it("verifies a key the provider accepts", async () => {
    stubFetch(() => response(200, { data: [] }));

    const result = await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY");

    expect(result).toMatchObject({ verdict: "verified", live: true });
    expect(isUsable(result)).toBe(true);
  });

  it("separates a rejected key from an account with no credit", async () => {
    stubFetch(() => response(401, { error: { type: "authentication_error" } }));
    expect((await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY")).verdict)
      .toBe("rejected");

    // The Phase 1C failure: the key is fine, the balance is not. Merging this
    // into "rejected" would send someone to reissue a working key.
    stubFetch(() => response(402, {}));
    expect((await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY")).verdict)
      .toBe("no_credit");
  });

  it("reads an out-of-credit code that arrives with a 429", async () => {
    // OpenAI reports exhausted quota as 429 + insufficient_quota, which is
    // otherwise indistinguishable from ordinary throttling.
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-secret");
    stubFetch(() => response(429, { error: { code: "insufficient_quota" } }));

    expect((await probeProviderCredential("openai", "OPENAI_API_KEY")).verdict)
      .toBe("no_credit");
  });

  it("treats a plain 429 as transient throttling, not a bad key", async () => {
    stubFetch(() => response(429, { error: { code: "rate_limit_exceeded" } }));

    const result = await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY");
    expect(result.verdict).toBe("rate_limited");
    // Telling someone to replace a key because the provider was busy is worse
    // than saying nothing.
    expect(isUsable(result)).toBe(false);
  });

  it("treats a provider-side error as unreachable rather than as a key problem", async () => {
    stubFetch(() => response(503, {}));
    expect((await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY")).verdict)
      .toBe("unreachable");
  });

  it("treats a network failure and a timeout as unreachable, not verified", async () => {
    stubFetch(() => { throw new Error("ECONNREFUSED"); });
    const failed = await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY");
    expect(failed).toMatchObject({ verdict: "unreachable", live: false });

    stubFetch(() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    const timedOut = await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY");
    expect(timedOut.verdict).toBe("unreachable");
    expect(timedOut.reason).toMatch(/did not respond in time/i);
  });

  it("never throws, whatever the provider does", async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => { throw new Error("bad json"); } }));

    await expect(probeProviderCredential("anthropic", "ANTHROPIC_API_KEY")).resolves.toBeDefined();
  });
});

describe("what it does not attempt", () => {
  it("reports an unset key as not configured without calling out", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const mock = stubFetch(() => response(200));

    const result = await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY");

    // Probing an absent key is a guaranteed 401 that would read as "your key
    // is bad" when the truth is "you have not set one".
    expect(result).toMatchObject({ verdict: "not_configured", live: false });
    expect(mock).not.toHaveBeenCalled();
  });

  it("does not guess an endpoint for an operator-defined provider", async () => {
    vi.stubEnv("BOT_CREDENTIAL_CUSTOM", "value");
    const mock = stubFetch(() => response(200));

    const result = await probeProviderCredential("custom", "BOT_CREDENTIAL_CUSTOM");

    expect(result.verdict).toBe("not_probed");
    expect(mock).not.toHaveBeenCalled();
  });

  it("never performs a completion, only a model list", async () => {
    const mock = stubFetch(() => response(200, { data: [] }));

    await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY");

    const [url, init] = mock.mock.calls[0];
    // A completion would cost money per check and could be turned into spend
    // by refreshing the page.
    expect(String(url)).toContain("/models");
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("uses an authenticated endpoint for OpenRouter, whose model list is public", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-secret");
    const mock = stubFetch(() => response(200, {}));

    await probeProviderCredential("openrouter", "OPENROUTER_API_KEY");

    // `/models` is served without a credential there, so every key — including
    // a wrong one — would verify.
    expect(String(mock.mock.calls[0][0])).toContain("/key");
  });
});

describe("the credential never escapes", () => {
  it("sends the key in the header the provider expects and nowhere else", async () => {
    const mock = stubFetch(() => response(200, { data: [] }));

    await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY");

    const init = mock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-secret-value-123");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    // Anthropic uses x-api-key; a stray bearer copy would be a second place to
    // leak from.
    expect(headers.Authorization).toBeUndefined();
    expect(String(mock.mock.calls[0][0])).not.toContain("sk-ant");
  });

  it("keeps the key out of every returned field, including on failure", async () => {
    for (const status of [200, 401, 402, 429, 500]) {
      stubFetch(() => response(status, { error: { message: "key sk-ant-secret-value-123 bad" } }));
      const result = await probeProviderCredential("anthropic", "ANTHROPIC_API_KEY");

      // The provider's own message can echo the key back, so it is never
      // surfaced — only a machine-readable code is read from the body.
      expect(JSON.stringify(result)).not.toContain("sk-ant-secret-value-123");
      expect(JSON.stringify(result)).not.toContain("key sk-ant");
    }
  });

  it("keeps a query-parameter key out of the result even though it rides in the URL", async () => {
    // Gemini is the only provider that takes the key as a URL parameter, which
    // makes the URL itself sensitive.
    vi.stubEnv("GEMINI_API_KEY", "gemini-secret-value");
    const mock = stubFetch(() => { throw new Error("connect failed"); });

    const result = await probeProviderCredential("google", "GEMINI_API_KEY");

    expect(String(mock.mock.calls[0][0])).toContain("gemini-secret-value");
    expect(JSON.stringify(result)).not.toContain("gemini-secret-value");
  });
});
