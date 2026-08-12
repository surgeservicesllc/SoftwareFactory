import { describe, expect, it } from "vitest";

import {
  RISK_DEFINITIONS,
  RISK_LEVELS,
  classifyRisk,
  compareRisk,
  evaluateRiskAuthorization,
  isRiskLevel,
  isWithinRiskCeiling,
} from "@/lib/risk";

describe("risk definitions", () => {
  it("orders GREEN, YELLOW, and RED from lowest to highest impact", () => {
    expect(RISK_LEVELS).toEqual(["GREEN", "YELLOW", "RED"]);
    expect(compareRisk("GREEN", "YELLOW")).toBeLessThan(0);
    expect(compareRisk("YELLOW", "RED")).toBeLessThan(0);
    expect(compareRisk("RED", "RED")).toBe(0);
  });

  it("describes each Phase 1 tier and makes RED owner-gated", () => {
    expect(RISK_DEFINITIONS.GREEN.description).toMatch(
      /low-risk, easily reversible/i,
    );
    expect(RISK_DEFINITIONS.YELLOW.description).toMatch(
      /enhanced validation/i,
    );
    expect(RISK_DEFINITIONS.RED.description).toMatch(
      /money.*destructive production data.*secrets.*authentication.*DNS/i,
    );
    expect(RISK_DEFINITIONS.GREEN.ownerApprovalRequired).toBe(false);
    expect(RISK_DEFINITIONS.YELLOW.ownerApprovalRequired).toBe(false);
    expect(RISK_DEFINITIONS.RED.ownerApprovalRequired).toBe(true);
  });

  it("validates risk levels without coercing input", () => {
    expect(isRiskLevel("GREEN")).toBe(true);
    expect(isRiskLevel("green")).toBe(false);
    expect(isRiskLevel(null)).toBe(false);
  });
});

describe("risk classification", () => {
  it("selects the highest applicable factor regardless of input order", () => {
    expect(
      classifyRisk([
        "dns-or-domain-ownership",
        "documentation-only",
        "application-behavior",
      ]),
    ).toMatchObject({
      level: "RED",
      defaulted: false,
    });
  });

  it.each([
    "money-or-billing",
    "destructive-production-data",
    "secrets-or-credentials",
    "authentication-or-security-controls",
    "dns-or-domain-ownership",
  ] as const)("classifies %s as RED", (factor) => {
    expect(classifyRisk([factor]).level).toBe("RED");
  });

  it("does not treat missing classification context as GREEN", () => {
    expect(classifyRisk([])).toEqual({
      level: "YELLOW",
      factors: [],
      defaulted: true,
    });
  });

  it("deduplicates evidence while preserving its first-seen order", () => {
    expect(
      classifyRisk([
        "test-only",
        "application-behavior",
        "test-only",
      ]).factors,
    ).toEqual(["test-only", "application-behavior"]);
  });
});

describe("risk ceilings", () => {
  it("allows a level at or below its configured ceiling", () => {
    expect(isWithinRiskCeiling("GREEN", "GREEN")).toBe(true);
    expect(isWithinRiskCeiling("GREEN", "YELLOW")).toBe(true);
    expect(isWithinRiskCeiling("YELLOW", "YELLOW")).toBe(true);
  });

  it("blocks a level above its configured ceiling", () => {
    expect(isWithinRiskCeiling("YELLOW", "GREEN")).toBe(false);
    expect(isWithinRiskCeiling("RED", "YELLOW")).toBe(false);
  });
});

describe("Phase 1 risk authorization", () => {
  it("authorizes GREEN within the ceiling without enhanced validation", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "GREEN",
        maximumAuthorizedRisk: "GREEN",
        autonomousMode: true,
      }),
    ).toMatchObject({
      authorized: true,
      decision: "AUTHORIZED",
      enhancedValidationRequired: false,
      ownerApprovalRequired: false,
    });
  });

  it("requires enhanced validation for YELLOW", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "YELLOW",
        maximumAuthorizedRisk: "YELLOW",
        autonomousMode: true,
      }),
    ).toMatchObject({
      authorized: false,
      decision: "ENHANCED_VALIDATION_REQUIRED",
      enhancedValidationRequired: true,
    });
  });

  it("blocks failed validation even if the risk ceiling allows the action", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "YELLOW",
        maximumAuthorizedRisk: "RED",
        autonomousMode: true,
        validationStatus: "FAILED",
      }).decision,
    ).toBe("VALIDATION_FAILED");
  });

  it("never treats a RED risk ceiling as owner approval", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "RED",
        maximumAuthorizedRisk: "RED",
        autonomousMode: true,
        validationStatus: "PASSED",
      }),
    ).toMatchObject({
      authorized: false,
      decision: "OWNER_APPROVAL_REQUIRED",
      ownerApprovalRequired: true,
    });
  });

  it("still requires validation after a RED action receives approval", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "RED",
        maximumAuthorizedRisk: "RED",
        autonomousMode: true,
        ownerApprovalStatus: "APPROVED",
      }).decision,
    ).toBe("ENHANCED_VALIDATION_REQUIRED");
  });

  it("authorizes RED only after explicit approval and passing validation", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "RED",
        maximumAuthorizedRisk: "RED",
        autonomousMode: true,
        ownerApprovalStatus: "APPROVED",
        validationStatus: "PASSED",
      }).decision,
    ).toBe("AUTHORIZED");
  });

  it("preserves an owner rejection as a distinct blocking decision", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "RED",
        maximumAuthorizedRisk: "RED",
        autonomousMode: true,
        ownerApprovalStatus: "REJECTED",
        validationStatus: "PASSED",
      }).decision,
    ).toBe("OWNER_APPROVAL_REJECTED");
  });

  it("does not let owner approval override the configured risk ceiling", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "RED",
        maximumAuthorizedRisk: "YELLOW",
        autonomousMode: true,
        ownerApprovalStatus: "APPROVED",
        validationStatus: "PASSED",
      }).decision,
    ).toBe("ABOVE_RISK_CEILING");
  });

  it("blocks every tier when autonomous mode is off", () => {
    expect(
      evaluateRiskAuthorization({
        risk: "GREEN",
        maximumAuthorizedRisk: "RED",
        autonomousMode: false,
      }).decision,
    ).toBe("AUTONOMOUS_MODE_OFF");
  });
});
