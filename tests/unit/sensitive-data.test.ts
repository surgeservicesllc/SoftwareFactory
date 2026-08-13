// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  containsLikelySecret,
  findSensitiveData,
} from "@/lib/server/sensitive-data";

describe("sensitive data detection", () => {
  it("detects GitHub fine-grained personal access tokens", () => {
    const token = `github_pat_${"A".repeat(40)}`;

    expect(containsLikelySecret(token)).toBe(true);
    expect(findSensitiveData({ content: `credential=${token}` })).toEqual({
      path: "$.content",
      reason: "likely_secret_value",
    });
  });

  it("does not classify ordinary GitHub prose as a credential", () => {
    expect(containsLikelySecret("Document github_pat_ placeholders safely.")).toBe(false);
  });

  it.each([
    "DATABASE_PASSWORD=correct-horse-battery-staple",
    "export SOFTWAREFACTORY_CLIENT_SECRET='opaque-client-value'",
    '"GITHUB_APP_CLIENT_SECRET": "opaque-json-value",',
    "PRIVATE_KEY_BASE64: QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
    "OPENAI_API_KEY=opaque-openai-value",
    "SUPABASE_SERVICE_ROLE_KEY=opaque-service-role-value",
    "GITHUB_APP_WEBHOOK_SECRET=opaque-webhook-value",
    "GITHUB_APP_STATE_SECRET=opaque-state-value",
    "AWS_SECRET_ACCESS_KEY=opaque-aws-value",
    "VERCEL_TOKEN=opaque-vercel-value",
    "PRIVATE_KEY=opaque-private-key-value",
    "ACCESS_TOKEN=opaque-access-token-value",
    "DATABASE_URL=postgresql://app:correct-horse-battery-staple@db.example.com/factory",
    "STRIPE_SECRET_KEY=sk_live_51SoftwareFactorySecretValue",
    'const DATABASE_PASSWORD = "correct-horse-battery-staple";',
    '{"feature":true,"DATABASE_PASSWORD":"correct-horse-battery-staple"}',
  ])("detects a generic sensitive assignment without relying on a provider prefix: %s", (value) => {
    expect(containsLikelySecret(value)).toBe(true);
    expect(findSensitiveData({ content: value })).toEqual({
      path: "$.content",
      reason: "likely_secret_value",
    });
  });

  it.each([
    "DATABASE_PASSWORD=",
    "DATABASE_PASSWORD=<set-in-secret-manager>",
    "SOFTWAREFACTORY_CLIENT_SECRET=${SOFTWAREFACTORY_CLIENT_SECRET}",
    "PRIVATE_KEY_BASE64=${{ secrets.PRIVATE_KEY_BASE64 }}",
    '"GITHUB_APP_CLIENT_SECRET": "REPLACE_ME",',
    "AWS_SECRET_ACCESS_KEY=change-me",
    "VERCEL_TOKEN=xxxxxxxx",
    "DATABASE_URL=postgresql://app:${DATABASE_PASSWORD}@db.example.com/factory",
    '{"DATABASE_PASSWORD":"REPLACE_ME","feature":true}',
    "Document DATABASE_PASSWORD assignment handling without including its value.",
    "Use the PRIVATE_KEY_BASE64 environment variable during server startup.",
  ])("permits an empty or explicit placeholder and ordinary prose: %s", (value) => {
    expect(containsLikelySecret(value)).toBe(false);
  });
});
