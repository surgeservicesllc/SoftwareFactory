// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getGitHubAppConfiguration,
  getGitHubCommitIdentity,
} from "@/lib/github/config";

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

  it("returns one explicitly configured identity for GitHub commit attribution", () => {
    vi.stubEnv("GITHUB_COMMIT_IDENTITY_NAME", "  SoftwareFactory Operator  ");
    vi.stubEnv("GITHUB_COMMIT_IDENTITY_EMAIL", "  operator@example.com  ");

    expect(getGitHubCommitIdentity()).toEqual({
      email: "operator@example.com",
      name: "SoftwareFactory Operator",
    });
  });

  it.each([
    ["missing name", "", "operator@example.com", "GITHUB_COMMIT_IDENTITY_NAME is not configured."],
    ["control character in name", "Operator\nInjected", "operator@example.com", "GITHUB_COMMIT_IDENTITY_NAME must be a valid Git commit identity name."],
    ["Git ident delimiter in name", "Operator <bot>", "operator@example.com", "GITHUB_COMMIT_IDENTITY_NAME must be a valid Git commit identity name."],
    ["missing email", "Operator", "", "GITHUB_COMMIT_IDENTITY_EMAIL is not configured."],
    ["invalid email", "Operator", "operator@example", "GITHUB_COMMIT_IDENTITY_EMAIL must be a valid Git commit identity email address."],
    ["email header injection", "Operator", "operator@example.com\r\nother@example.com", "GITHUB_COMMIT_IDENTITY_EMAIL must be a valid Git commit identity email address."],
  ])("fails closed for a $0", (_label, name, email, message) => {
    vi.stubEnv("GITHUB_COMMIT_IDENTITY_NAME", name);
    vi.stubEnv("GITHUB_COMMIT_IDENTITY_EMAIL", email);

    expect(() => getGitHubCommitIdentity()).toThrow(message);
  });
});
