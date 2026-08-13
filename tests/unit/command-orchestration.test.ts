import { describe, expect, it } from "vitest";

import {
  assessCommandRisk,
  normalizeAcceptanceCriteria,
  normalizeDependencyTaskIds,
  resolveAcceptanceCriteria,
} from "@/lib/orchestration/command";

describe("command orchestration input", () => {
  it("keeps audits GREEN when the request has no protected signal", () => {
    expect(assessCommandRisk({
      commandType: "audit",
      prompt: "Audit the dashboard wording and report unclear labels.",
      requestedRisk: "GREEN",
    })).toMatchObject({ effectiveRisk: "GREEN" });
  });

  it("raises product code changes to YELLOW even when GREEN was requested", () => {
    expect(assessCommandRisk({
      commandType: "fix_bug",
      prompt: "Fix the mobile navigation bug.",
      requestedRisk: "GREEN",
    })).toMatchObject({
      effectiveRisk: "YELLOW",
      factors: expect.arrayContaining(["application-behavior"]),
    });
  });

  it.each([
    "Change authentication callback behavior.",
    "Update the RLS policy.",
    "Rotate an API key.",
    "Enable auto deploy.",
  ])("raises a protected request to RED: %s", (prompt) => {
    expect(assessCommandRisk({
      commandType: "other",
      prompt,
      requestedRisk: "GREEN",
    }).effectiveRisk).toBe("RED");
  });

  it("never lowers the owner's requested risk", () => {
    expect(assessCommandRisk({
      commandType: "test",
      prompt: "Add a unit test for an existing helper.",
      requestedRisk: "RED",
    }).effectiveRisk).toBe("RED");
  });

  it("treats acceptance criteria as executable instructions when flooring risk", () => {
    expect(assessCommandRisk({
      acceptanceCriteria: ["Change authentication and session behavior."],
      commandType: "audit",
      prompt: "Implement the acceptance criterion.",
      requestedRisk: "GREEN",
    }).effectiveRisk).toBe("RED");
  });

  it("normalizes and de-duplicates acceptance criteria", () => {
    expect(normalizeAcceptanceCriteria([
      "  Tests pass  ",
      "Tests pass",
      "",
      "No direct main write",
    ])).toEqual(["Tests pass", "No direct main write"]);
  });

  it("preserves explicit acceptance criteria after normalization", () => {
    expect(resolveAcceptanceCriteria("fix_bug", ["  Regression test passes.  "]))
      .toEqual(["Regression test passes."]);
  });

  it.each([
    ["fix_bug", "The reported defect is fixed and verified without unrelated regressions."],
    ["build_feature", "The requested feature works as described and passes applicable validation."],
    ["audit", "The audit findings are documented with cited evidence and prioritized follow-up."],
    ["test", "The requested test coverage passes and protects the specified behavior."],
    ["mobile", "The requested mobile behavior is verified at supported responsive widths."],
    ["security", "The requested security change is verified against the applicable authorization boundary."],
    ["performance", "The requested performance improvement is measured and preserves existing behavior."],
    ["other", "The requested outcome is implemented and verified without unrelated changes."],
  ] as const)("derives deterministic acceptance for %s", (commandType, expected) => {
    expect(resolveAcceptanceCriteria(commandType, [])).toEqual([expected]);
  });

  it("canonicalizes dependency task identifiers for durable replay", () => {
    expect(normalizeDependencyTaskIds([
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ])).toEqual([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]);
  });
});
