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
});
