import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_ACTIONS,
  DEFAULT_AUTONOMY_CONTROLS,
  resolveEffectiveControls,
} from "@/lib/autonomy/controls";
import {
  AUTONOMY_MODE_DEFINITIONS,
  AUTONOMY_MODES,
  autonomyModeDefinition,
  controlsForMode,
  isAutonomyMode,
  modeForControls,
  NEVER_PRESET_ENABLED,
} from "@/lib/autonomy/modes";

const openEnvelope = {
  killSwitchActive: false,
  emergencyStopActive: false,
  releaseFrozen: false,
  executorConnected: true,
};

describe("autonomy modes", () => {
  it("offers exactly the three the goal names", () => {
    expect([...AUTONOMY_MODES]).toEqual(["ask_me", "balanced", "autonomous"]);
    expect(AUTONOMY_MODE_DEFINITIONS).toHaveLength(3);
  });

  /*
   * The rule that must not drift. AGENTS.md forbids an auto-merge or
   * production deployment workflow in this phase, and the goal forbids
   * bypassing destructive, security or deployment approvals. A preset is a
   * default, not the explicit configuration that would authorise one.
   */
  it("never turns on merge, deploy or rollback — in any mode", () => {
    for (const definition of AUTONOMY_MODE_DEFINITIONS) {
      for (const action of NEVER_PRESET_ENABLED) {
        expect(
          definition.controls.actions[action],
          `${definition.mode} must not enable ${action}`,
        ).toBe(false);
      }
    }
  });

  it("starts a new tenant in Ask Me without changing anything", () => {
    const askMe = controlsForMode("ask_me");
    expect(askMe.autonomousMode).toBe(DEFAULT_AUTONOMY_CONTROLS.autonomousMode);
    expect(askMe.maximumAutonomousRisk).toBe(DEFAULT_AUTONOMY_CONTROLS.maximumAutonomousRisk);
    expect(askMe.actions).toEqual(DEFAULT_AUTONOMY_CONTROLS.actions);
  });

  it("runs the build in Balanced but never accepts its own work", () => {
    const balanced = controlsForMode("balanced");
    expect(balanced.actions.code).toBe(true);
    expect(balanced.actions.test).toBe(true);
    expect(balanced.actions.review).toBe(true);
    // An agent that writes the code and approves it has no independent check.
    expect(balanced.actions.approve).toBe(false);
  });

  it("lets Autonomous accept verified work, and nothing beyond it", () => {
    const autonomous = controlsForMode("autonomous");
    expect(autonomous.actions.approve).toBe(true);
    expect(autonomous.maximumAutonomousRisk).toBe("YELLOW");
    expect(autonomous.actions.merge).toBe(false);
    expect(autonomous.actions.deploy).toBe(false);
  });

  it("widens monotonically, so a mode never removes what a weaker one allowed", () => {
    const [askMe, balanced, autonomous] = AUTONOMY_MODE_DEFINITIONS;
    for (const action of AUTOMATIC_ACTIONS) {
      if (askMe.controls.actions[action]) {
        expect(balanced.controls.actions[action], action).toBe(true);
      }
      if (balanced.controls.actions[action]) {
        expect(autonomous.controls.actions[action], action).toBe(true);
      }
    }
  });

  it("falls back to the most restrictive mode for anything unrecognised", () => {
    expect(autonomyModeDefinition("full_send").mode).toBe("ask_me");
    expect(autonomyModeDefinition(null).mode).toBe("ask_me");
    expect(autonomyModeDefinition(undefined).mode).toBe("ask_me");
    expect(autonomyModeDefinition(true).mode).toBe("ask_me");
    expect(isAutonomyMode("balanced")).toBe(true);
    expect(isAutonomyMode("BALANCED")).toBe(false);
  });

  it("round-trips every mode through recognition", () => {
    for (const mode of AUTONOMY_MODES) {
      expect(modeForControls(controlsForMode(mode))).toBe(mode);
    }
  });

  /*
   * The point of returning null. Reporting a hand-widened configuration as
   * "Autonomous" would tell an operator the platform's safety story applies
   * when they have deliberately stepped outside it.
   */
  it("calls a hand-widened configuration custom rather than Autonomous", () => {
    const widened = {
      ...controlsForMode("autonomous"),
      actions: { ...controlsForMode("autonomous").actions, deploy: true },
    };
    expect(modeForControls(widened)).toBeNull();
  });

  it("gives every mode words a nontechnical person can act on", () => {
    for (const definition of AUTONOMY_MODE_DEFINITIONS) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.summary.length).toBeGreaterThan(20);
      expect(definition.asksAbout.length).toBeGreaterThan(0);
    }
  });
});

describe("a mode is a preset, not a way around the envelope", () => {
  it("still forces everything off under a kill switch, even in Autonomous", () => {
    const autonomous = controlsForMode("autonomous");
    const effective = resolveEffectiveControls(autonomous, autonomous, {
      ...openEnvelope,
      killSwitchActive: true,
    });
    expect(effective.restrictions).toContain("GLOBAL_KILL_SWITCH_ACTIVE");
    for (const action of AUTOMATIC_ACTIONS) {
      expect(effective.actions[action], action).toBe(false);
    }
  });

  it("still forces everything off when no executor is connected", () => {
    const autonomous = controlsForMode("autonomous");
    const effective = resolveEffectiveControls(autonomous, autonomous, {
      ...openEnvelope,
      executorConnected: false,
    });
    expect(effective.restrictions).toContain("EXECUTOR_NOT_CONNECTED");
    expect(effective.actions.code).toBe(false);
  });

  /*
   * A project may only narrow. If a mode could widen past its organization,
   * the preset would be a privilege escalation rather than a convenience.
   */
  it("cannot widen a project past its organization", () => {
    const effective = resolveEffectiveControls(
      controlsForMode("balanced"),
      controlsForMode("autonomous"),
      openEnvelope,
    );
    expect(effective.actions.approve).toBe(false);
    expect(effective.maximumAutonomousRisk).toBe("GREEN");
  });

  it("lets Autonomous actually run the build when the envelope is open", () => {
    const autonomous = controlsForMode("autonomous");
    const effective = resolveEffectiveControls(autonomous, autonomous, openEnvelope);
    expect(effective.restrictions).toEqual([]);
    expect(effective.actions.code).toBe(true);
    expect(effective.actions.approve).toBe(true);
    expect(effective.actions.deploy).toBe(false);
  });
});
