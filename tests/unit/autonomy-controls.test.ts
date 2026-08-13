import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_ACTIONS,
  DEFAULT_AUTONOMY_CONTROLS,
  NO_AUTOMATIC_ACTIONS,
  controlsFromRow,
  isActionPermitted,
  isAutomaticAction,
  resolveEffectiveControls,
  type AutonomyControls,
  type AutonomyEnvelope,
} from "@/lib/autonomy/controls";

const OPEN_ENVELOPE: AutonomyEnvelope = {
  killSwitchActive: false,
  emergencyStopActive: false,
  releaseFrozen: false,
  executorConnected: true,
};

function controls(overrides: Partial<AutonomyControls> = {}): AutonomyControls {
  return {
    autonomousMode: true,
    maximumAutonomousRisk: "YELLOW",
    actions: Object.fromEntries(AUTOMATIC_ACTIONS.map((a) => [a, true])) as AutonomyControls["actions"],
    ...overrides,
  };
}

describe("the control vocabulary", () => {
  it("covers all nine automatic actions in loop order", () => {
    expect(AUTOMATIC_ACTIONS).toEqual([
      "plan", "code", "test", "repair", "review", "approve", "merge", "deploy", "rollback",
    ]);
  });

  it("defaults to nothing automatic, mode off, GREEN ceiling", () => {
    expect(DEFAULT_AUTONOMY_CONTROLS.autonomousMode).toBe(false);
    expect(DEFAULT_AUTONOMY_CONTROLS.maximumAutonomousRisk).toBe("GREEN");
    expect(Object.values(DEFAULT_AUTONOMY_CONTROLS.actions).every((v) => v === false)).toBe(true);
  });

  it("recognizes only real actions", () => {
    expect(isAutomaticAction("merge")).toBe(true);
    expect(isAutomaticAction("delete_everything")).toBe(false);
    expect(isAutomaticAction(null)).toBe(false);
  });
});

describe("most restrictive wins", () => {
  it("keeps an action only when both scopes enable it", () => {
    const organization = controls({
      actions: { ...NO_AUTOMATIC_ACTIONS, plan: true, code: true },
    });
    const project = controls({
      actions: { ...NO_AUTOMATIC_ACTIONS, code: true, merge: true },
    });

    const effective = resolveEffectiveControls(organization, project, OPEN_ENVELOPE);

    expect(effective.actions.code).toBe(true);
    expect(effective.actions.plan).toBe(false);
    expect(effective.actions.merge).toBe(false);
  });

  it("takes the lower risk ceiling and says which scope set it", () => {
    const low = resolveEffectiveControls(
      controls({ maximumAutonomousRisk: "GREEN" }),
      controls({ maximumAutonomousRisk: "RED" }),
      OPEN_ENVELOPE,
    );
    expect(low.maximumAutonomousRisk).toBe("GREEN");
    expect(low.riskCeilingSource).toBe("organization");

    const high = resolveEffectiveControls(
      controls({ maximumAutonomousRisk: "RED" }),
      controls({ maximumAutonomousRisk: "YELLOW" }),
      OPEN_ENVELOPE,
    );
    expect(high.maximumAutonomousRisk).toBe("YELLOW");
    expect(high.riskCeilingSource).toBe("project");
  });

  it("never lets a project widen what its organization withheld", () => {
    const effective = resolveEffectiveControls(
      controls({ autonomousMode: false }),
      controls({ autonomousMode: true, maximumAutonomousRisk: "RED" }),
      OPEN_ENVELOPE,
    );

    expect(effective.autonomousMode).toBe(false);
    expect(effective.actions).toEqual(NO_AUTOMATIC_ACTIONS);
    expect(effective.restrictions).toContain("AUTONOMOUS_MODE_OFF_ORGANIZATION");
  });
});

