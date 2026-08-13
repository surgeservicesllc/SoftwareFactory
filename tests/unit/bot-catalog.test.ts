import { describe, expect, it } from "vitest";

import {
  BOT_PROVIDERS,
  BOT_PROVIDER_IDS,
  BOT_ROLE_TEMPLATES,
  findBotProvider,
  findBotRoleTemplate,
  isBotProviderId,
} from "@/lib/bots/catalog";
import { RISK_LEVELS } from "@/lib/risk";

describe("bot provider catalog", () => {
  it("exposes one entry per declared provider id", () => {
    expect(BOT_PROVIDERS).toHaveLength(BOT_PROVIDER_IDS.length);
    expect(new Set(BOT_PROVIDERS.map((provider) => provider.id)).size).toBe(
      BOT_PROVIDERS.length,
    );
    for (const provider of BOT_PROVIDERS) {
      expect(isBotProviderId(provider.id)).toBe(true);
      expect(findBotProvider(provider.id)).toEqual(provider);
    }
  });

  it("covers the providers people ask for by name", () => {
    const labels = BOT_PROVIDERS.map((provider) => provider.label.toLowerCase());
    for (const expected of ["claude", "gemini", "grok"]) {
      expect(labels.some((label) => label.includes(expected))).toBe(true);
    }
    expect(labels.some((label) => label.includes("codex"))).toBe(true);
  });

  it("never names a privileged control-plane variable as a default credential", () => {
    const privileged = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
      "DATABASE_URL",
      "VERCEL_TOKEN",
    ];

    for (const provider of BOT_PROVIDERS) {
      if (provider.defaultCredentialRef === null) continue;
      expect(provider.defaultCredentialRef).toMatch(/^[A-Z][A-Z0-9_]{2,63}$/);
      expect(privileged).not.toContain(provider.defaultCredentialRef);
      expect(provider.defaultCredentialRef.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("keeps catalog metadata free of credential material", () => {
    const serialized = JSON.stringify(BOT_PROVIDERS);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(serialized).not.toMatch(/-----BEGIN/);
    for (const provider of BOT_PROVIDERS) {
      expect(provider.docsUrl.startsWith("https://")).toBe(true);
    }
  });

  it("requires an endpoint exactly for providers that have no fixed host", () => {
    expect(findBotProvider("custom")?.requiresBaseUrl).toBe(true);
    expect(findBotProvider("selfhosted")?.requiresBaseUrl).toBe(true);
    expect(findBotProvider("anthropic")?.requiresBaseUrl).toBe(false);
  });

  it("returns null for an unknown provider", () => {
    expect(findBotProvider("not-a-provider")).toBeNull();
    expect(isBotProviderId("not-a-provider")).toBe(false);
  });
});

describe("bot role templates", () => {
  it("keeps every template within the database column bounds", () => {
    expect(new Set(BOT_ROLE_TEMPLATES.map((template) => template.slug)).size).toBe(
      BOT_ROLE_TEMPLATES.length,
    );

    for (const template of BOT_ROLE_TEMPLATES) {
      expect(template.slug).toMatch(/^[a-z][a-z0-9-]{1,62}$/);
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.name.length).toBeLessThanOrEqual(80);
      expect(template.summary.length).toBeLessThanOrEqual(240);
      expect(template.instructions.length).toBeGreaterThan(0);
      expect(template.instructions.length).toBeLessThanOrEqual(8000);
      expect(RISK_LEVELS).toContain(template.riskCeiling);
      expect(template.capabilities.length).toBeLessThanOrEqual(12);
      for (const capability of template.capabilities) {
        expect(capability.length).toBeGreaterThan(0);
        expect(capability.length).toBeLessThanOrEqual(40);
      }
    }
  });

  it("classifies migration and release roles above GREEN", () => {
    expect(findBotRoleTemplate("database")?.riskCeiling).toBe("RED");
    expect(findBotRoleTemplate("release-manager")?.riskCeiling).toBe("RED");
    expect(findBotRoleTemplate("security-reviewer")?.riskCeiling).toBe("GREEN");
  });

  it("returns null for an unknown template", () => {
    expect(findBotRoleTemplate("nope")).toBeNull();
  });
});
