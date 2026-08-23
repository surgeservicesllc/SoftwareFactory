import { describe, expect, it } from "vitest";

import {
  FACTORY_STAGES,
  factoryStageBySlug,
  factoryStageFor,
  stagesInFactoryOrder,
} from "@/lib/graph/factory-stages";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

/**
 * The owner's ten, over the database's eleven.
 *
 * The stored vocabulary is the truth and these are its presentation, so the
 * only way this can lie is by losing a stage or claiming one twice. Both are
 * asserted against `SDLC_STAGES` rather than a list written out here — a stage
 * added to the enum fails these tests instead of quietly vanishing from the
 * pages a person browses.
 */
describe("the ten board stages", () => {
  it("numbers them one to ten, in order", () => {
    expect(FACTORY_STAGES.map((stage) => stage.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(FACTORY_STAGES.map((stage) => stage.name)).toEqual([
      "Requirement", "Discover", "Evaluate", "Decide", "Architect",
      "Build", "Review", "Test", "Deploy", "Monitor",
    ]);
  });

  it("gives every stored stage exactly one home", () => {
    // The load-bearing assertion. A stage in the enum with no board stage would
    // be unreachable from the ten pages; one in two would make a node appear
    // twice in a lifecycle that is meant to be a line.
    for (const stage of SDLC_STAGES) {
      const homes = FACTORY_STAGES.filter((candidate) => candidate.covers.includes(stage));
      expect(homes, `${stage} has ${homes.length} board stages`).toHaveLength(1);
    }
  });

  it("covers nothing the database does not define", () => {
    for (const stage of FACTORY_STAGES.flatMap((entry) => entry.covers)) {
      expect(SDLC_STAGES as readonly string[], `${stage} is not a stored stage`).toContain(stage);
    }
  });

  it("keeps REQUIREMENT as the one stage that covers two", () => {
    /*
     * The single place the ten and the eleven genuinely differ: the request and
     * the structured requirement it becomes are one step on the boards and two
     * rows in the database. Everything else is a rename.
     */
    const multi = FACTORY_STAGES.filter((stage) => stage.covers.length > 1);
    expect(multi.map((stage) => stage.slug)).toEqual(["requirement"]);
    expect(multi[0].covers).toEqual(["GOAL", "PRD"]);
  });

  it("resolves a slug case-insensitively, and refuses one it does not have", () => {
    expect(factoryStageBySlug("build")?.covers).toEqual(["IMPLEMENTATION"]);
    expect(factoryStageBySlug("  Deploy ")?.number).toBe(9);
    expect(factoryStageBySlug("architecture")).toBeNull();
  });

  it("finds the board stage a stored stage belongs to", () => {
    expect(factoryStageFor("PRD")?.slug).toBe("requirement");
    expect(factoryStageFor("IMPLEMENTATION")?.name).toBe("Build");
    expect(factoryStageFor("MONITORING")?.number).toBe(10);
  });

  it("orders every stored stage the way a person reads them", () => {
    // Same set as the enum, board order — so a list built from this cannot
    // drop a stage or invent one.
    expect([...stagesInFactoryOrder()].sort()).toEqual([...SDLC_STAGES].sort());
    expect(stagesInFactoryOrder().slice(0, 3)).toEqual(["GOAL", "PRD", "DISCOVERY"]);
  });

  it("gives each stage a distinct slug and a plain-language purpose", () => {
    const slugs = FACTORY_STAGES.map((stage) => stage.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const stage of FACTORY_STAGES) {
      expect(stage.slug, stage.name).toMatch(/^[a-z]+$/);
      expect(stage.purpose.length, stage.name).toBeGreaterThan(20);
    }
  });
});
