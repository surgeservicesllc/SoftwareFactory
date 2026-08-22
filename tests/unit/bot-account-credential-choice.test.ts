import { describe, expect, it } from "vitest";

import { accountProvisionCredentialChoice } from "@/lib/bots/account-credential-choice";

describe("accountProvisionCredentialChoice", () => {
  it.each([
    ["anthropic", "claude", "subscription"],
    ["anthropic", "claude_2", "subscription_2"],
    ["anthropic", "claude_47", "subscription_47"],
    ["openai", "codex", "subscription"],
    ["openai", "codex_100", "subscription_100"],
  ])("maps %s purpose %s to %s", (provider, purpose, expected) => {
    expect(accountProvisionCredentialChoice(provider, purpose)).toBe(expected);
  });

  it("accepts the abstract form during rolling upgrades", () => {
    expect(accountProvisionCredentialChoice("anthropic", "subscription_2"))
      .toBe("subscription_2");
  });

  it.each([
    ["anthropic", "codex"],
    ["openai", "claude_2"],
    ["anthropic", "claude_1"],
    ["anthropic", "claude_0"],
    ["anthropic", "claude_02"],
    ["anthropic", "claude_10000"],
    ["anthropic", "claude_2x"],
    ["anthropic", "subscription_1"],
    ["anthropic", "subscription_01"],
    ["anthropic", "subscription_10000"],
    ["google", "subscription"],
    ["anthropic", "default"],
    ["anthropic", undefined],
  ])("rejects mismatched or invalid purpose %s / %s", (provider, purpose) => {
    expect(accountProvisionCredentialChoice(provider, purpose)).toBeNull();
  });
});
