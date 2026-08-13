import { describe, expect, it } from "vitest";

import {
  BOT_READINESS_VALUES,
  evaluateBotReadiness,
  isBotReadiness,
  readinessLabel,
  readinessTone,
} from "@/lib/bots/readiness";

const base = {
  provider: "anthropic",
  model: "claude-opus-5",
  credentialRef: "ANTHROPIC_API_KEY",
  baseUrl: null,
  credentialPresent: true,
};

describe("evaluateBotReadiness", () => {
  it("reports ready only when the credential resolves server-side", () => {
    const verdict = evaluateBotReadiness(base);

    expect(verdict.readiness).toBe("ready");
    expect(verdict.detail).toMatch(/no worker is connected/i);
  });

  it("never claims a live provider session", () => {
    for (const credentialPresent of [true, false]) {
      const verdict = evaluateBotReadiness({ ...base, credentialPresent });
      expect(verdict.detail.toLowerCase()).not.toContain("connected to");
      expect(verdict.detail.toLowerCase()).not.toContain("verified session");
    }
  });

  it("asks for a credential when the reference is missing", () => {
    const verdict = evaluateBotReadiness({ ...base, credentialRef: null });

    expect(verdict.readiness).toBe("not_connected");
    expect(verdict.detail).toContain("ANTHROPIC_API_KEY");
  });

  it("names the unset variable when the reference does not resolve", () => {
    const verdict = evaluateBotReadiness({ ...base, credentialPresent: false });

    expect(verdict.readiness).toBe("not_connected");
    expect(verdict.detail).toContain("ANTHROPIC_API_KEY");
    expect(verdict.detail).toMatch(/not set on this server/i);
  });

  it("blocks an unknown provider", () => {
    const verdict = evaluateBotReadiness({ ...base, provider: "mystery" });

    expect(verdict.readiness).toBe("blocked");
    expect(verdict.detail).toMatch(/supported catalog/i);
  });

  it("blocks a missing model identifier", () => {
    expect(evaluateBotReadiness({ ...base, model: "   " }).readiness).toBe("blocked");
  });

  it("blocks a non-HTTPS endpoint", () => {
    const verdict = evaluateBotReadiness({
      ...base,
      provider: "custom",
      credentialRef: "BOT_CREDENTIAL_CUSTOM",
      baseUrl: "http://gateway.internal/v1",
    });

    expect(verdict.readiness).toBe("blocked");
    expect(verdict.detail).toMatch(/HTTPS/i);
  });

  it("blocks a provider that needs an endpoint until one is supplied", () => {
    const missing = evaluateBotReadiness({
      provider: "selfhosted",
      model: "llama3.1:70b",
      credentialRef: null,
      baseUrl: null,
      credentialPresent: false,
    });
    expect(missing.readiness).toBe("blocked");

    const supplied = evaluateBotReadiness({
      provider: "selfhosted",
      model: "llama3.1:70b",
      credentialRef: null,
      baseUrl: "https://gateway.example.com/v1",
      credentialPresent: false,
    });
    expect(supplied.readiness).toBe("ready");
  });
});

describe("readiness presentation", () => {
  it("labels and tones every readiness value", () => {
    for (const value of BOT_READINESS_VALUES) {
      expect(isBotReadiness(value)).toBe(true);
      expect(readinessLabel(value).length).toBeGreaterThan(0);
      expect(["safe", "warning", "danger", "neutral"]).toContain(readinessTone(value));
    }
  });

  it("rejects values outside the enum", () => {
    expect(isBotReadiness("connected")).toBe(false);
    expect(isBotReadiness(7)).toBe(false);
  });
});