describe("the envelope overrides both scopes", () => {
  it.each([
    ["killSwitchActive", "GLOBAL_KILL_SWITCH_ACTIVE"],
    ["emergencyStopActive", "EMERGENCY_STOP_ACTIVE"],
    ["releaseFrozen", "RELEASE_FROZEN"],
  ] as const)("forces every action off when %s", (field, restriction) => {
    const effective = resolveEffectiveControls(controls(), controls(), {
      ...OPEN_ENVELOPE,
      [field]: true,
    });

    expect(effective.actions).toEqual(NO_AUTOMATIC_ACTIONS);
    expect(effective.restrictions).toContain(restriction);
  });

  it("forces every action off when no executor is connected", () => {
    const effective = resolveEffectiveControls(controls(), controls(), {
      ...OPEN_ENVELOPE,
      executorConnected: false,
    });

    expect(effective.actions).toEqual(NO_AUTOMATIC_ACTIONS);
    expect(effective.restrictions).toContain("EXECUTOR_NOT_CONNECTED");
  });

  it("still reports the mode the operator configured rather than rewriting it", () => {
    const effective = resolveEffectiveControls(controls(), controls(), {
      ...OPEN_ENVELOPE,
      killSwitchActive: true,
    });

    // The interface has to be able to say "mode is on, but everything is held".
    expect(effective.autonomousMode).toBe(true);
    expect(effective.actions).toEqual(NO_AUTOMATIC_ACTIONS);
  });

  it("reports every engaged restriction, not just the first", () => {
    const effective = resolveEffectiveControls(controls({ autonomousMode: false }), controls(), {
      killSwitchActive: true,
      emergencyStopActive: true,
      releaseFrozen: true,
      executorConnected: false,
    });

    expect(effective.restrictions).toEqual([
      "GLOBAL_KILL_SWITCH_ACTIVE",
      "EMERGENCY_STOP_ACTIVE",
      "RELEASE_FROZEN",
      "EXECUTOR_NOT_CONNECTED",
      "AUTONOMOUS_MODE_OFF_ORGANIZATION",
    ]);
  });
});

describe("isActionPermitted", () => {
  const effective = resolveEffectiveControls(
    controls({ maximumAutonomousRisk: "YELLOW" }),
    controls({ maximumAutonomousRisk: "YELLOW" }),
    OPEN_ENVELOPE,
  );

  it("allows an enabled action at or below the ceiling", () => {
    expect(isActionPermitted(effective, "merge", "GREEN")).toBe(true);
    expect(isActionPermitted(effective, "merge", "YELLOW")).toBe(true);
  });

  it("refuses above the ceiling", () => {
    expect(isActionPermitted(effective, "merge", "RED")).toBe(false);
  });

  it("refuses a disabled action even at GREEN", () => {
    const narrowed = resolveEffectiveControls(
      controls({ actions: { ...NO_AUTOMATIC_ACTIONS } }),
      controls(),
      OPEN_ENVELOPE,
    );
    expect(isActionPermitted(narrowed, "merge", "GREEN")).toBe(false);
  });
});

describe("controlsFromRow", () => {
  it("reads a full row", () => {
    const parsed = controlsFromRow({
      autonomous_mode: true,
      maximum_autonomous_risk: "yellow",
      auto_plan: true,
      auto_merge: true,
    });

    expect(parsed.autonomousMode).toBe(true);
    expect(parsed.maximumAutonomousRisk).toBe("YELLOW");
    expect(parsed.actions.plan).toBe(true);
    expect(parsed.actions.merge).toBe(true);
    expect(parsed.actions.deploy).toBe(false);
  });

  it("falls back to the safe default for a missing row", () => {
    expect(controlsFromRow(null)).toEqual(DEFAULT_AUTONOMY_CONTROLS);
    expect(controlsFromRow(undefined)).toEqual(DEFAULT_AUTONOMY_CONTROLS);
  });

  it("never reads a malformed value as more authority", () => {
    const parsed = controlsFromRow({
      autonomous_mode: "yes",
      maximum_autonomous_risk: "catastrophic",
      auto_merge: 1,
    });

    expect(parsed.autonomousMode).toBe(false);
    expect(parsed.maximumAutonomousRisk).toBe("GREEN");
    expect(parsed.actions.merge).toBe(false);
  });
});
