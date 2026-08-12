// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getGitHubAppConfiguration } from "@/lib/github/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GitHub App configuration", () => {
  it("rejects reuse of the installation-state secret as the webhook secret", () => {
    const reusedSecret = "one-secret-must-not-cross-protocol-boundaries";
    vi.stubEnv("GITHUB_APP_ID", "4573846");
    vi.stubEnv("GITHUB_APP_SLUG", "software-factory");
    vi.stubEnv("GITHUB_APP_CALLBACK_URL", "https://factory.example/api/github/install/callback");
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "client-id");
    vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GITHUB_APP_STATE_SECRET", `  ${reusedSecret}  `);
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", reusedSecret);

    expect(() => getGitHubAppConfiguration()).toThrow(
      "GITHUB_APP_STATE_SECRET and GITHUB_APP_WEBHOOK_SECRET must be distinct secrets.",
    );
  });
});
