import { describe, expect, it } from "vitest";

import {
  parseRepositoryReleasePolicy,
  parseRequiredCheckNames,
} from "@/lib/graph/release-policy";

describe("repository release policy", () => {
  it("accepts one exact repository-owned check policy", () => {
    expect(parseRepositoryReleasePolicy(JSON.stringify({
      version: 1,
      requiredChecks: ["CI", "Browser 1/2", "Browser 2/2"],
    }))).toEqual({
      version: 1,
      requiredChecks: ["CI", "Browser 1/2", "Browser 2/2"],
    });
  });

  it.each([
    "{}",
    JSON.stringify({ version: 2, requiredChecks: ["CI"] }),
    JSON.stringify({ version: 1, requiredChecks: [] }),
    JSON.stringify({ version: 1, requiredChecks: ["CI", "CI"] }),
    JSON.stringify({ version: 1, requiredChecks: [" CI"] }),
    JSON.stringify({ version: 1, requiredChecks: ["CI|shadow"] }),
    JSON.stringify({ version: 1, requiredChecks: ["x".repeat(161)] }),
  ])("rejects an unsafe or ambiguous policy: %s", (value) => {
    expect(parseRepositoryReleasePolicy(value)).toBeNull();
  });

  it("uses the same 160-character check-name boundary for JSON and workflow encoding", () => {
    const boundary = "x".repeat(160);
    expect(parseRepositoryReleasePolicy(JSON.stringify({
      version: 1,
      requiredChecks: [boundary],
    }))?.requiredChecks).toEqual([boundary]);
    expect(parseRequiredCheckNames(boundary)).toEqual([boundary]);
    expect(parseRequiredCheckNames("x".repeat(161))).toBeNull();
  });
});
