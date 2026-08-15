// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ClaudeAuthError,
  claudeRedactionSecrets,
  describeClaudeAuth,
  looksLikeAnthropicApiKey,
  resolveClaudeAuth,
  tryResolveClaudeAuth,
} from "@/lib/providers/claude-auth";

/**
 * These tests are about one property: **the billed path cannot be reached by
 * accident.** Everything else here is in service of that.
 *
 * The environment is passed in rather than read from `process.env`, so each case
 * states exactly the configuration it is describing and nothing leaks between
 * them.
 */

const OAUTH_TOKEN = "sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const API_KEY = "sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function expectFailure(environment: Record<string, string | undefined>, code: string) {
  try {
    resolveClaudeAuth(environment);
    throw new Error(`Expected ${code} but resolution succeeded.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeAuthError);
    expect((error as ClaudeAuthError).code).toBe(code);
    return error as ClaudeAuthError;
  }
}

describe("choosing a mode", () => {
  it("defaults to subscription rather than to whatever credential is present", () => {
    const resolution = resolveClaudeAuth({
      SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
    });

    expect(resolution.mode).toBe("subscription");
    expect(resolution.zeroToken).toBe(true);
    expect(resolution.apiKey).toBeNull();
  });

  it("fails closed when nothing is configured, instead of falling back to an API key", () => {
    const failure = expectFailure({}, "SUBSCRIPTION_CREDENTIAL_MISSING");

    // The reason has to be actionable: someone reading it in a log should know
    // the command to run, not merely that something is missing.
    expect(failure.message).toContain("claude setup-token");
  });

  it("treats an API key present without the opt-in as a configuration error", () => {
    // This is the case the whole module exists for. A key left in the
    // environment from an earlier setup must not quietly resume spending.
    const failure = expectFailure(
      { SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN, ANTHROPIC_API_KEY: API_KEY },
      "API_KEY_MODE_NOT_ENABLED",
    );

    expect(failure.message).toContain("never chosen");
  });

  it("uses the API key only when the owner named that mode", () => {
    const resolution = resolveClaudeAuth({
      SOFTWAREFACTORY_CLAUDE_AUTH_MODE: "api_key",
      ANTHROPIC_API_KEY: API_KEY,
    });

    expect(resolution.mode).toBe("api_key");
    expect(resolution.zeroToken).toBe(false);
    expect(resolution.oauthToken).toBeNull();
  });

  it("refuses api_key mode with no key rather than silently using a subscription", () => {
    expectFailure({ SOFTWAREFACTORY_CLAUDE_AUTH_MODE: "api_key" }, "API_KEY_MISSING");
  });

  it("refuses a mode it does not recognise", () => {
    expectFailure({ SOFTWAREFACTORY_CLAUDE_AUTH_MODE: "free" }, "UNKNOWN_AUTH_MODE");
  });
});

describe("inspecting the subscription credential", () => {
  it("refuses an API key pasted into the subscription token slot", () => {
    // Both values start `sk-ant-`. Only the prefix separates a free credential
    // from a billed one, so an operator who pastes the wrong one gets a named
    // refusal rather than silent per-token billing.
    expectFailure(
      { SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: API_KEY },
      "SUBSCRIPTION_CREDENTIAL_IS_API_KEY",
    );
  });

  it("accepts a credentials document carrying OAuth tokens", () => {
    const resolution = resolveClaudeAuth({
      SOFTWAREFACTORY_CLAUDE_AUTH_JSON: JSON.stringify({
        claudeAiOauth: { accessToken: OAUTH_TOKEN, refreshToken: "sk-ant-ort01-cccccccccccc" },
      }),
    });

    expect(resolution.mode).toBe("subscription");
    expect(resolution.zeroToken).toBe(true);
    expect(resolution.credentialsJson).toBeTruthy();
  });

  it("finds an API key nested anywhere in the document, not only under an obvious name", () => {
    expectFailure(
      {
        SOFTWAREFACTORY_CLAUDE_AUTH_JSON: JSON.stringify({
          some: { deeply: { nested: { thing: API_KEY } } },
        }),
      },
      "SUBSCRIPTION_CREDENTIAL_IS_API_KEY",
    );
  });

  it("refuses a document with the right shape and no usable token", () => {
    // `{"claudeAiOauth":{}}` has the shape and no credential in it. Saying so
    // now beats a confusing CLI failure inside a claimed run.
    expectFailure(
      { SOFTWAREFACTORY_CLAUDE_AUTH_JSON: JSON.stringify({ claudeAiOauth: {} }) },
      "SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS",
    );
  });

  it("refuses something that is not JSON at all", () => {
    expectFailure(
      { SOFTWAREFACTORY_CLAUDE_AUTH_JSON: "not json" },
      "SUBSCRIPTION_CREDENTIAL_MALFORMED",
    );
  });

  it("prefers the token over the document when both are set", () => {
    const resolution = resolveClaudeAuth({
      SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
      SOFTWAREFACTORY_CLAUDE_AUTH_JSON: JSON.stringify({ claudeAiOauth: { accessToken: "x" } }),
    });

    // Nothing is written to disk in the token path, so there is no file to leak
    // or forget to clean up.
    expect(resolution.oauthToken).toBe(OAUTH_TOKEN);
    expect(resolution.credentialsJson).toBeNull();
  });
});

describe("api key detection", () => {
  it("separates the two sk-ant prefixes", () => {
    expect(looksLikeAnthropicApiKey(API_KEY)).toBe(true);
    expect(looksLikeAnthropicApiKey(OAUTH_TOKEN)).toBe(false);
  });
});

describe("describing a resolution without leaking it", () => {
  it("never includes the credential in the description", () => {
    for (const environment of [
      { SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN },
      { SOFTWAREFACTORY_CLAUDE_AUTH_MODE: "api_key", ANTHROPIC_API_KEY: API_KEY },
    ]) {
      const description = describeClaudeAuth(resolveClaudeAuth(environment));
      expect(description).not.toContain(OAUTH_TOKEN);
      expect(description).not.toContain(API_KEY);
    }
  });

  it("says plainly which one bills", () => {
    expect(
      describeClaudeAuth(resolveClaudeAuth({ SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN })),
    ).toContain("No per-token API billing");

    expect(
      describeClaudeAuth(
        resolveClaudeAuth({ SOFTWAREFACTORY_CLAUDE_AUTH_MODE: "api_key", ANTHROPIC_API_KEY: API_KEY }),
      ),
    ).toContain("billed per token");
  });
});

describe("redaction secrets", () => {
  it("decomposes a credentials document into its individual tokens", () => {
    // A provider error is unlikely to quote the whole file, but very capable of
    // quoting one token out of it.
    const resolution = resolveClaudeAuth({
      SOFTWAREFACTORY_CLAUDE_AUTH_JSON: JSON.stringify({
        claudeAiOauth: { accessToken: OAUTH_TOKEN, refreshToken: "sk-ant-ort01-dddddddddddd" },
      }),
    });

    const secrets = claudeRedactionSecrets(resolution);
    expect(secrets).toContain(OAUTH_TOKEN);
    expect(secrets).toContain("sk-ant-ort01-dddddddddddd");
  });

  it("returns the token itself in the token path", () => {
    const resolution = resolveClaudeAuth({
      SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
    });
    expect(claudeRedactionSecrets(resolution)).toEqual([OAUTH_TOKEN]);
  });
});

describe("resolving without throwing", () => {
  it("reports a failure a surface can render instead of an exception", () => {
    const result = tryResolveClaudeAuth({});
    expect("failure" in result).toBe(true);
    if ("failure" in result) {
      expect(result.failure.code).toBe("SUBSCRIPTION_CREDENTIAL_MISSING");
    }
  });

  it("reports a resolution when one exists", () => {
    const result = tryResolveClaudeAuth({ SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN });
    expect("resolution" in result).toBe(true);
  });
});
