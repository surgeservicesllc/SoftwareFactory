// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ProviderConfigurationError,
  providerEnvironmentVariableNames,
  readProviderCredential,
  resolveAllProviderConfigurations,
  resolveProviderConfiguration,
} from "@/lib/providers/config";

const MANAGED_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_MODEL",
  "ANTHROPIC_PROVIDER_DISABLED",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_DEFAULT_MODEL",
  "OPENAI_PROVIDER_DISABLED",
  "AI_PROVIDER_TIMEOUT_MS",
] as const;

const wellFormedKey = "sk-ant-test-0123456789abcdefghij";

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]]));
  for (const key of MANAGED_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("provider configuration", () => {
  it("treats an absent credential as Not Configured rather than an error", () => {
    const configuration = resolveProviderConfiguration("anthropic");

    expect(configuration.configured).toBe(false);
    expect(configuration.disabled).toBe(false);
    expect(configuration.unavailableReason).toContain("ANTHROPIC_API_KEY");
    expect(readProviderCredential("anthropic")).toBeNull();
  });

  it("reports a configured provider once a well-formed credential is present", () => {
    process.env.ANTHROPIC_API_KEY = wellFormedKey;
    const configuration = resolveProviderConfiguration("anthropic");

    expect(configuration.configured).toBe(true);
    expect(configuration.unavailableReason).toBeNull();
    expect(configuration.defaultModel).toBe("claude-opus-5");
  });

  it("rejects a malformed credential without echoing it", () => {
    process.env.ANTHROPIC_API_KEY = "short key";
    const configuration = resolveProviderConfiguration("anthropic");

    expect(configuration.configured).toBe(false);
    expect(configuration.unavailableReason).toBe(
      "ANTHROPIC_API_KEY is present but is not a well-formed credential.",
    );
    expect(JSON.stringify(configuration)).not.toContain("short key");
  });

  it("never returns the credential value in the resolved configuration", () => {
    process.env.ANTHROPIC_API_KEY = wellFormedKey;
    process.env.OPENAI_API_KEY = "sk-openai-0123456789abcdefghij";

    const serialized = JSON.stringify(resolveAllProviderConfigurations());
    expect(serialized).not.toContain(wellFormedKey);
    expect(serialized).not.toContain("sk-openai");
  });

  it("honours an explicit disable switch", () => {
    process.env.ANTHROPIC_API_KEY = wellFormedKey;
    process.env.ANTHROPIC_PROVIDER_DISABLED = "true";

    const configuration = resolveProviderConfiguration("anthropic");
    expect(configuration.disabled).toBe(true);
    expect(configuration.unavailableReason).toContain("switched off");
  });

  it("requires an owner-selected OpenAI model instead of guessing one", () => {
    process.env.OPENAI_API_KEY = "sk-openai-0123456789abcdefghij";
    const configuration = resolveProviderConfiguration("openai");

    expect(configuration.configured).toBe(true);
    expect(configuration.defaultModel).toBeNull();
    expect(configuration.unavailableReason).toContain("OPENAI_DEFAULT_MODEL");

    process.env.OPENAI_DEFAULT_MODEL = "owner-selected-model";
    expect(resolveProviderConfiguration("openai").defaultModel).toBe("owner-selected-model");
  });

  it("rejects a non-HTTPS base URL outside local development", () => {
    process.env.ANTHROPIC_BASE_URL = "http://api.example.com";
    expect(() => resolveProviderConfiguration("anthropic")).toThrow(ProviderConfigurationError);

    process.env.ANTHROPIC_BASE_URL = "http://localhost:8080";
    expect(resolveProviderConfiguration("anthropic").baseUrl).toBe("http://localhost:8080");
  });

  it("rejects a base URL carrying credentials or a query string", () => {
    process.env.ANTHROPIC_BASE_URL = "https://user:secret@api.example.com";
    expect(() => resolveProviderConfiguration("anthropic")).toThrow(/credentials/i);

    process.env.ANTHROPIC_BASE_URL = "https://api.example.com/?key=value";
    expect(() => resolveProviderConfiguration("anthropic")).toThrow(/query string/i);
  });

  it("rejects a malformed model identifier", () => {
    process.env.OPENAI_DEFAULT_MODEL = "model with spaces";
    expect(() => resolveProviderConfiguration("openai")).toThrow(/valid model identifier/i);
  });

  it("clamps an out-of-range timeout to the default", () => {
    process.env.AI_PROVIDER_TIMEOUT_MS = "1";
    expect(resolveProviderConfiguration("anthropic").requestTimeoutMs).toBe(120_000);

    process.env.AI_PROVIDER_TIMEOUT_MS = "45000";
    expect(resolveProviderConfiguration("anthropic").requestTimeoutMs).toBe(45_000);
  });

  it("exposes environment variable names but never their values", () => {
    process.env.ANTHROPIC_API_KEY = wellFormedKey;
    const names = providerEnvironmentVariableNames("anthropic");

    expect(names).toContain("ANTHROPIC_API_KEY");
    expect(names.join(" ")).not.toContain(wellFormedKey);
  });
});
