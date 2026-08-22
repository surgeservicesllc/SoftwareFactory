// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BotCredentialError,
  isCredentialPresent,
  listSelectableCredentialRefs,
  normalizeCredentialRef,
} from "@/lib/bots/credentials";

const temporaryKeys: string[] = [];

function setEnv(key: string, value: string) {
  temporaryKeys.push(key);
  process.env[key] = value;
}

afterEach(() => {
  while (temporaryKeys.length) {
    const key = temporaryKeys.pop();
    if (key) delete process.env[key];
  }
});

/**
 * Assert a rejection and its code.
 *
 * The sentinel throw sits after the try rather than inside it. Inside, it was
 * caught by its own catch, so a call that wrongly succeeded reported "expected
 * Error to be an instance of BotCredentialError" instead of saying no rejection
 * happened. The test failed correctly; it just explained the wrong thing.
 */
function expectCredentialRejection(reference: string, code: string) {
  try {
    normalizeCredentialRef(reference);
  } catch (error) {
    if (!(error instanceof BotCredentialError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${reference} to be rejected as ${code}, but it was accepted.`);
}

describe("normalizeCredentialRef", () => {
  it("accepts and upper-cases a known provider variable", () => {
    expect(normalizeCredentialRef("anthropic_api_key")).toBe("ANTHROPIC_API_KEY");
    expect(normalizeCredentialRef("  OPENAI_API_KEY  ")).toBe("OPENAI_API_KEY");
    expect(normalizeCredentialRef("XAI_API_KEY")).toBe("XAI_API_KEY");
    expect(normalizeCredentialRef("GEMINI_API_KEY")).toBe("GEMINI_API_KEY");
  });

  it("accepts an operator-defined reference in the reserved namespace", () => {
    expect(normalizeCredentialRef("BOT_CREDENTIAL_INTERNAL_GATEWAY")).toBe(
      "BOT_CREDENTIAL_INTERNAL_GATEWAY",
    );
  });

  it("accepts numbered subscription variables emitted for additional accounts", () => {
    expect(normalizeCredentialRef("softwarefactory_claude_code_oauth_token_2")).toBe(
      "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2",
    );
    expect(normalizeCredentialRef("SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_47")).toBe(
      "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_47",
    );
    expect(normalizeCredentialRef("SOFTWAREFACTORY_CODEX_AUTH_JSON_9999")).toBe(
      "SOFTWAREFACTORY_CODEX_AUTH_JSON_9999",
    );
  });

  it("refuses malformed subscription slot suffixes", () => {
    for (const reference of [
      "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_0",
      "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_1",
      "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_01",
      "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_10000",
      "SOFTWAREFACTORY_CODEX_AUTH_JSON_SECOND",
    ]) {
      expectCredentialRejection(reference, "credential_ref_not_allowed");
    }
  });

  it("treats an absent reference as valid and null", () => {
    expect(normalizeCredentialRef(null)).toBeNull();
    expect(normalizeCredentialRef(undefined)).toBeNull();
    expect(normalizeCredentialRef("   ")).toBeNull();
  });

  it("refuses control-plane credentials", () => {
    for (const privileged of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
      "GITHUB_CLIENT_SECRET",
      "DATABASE_URL",
      "VERCEL_TOKEN",
    ]) {
      expect(() => normalizeCredentialRef(privileged)).toThrowError(BotCredentialError);
    }
  });

  it("refuses browser-public variables", () => {
    expect(() => normalizeCredentialRef("NEXT_PUBLIC_SUPABASE_URL")).toThrowError(
      /control-plane credentials/i,
    );
  });

  it("refuses an unrecognized variable outside the reserved namespace", () => {
    expectCredentialRejection("SOME_OTHER_TEAM_KEY", "credential_ref_not_allowed");
  });

  it("refuses a pasted credential value rather than a variable name", () => {
    expectCredentialRejection("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "credential_ref_malformed");
  });

  it("refuses a name that is too short to be a variable", () => {
    expect(() => normalizeCredentialRef("AB")).toThrowError(BotCredentialError);
  });
});

describe("isCredentialPresent", () => {
  it("reports presence without exposing the value", () => {
    setEnv("BOT_CREDENTIAL_PRESENT_FIXTURE", "not-a-real-value");
    expect(isCredentialPresent("BOT_CREDENTIAL_PRESENT_FIXTURE")).toBe(true);
  });

  it("resolves a numbered subscription variable without exposing its value", () => {
    const reference = "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2";
    setEnv(reference, "opened-subscription-token");
    expect(isCredentialPresent(reference)).toBe(true);
  });

  it("treats an unset or blank variable as absent", () => {
    setEnv("BOT_CREDENTIAL_BLANK_FIXTURE", "   ");
    expect(isCredentialPresent("BOT_CREDENTIAL_BLANK_FIXTURE")).toBe(false);
    expect(isCredentialPresent("BOT_CREDENTIAL_MISSING_FIXTURE")).toBe(false);
  });

  it("returns false rather than resolving a refused reference", () => {
    setEnv("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role-value");
    expect(isCredentialPresent("SUPABASE_SERVICE_ROLE_KEY")).toBe(false);
    expect(isCredentialPresent(null)).toBe(false);
  });
});

describe("listSelectableCredentialRefs", () => {
  it("returns sorted variable names only", () => {
    const refs = listSelectableCredentialRefs();

    expect(refs.length).toBeGreaterThan(0);
    expect([...refs].sort()).toEqual(refs);
    expect(refs).toContain("ANTHROPIC_API_KEY");
    expect(refs).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    for (const ref of refs) {
      expect(ref).toMatch(/^[A-Z][A-Z0-9_]{2,63}$/);
    }
  });
});
