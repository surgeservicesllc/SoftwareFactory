// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  isSlotPurpose,
  maxAiAccountsPerProvider,
  purposeForSlot,
  relayCodePurpose,
  slotIndexForPurpose,
} from "@/lib/ai-accounts/purposes";

/**
 * The purpose vocabulary is the one definition of what an account slot looks
 * like, shared by the connect-command route, the broker, and the worker. Its
 * load-bearing property is the stated product requirement: no hard-coded
 * maximum number of accounts — the only ceiling is configured capacity.
 */

describe("slot purposes", () => {
  it("names slot 1 bare and numbers the rest, without limit", () => {
    expect(purposeForSlot("anthropic", 0)).toBe("claude");
    expect(purposeForSlot("anthropic", 1)).toBe("claude_2");
    expect(purposeForSlot("anthropic", 46)).toBe("claude_47");
    expect(purposeForSlot("openai", 99)).toBe("codex_100");
  });

  it("round-trips purpose to slot and back", () => {
    for (const slot of [0, 1, 2, 46, 998]) {
      expect(slotIndexForPurpose("anthropic", purposeForSlot("anthropic", slot))).toBe(slot);
    }
  });

  it("rejects the shapes that are not slots", () => {
    // `claude_1` is not a purpose — slot 1 is the bare name; accepting both
    // would give one account two credential rows.
    expect(slotIndexForPurpose("anthropic", "claude_1")).toBeNull();
    expect(slotIndexForPurpose("anthropic", "claude_0")).toBeNull();
    expect(slotIndexForPurpose("anthropic", "claude_02")).toBeNull();
    expect(slotIndexForPurpose("anthropic", "codex_2")).toBeNull();
    expect(isSlotPurpose("codex_2")).toBe(true);
    expect(isSlotPurpose("gemini_2")).toBe(false);
    expect(isSlotPurpose("ai_auth_relay:x")).toBe(false);
  });

  it("keeps the relay purpose disjoint from every slot purpose", () => {
    // The relay seal context contains a colon, which the vault's purpose
    // pattern refuses — a relayed code can never be stored as a credential.
    expect(isSlotPurpose(relayCodePurpose("some-session"))).toBe(false);
    expect(relayCodePurpose("s-1")).not.toBe(relayCodePurpose("s-2"));
  });
});

describe("configured capacity", () => {
  it("reads the configured ceiling and defaults generously", () => {
    expect(maxAiAccountsPerProvider({})).toBe(100);
    expect(maxAiAccountsPerProvider({
      SOFTWAREFACTORY_MAX_AI_ACCOUNTS_PER_PROVIDER: "7",
    })).toBe(7);
    expect(maxAiAccountsPerProvider({
      SOFTWAREFACTORY_MAX_AI_ACCOUNTS_PER_PROVIDER: "250",
    })).toBe(250);
  });

  it("falls back to the default on nonsense rather than capping at zero", () => {
    for (const bad of ["0", "-3", "abc", "1.5", ""]) {
      expect(maxAiAccountsPerProvider({
        SOFTWAREFACTORY_MAX_AI_ACCOUNTS_PER_PROVIDER: bad,
      })).toBe(100);
    }
  });
});
