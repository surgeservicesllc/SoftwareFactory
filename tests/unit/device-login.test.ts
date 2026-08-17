import { describe, expect, it } from "vitest";

import {
  composeDeviceLoginUrl,
  extractDeviceUserCode,
  parseDeviceLogin,
} from "@/lib/ai-accounts/device-login";

describe("device login composition", () => {
  it("rides the one-time code in the URL fragment and parses it back", () => {
    const composed = composeDeviceLoginUrl("https://auth.openai.com/codex/device", "VJKU-I0IWK");
    expect(composed).toBe("https://auth.openai.com/codex/device#sf-device-code=VJKU-I0IWK");
    expect(parseDeviceLogin(composed)).toEqual({
      url: "https://auth.openai.com/codex/device",
      userCode: "VJKU-I0IWK",
    });
  });

  it("treats a plain login URL as having no device code", () => {
    expect(parseDeviceLogin("https://claude.com/cai/oauth/authorize?x=1")).toEqual({
      url: "https://claude.com/cai/oauth/authorize?x=1",
      userCode: null,
    });
    // A foreign fragment is not ours to interpret.
    expect(parseDeviceLogin("https://example.com/page#section-2").userCode).toBeNull();
  });

  it("finds the code as the CLI prints it, and nothing URL-shaped", () => {
    const output = [
      "Follow these steps to sign in with ChatGPT using device code authorization:",
      "1. Open this link in your browser and sign in to your account",
      "https://auth.openai.com/codex/device",
      "2. Enter this one-time code (expires in 15 minutes)",
      "VJKU-I0IWK",
    ].join("\n");
    expect(extractDeviceUserCode(output)).toBe("VJKU-I0IWK");
    expect(extractDeviceUserCode("no codes here, just words")).toBeNull();
  });
});
