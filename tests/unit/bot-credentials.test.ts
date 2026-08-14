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
    try {
      normalizeCredentialRef("SOME_OTHER_TEAM_KEY");
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(BotCredentialError);
      expect((error as BotCredentialError).code).toBe("credential_ref_not_allowed");
    }
  });

  it("refuses a pasted credential value rather than a variable name", () => {
    try {
      normalizeCredentialRef("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(BotCredentialError);
      expect((error as BotCredentialError).code).toBe("credential_ref_malformed");
    }
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
