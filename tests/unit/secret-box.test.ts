// @vitest-environment node

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  SecretBoxError, codesMatch, generateConnectCode, isCredentialStoreConfigured,
  openSecret, sealSecret,
} = await import("@/lib/server/secret-box");

/**
 * Storing a credential is a rule this repository previously refused outright,
 * so the tests are written against the conditions that made storing it
 * acceptable: a database dump alone is inert, a row cannot be moved between
 * organizations, and tampering fails loudly rather than changing the plaintext.
 */

const orgA = "11111111-2222-4333-8444-555555555555";
const orgB = "99999999-8888-4777-8666-555555555555";
const token = "sk-ant-oat01-subscription-token-value";

beforeEach(() => {
  vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", randomBytes(32).toString("base64"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("round trip", () => {
  it("opens what it sealed", () => {
    const sealed = sealSecret(token, { organizationId: orgA, purpose: "claude" });

    expect(openSecret(sealed, { organizationId: orgA, purpose: "claude" })).toBe(token);
  });

  it("never puts the plaintext in the envelope", () => {
    const sealed = sealSecret(token, { organizationId: orgA, purpose: "claude" });

    expect(sealed).not.toContain(token);
    expect(sealed).not.toContain("sk-ant");
    expect(sealed).not.toContain("subscription");
  });

  it("produces a different envelope every time", () => {
    // A deterministic ciphertext leaks equality: two organizations holding the
    // same token would be visibly identical in a dump.
    const first = sealSecret(token, { organizationId: orgA, purpose: "claude" });
    const second = sealSecret(token, { organizationId: orgA, purpose: "claude" });

    expect(first).not.toBe(second);
    expect(openSecret(first, { organizationId: orgA, purpose: "claude" })).toBe(token);
    expect(openSecret(second, { organizationId: orgA, purpose: "claude" })).toBe(token);
  });
});

describe("a sealed credential belongs where it was sealed", () => {
  it("refuses to open under another organization", () => {
    // The failure this prevents: lifting a ciphertext into another tenant's row
    // and having it work.
    const sealed = sealSecret(token, { organizationId: orgA, purpose: "claude" });

    expect(() => openSecret(sealed, { organizationId: orgB, purpose: "claude" }))
      .toThrow(SecretBoxError);
  });

  it("refuses to open under another purpose", () => {
    // A Claude subscription token must not be usable as the Codex one.
    const sealed = sealSecret(token, { organizationId: orgA, purpose: "claude" });

    expect(() => openSecret(sealed, { organizationId: orgA, purpose: "codex" }))
      .toThrow(SecretBoxError);
  });
});

describe("tampering", () => {
  it("fails loudly when the ciphertext is altered", () => {
    const sealed = sealSecret(token, { organizationId: orgA, purpose: "claude" });
    const parts = sealed.split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    const altered = [parts[0], parts[1], parts[2], data.toString("base64")].join(".");

    // Without the authentication tag, this would decrypt to different bytes
    // rather than refusing.
    expect(() => openSecret(altered, { organizationId: orgA, purpose: "claude" }))
      .toThrow(/altered, or belongs elsewhere/);
  });

  it("fails when the tag is replaced", () => {
    const sealed = sealSecret(token, { organizationId: orgA, purpose: "claude" });
    const parts = sealed.split(".");
    parts[2] = randomBytes(16).toString("base64");

    expect(() => openSecret(parts.join("."), { organizationId: orgA, purpose: "claude" }))
      .toThrow(SecretBoxError);
  });

  it("rejects a malformed envelope rather than guessing at it", () => {
    for (const bad of ["", "nonsense", "v1.a.b", "v2.a.b.c", "v1...", "v1.short.short.data"]) {
      expect(() => openSecret(bad, { organizationId: orgA, purpose: "claude" }))
        .toThrow(SecretBoxError);
    }
  });

  it("does not say whether the key or the tag was wrong", () => {
    // Distinguishing them tells an attacker which half to keep working on.
    const sealed = sealSecret(token, { organizationId: orgA, purpose: "claude" });
    let wrongOrg = "";
    try {
      openSecret(sealed, { organizationId: orgB, purpose: "claude" });
    } catch (error) { wrongOrg = (error as Error).message; }

    const parts = sealed.split(".");
    parts[2] = randomBytes(16).toString("base64");
    let badTag = "";
    try {
      openSecret(parts.join("."), { organizationId: orgA, purpose: "claude" });
    } catch (error) { badTag = (error as Error).message; }

    expect(wrongOrg).toBe(badTag);
  });
});

describe("the master key", () => {
  it("refuses to seal when no key is configured", () => {
    vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", "");

    // Never defaulted: a development fallback would be a key in source control,
    // shared by every environment that forgot to set one.
    expect(() => sealSecret(token, { organizationId: orgA, purpose: "claude" }))
      .toThrow(/is not set/);
    expect(isCredentialStoreConfigured()).toBe(false);
  });

  it("refuses a key that is too short to be worth the algorithm", () => {
    vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", randomBytes(16).toString("base64"));

    expect(() => sealSecret(token, { organizationId: orgA, purpose: "claude" }))
      .toThrow(/at least 32 bytes/);
  });

  it("cannot open a credential sealed under a different master key", () => {
    const sealed = sealSecret(token, { organizationId: orgA, purpose: "claude" });
    vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", randomBytes(32).toString("base64"));

    // This is the property that makes a database dump inert on its own.
    expect(() => openSecret(sealed, { organizationId: orgA, purpose: "claude" }))
      .toThrow(SecretBoxError);
  });

  it("reports configuration honestly", () => {
    expect(isCredentialStoreConfigured()).toBe(true);
  });
});

describe("connect codes", () => {
  it("are long, unique and URL-safe", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateConnectCode()));

    expect(codes.size).toBe(200);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    }
  });

  it("compare without leaking a prefix through timing", () => {
    const code = generateConnectCode();

    expect(codesMatch(code, code)).toBe(true);
    expect(codesMatch(code, generateConnectCode())).toBe(false);
    // Different lengths must not throw; they are simply not a match.
    expect(codesMatch(code, "short")).toBe(false);
    expect(codesMatch("", "")).toBe(true);
  });
});

describe("refusals", () => {
  it("will not seal an empty secret", () => {
    // An empty seal would open to an empty token and read as configured.
    expect(() => sealSecret("", { organizationId: orgA, purpose: "claude" }))
      .toThrow(/empty secret/);
  });
});
