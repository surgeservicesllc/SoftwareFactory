// @vitest-environment node

import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getGitHubAppConfiguration,
  getGitHubAppConfigurationEntries,
  getGitHubAppConfigurationForAppId,
  getGitHubAppConfigurationForSlot,
  getGitHubCandidateAppConfiguration,
  getGitHubCommitIdentity,
} from "@/lib/github/config";

function privateKey() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

const primaryPrivateKey = privateKey();
const candidatePrivateKey = privateKey();

function configureCandidate(overrides: Record<string, string> = {}) {
  const values = {
    GITHUB_CANDIDATE_APP_CALLBACK_URL: "https://factory.example/api/github/install/callback",
    GITHUB_CANDIDATE_APP_CLIENT_ID: "candidate-client-id",
    GITHUB_CANDIDATE_APP_CLIENT_SECRET: "candidate-client-secret",
    GITHUB_CANDIDATE_APP_ID: "5573846",
    GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64: Buffer.from(candidatePrivateKey).toString("base64"),
    GITHUB_CANDIDATE_APP_SLUG: "software-factory-candidate",
    GITHUB_CANDIDATE_APP_STATE_SECRET: "c".repeat(48),
    GITHUB_CANDIDATE_APP_WEBHOOK_SECRET: "d".repeat(48),
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "4573846");
  vi.stubEnv("GITHUB_APP_SLUG", "software-factory");
  vi.stubEnv("GITHUB_APP_CALLBACK_URL", "https://factory.example/api/github/install/callback");
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "primary-client-id");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "primary-client-secret");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY_BASE64", Buffer.from(primaryPrivateKey).toString("base64"));
  vi.stubEnv("GITHUB_APP_STATE_SECRET", "s".repeat(48));
  vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "w".repeat(48));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GitHub App configuration", () => {
  it("preserves the primary-only configuration by default", () => {
    expect(getGitHubCandidateAppConfiguration()).toBeNull();
    expect(getGitHubAppConfigurationForSlot("primary").appId).toBe(4573846);
    expect(getGitHubAppConfigurationEntries()).toEqual([
      expect.objectContaining({
        configuration: expect.objectContaining({ appId: 4573846 }),
        slot: "primary",
      }),
    ]);
  });

  it("loads one isolated candidate and selects configurations only by exact server-owned identity", () => {
    configureCandidate();

    expect(getGitHubAppConfigurationForSlot("candidate")).toEqual(
      expect.objectContaining({
        appId: 5573846,
        appSlug: "software-factory-candidate",
        clientId: "candidate-client-id",
      }),
    );
    expect(getGitHubAppConfigurationForAppId(4573846).appSlug).toBe("software-factory");
    expect(getGitHubAppConfigurationForAppId(5573846).appSlug)
      .toBe("software-factory-candidate");
    expect(getGitHubAppConfigurationEntries().map(({ slot }) => slot))
      .toEqual(["primary", "candidate"]);
  });

  it("fails every dual-App configuration reader closed when a candidate is partial", () => {
    vi.stubEnv("GITHUB_CANDIDATE_APP_ID", "5573846");

    expect(() => getGitHubCandidateAppConfiguration()).toThrow(
      "GITHUB_CANDIDATE_APP_SLUG is not configured.",
    );
    expect(() => getGitHubAppConfigurationEntries()).toThrow(
      "GITHUB_CANDIDATE_APP_SLUG is not configured.",
    );
    expect(() => getGitHubAppConfigurationForAppId(4573846)).toThrow(
      "GITHUB_CANDIDATE_APP_SLUG is not configured.",
    );
  });

  it("fails closed when both candidate private-key representations are configured", () => {
    configureCandidate({ GITHUB_CANDIDATE_APP_PRIVATE_KEY: candidatePrivateKey });

    expect(() => getGitHubCandidateAppConfiguration()).toThrow(
      "Configure exactly one of GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64 or GITHUB_CANDIDATE_APP_PRIVATE_KEY.",
    );
  });

  it.each([
    ["ID", { GITHUB_CANDIDATE_APP_ID: "4573846" }],
    ["SLUG", { GITHUB_CANDIDATE_APP_SLUG: "SOFTWARE-FACTORY" }],
    ["CLIENT_ID", { GITHUB_CANDIDATE_APP_CLIENT_ID: "primary-client-id" }],
    ["CLIENT_SECRET", { GITHUB_CANDIDATE_APP_CLIENT_SECRET: "primary-client-secret" }],
    ["STATE_SECRET", { GITHUB_CANDIDATE_APP_STATE_SECRET: "s".repeat(48) }],
    ["WEBHOOK_SECRET", { GITHUB_CANDIDATE_APP_WEBHOOK_SECRET: "w".repeat(48) }],
  ])("rejects candidate reuse of the primary %s", (field, overrides) => {
    configureCandidate(overrides);

    expect(() => getGitHubCandidateAppConfiguration()).toThrow(
      `GITHUB_CANDIDATE_APP_${field} must be distinct from the primary GitHub App value.`,
    );
  });

  it("rejects reuse of the primary private key even through a different representation", () => {
    configureCandidate({
      GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64: Buffer.from(primaryPrivateKey).toString("base64"),
    });

    expect(() => getGitHubCandidateAppConfiguration()).toThrow(
      "GITHUB_CANDIDATE_APP_PRIVATE_KEY must be distinct from the primary GitHub App private key.",
    );
  });

  it("rejects cross-protocol candidate secret reuse", () => {
    configureCandidate({ GITHUB_CANDIDATE_APP_STATE_SECRET: "w".repeat(48) });

    expect(() => getGitHubCandidateAppConfiguration()).toThrow(
      "GITHUB_APP_WEBHOOK_SECRET and GITHUB_CANDIDATE_APP_STATE_SECRET must be distinct secrets.",
    );
  });

  it("rejects an unknown or invalid App id instead of falling back to primary", () => {
    configureCandidate();

    expect(() => getGitHubAppConfigurationForAppId(9999999)).toThrow(
      "The requested GitHub App is not configured.",
    );
    expect(() => getGitHubAppConfigurationForAppId(0)).toThrow(
      "GitHub App id must be a positive integer.",
    );
  });

  it("rejects an explicit candidate selection when the candidate is absent", () => {
    expect(() => getGitHubAppConfigurationForSlot("candidate")).toThrow(
      "The candidate GitHub App is not configured.",
    );
  });

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
