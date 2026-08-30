// @vitest-environment node

import { describe, expect, it } from "vitest";

import { AUTONOMY_MODES, deriveAutonomyMode } from "@/lib/factory/autonomy-mode";

/**
 * The modes derive from the stored controls; they never override them. The
 * catalogue's patches are the exact bodies the real controls route receives,
 * and the fence's refusal — not this module — decides what may change.
 */

const askMe = {
  autonomousMode: false,
  maximumAutonomousRisk: "green",
  autoApprove: false,
  autoMerge: false,
  autoDeploy: false,
  autoRollback: false,
};

describe("deriveAutonomyMode", () => {
  it("reads today's only permitted state as Ask Me", () => {
    expect(deriveAutonomyMode(askMe)).toBe("ask_me");
  });

  it("derives the future states the fence would have to admit first", () => {
    expect(deriveAutonomyMode({ ...askMe, autonomousMode: true })).toBe("balanced");
    expect(deriveAutonomyMode({
      ...askMe, autonomousMode: true, maximumAutonomousRisk: "yellow",
    })).toBe("autonomous");
  });
});

describe("the mode catalogue", () => {
  it("names exactly the directive's three modes with exact control patches", () => {
    expect(AUTONOMY_MODES.map((mode) => mode.key)).toEqual(["ask_me", "balanced", "autonomous"]);
    expect(AUTONOMY_MODES.find((mode) => mode.key === "balanced")?.patch)
      .toEqual({ autonomousMode: true, maximumAutonomousRisk: "green" });
    expect(AUTONOMY_MODES.find((mode) => mode.key === "autonomous")?.patch)
      .toEqual({ autonomousMode: true, maximumAutonomousRisk: "yellow" });
  });

  it("states the invariant on every mode: RED stays owner-approved", () => {
    for (const mode of AUTONOMY_MODES) {
      expect(`${mode.promise} ${mode.invariant}`).toMatch(/owner|approval|RED|Phase 1A/);
    }
  });

  it("round-trips: each mode's patch derives back to that mode", () => {
    for (const mode of AUTONOMY_MODES) {
      expect(deriveAutonomyMode({ ...askMe, ...mode.patch })).toBe(mode.key);
    }
  });
});
