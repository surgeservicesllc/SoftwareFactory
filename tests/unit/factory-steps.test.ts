import { describe, expect, it } from "vitest";

import { FACTORY_STEPS, factoryStep, stepForStage } from "@/lib/sdlc/factory-steps";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

/**
 * The ten-step vocabulary against the eleven-stage engine.
 *
 * The mapping must be total and exclusive: a stage no step owns is work the
 * factory pages silently never show, and a stage two steps own is the same
 * work reported twice. These cases make growing either vocabulary a
 * compile-here event rather than a quiet drift.
 */

describe("the factory steps", () => {
  it("are ten, numbered 1 through 10, each with a unique slug", () => {
    expect(FACTORY_STEPS).toHaveLength(10);
    expect(FACTORY_STEPS.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(FACTORY_STEPS.map((step) => step.slug)).size).toBe(10);
  });

  it("own every lifecycle stage exactly once", () => {
    const owned = FACTORY_STEPS.flatMap((step) => step.stages);
    expect(owned).toHaveLength(SDLC_STAGES.length);
    expect(new Set(owned).size).toBe(SDLC_STAGES.length);
    for (const stage of SDLC_STAGES) {
      expect(stepForStage(stage).stages).toContain(stage);
    }
  });

  it("keep the stages of a step in lifecycle order", () => {
    for (const step of FACTORY_STEPS) {
      const indices = step.stages.map((stage) => SDLC_STAGES.indexOf(stage));
      expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    }
  });

  it("resolve slugs case-insensitively and refuse unknown ones", () => {
    expect(factoryStep("Requirement")?.number).toBe(1);
    expect(factoryStep("monitor")?.number).toBe(10);
    expect(factoryStep("shipping")).toBeNull();
  });
});
