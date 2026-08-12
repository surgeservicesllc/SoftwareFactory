import { describe, expect, it } from "vitest";

import {
  PHASE_1D_POLICY_VERSION,
  evaluateAutonomyObservation,
} from "@/lib/autonomy";

describe("Phase 1D observation-only policy", () => {
  it("reports a fully evidenced GREEN candidate without granting execution", () => {
    const result = evaluateAutonomyObservation({
      autonomousMode: true,
      risk: "GREEN",
      protectedResourceTouched: false,
      evidenceFresh: true,
      requiredChecksPassing: true,
      ownerAttentionRequired: false,
    });

    expect(result).toEqual({
      policyVersion: PHASE_1D_POLICY_VERSION,
      observationEligible: true,
      observationDecision: "WOULD_BE_ELIGIBLE",
      observationBlockers: [],
      executionAllowed: false,
      executionBlockers: [
        "GLOBAL_KILL_SWITCH_ACTIVE",
        "OBSERVATION_ONLY",
        "EXECUTOR_NOT_CONNECTED",
      ],
    });
  });

  it("fails closed when observation mode or evidence is missing", () => {
    const result = evaluateAutonomyObservation({
      autonomousMode: false,
      risk: "GREEN",
      protectedResourceTouched: false,
      evidenceFresh: false,
      requiredChecksPassing: false,
      ownerAttentionRequired: false,
    });

    expect(result.observationDecision).toBe("BLOCKED");
    expect(result.observationBlockers).toEqual([
      "AUTONOMOUS_MODE_OFF",
      "EVIDENCE_MISSING_OR_STALE",
      "REQUIRED_CHECKS_NOT_PASSING",
    ]);
    expect(result.executionAllowed).toBe(false);
  });

  it.each(["YELLOW", "RED"] as const)(
    "never marks %s as observation eligible",
    (risk) => {
      const result = evaluateAutonomyObservation({
        autonomousMode: true,
        risk,
        protectedResourceTouched: false,
        evidenceFresh: true,
        requiredChecksPassing: true,
        ownerAttentionRequired: false,
      });

      expect(result.observationEligible).toBe(false);
      expect(result.observationBlockers).toContain("NON_GREEN_RISK");
      expect(result.executionAllowed).toBe(false);
    },
  );

  it("blocks protected resources and owner-attention states independently", () => {
    const result = evaluateAutonomyObservation({
      autonomousMode: true,
      risk: "GREEN",
      protectedResourceTouched: true,
      evidenceFresh: true,
      requiredChecksPassing: true,
      ownerAttentionRequired: true,
    });

    expect(result.observationBlockers).toEqual([
      "PROTECTED_RESOURCE",
      "OWNER_ATTENTION_REQUIRED",
    ]);
  });
});
