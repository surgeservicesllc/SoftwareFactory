// @vitest-environment node

import { describe, expect, it } from "vitest";

import { NODE_CAPABILITIES } from "@/lib/graph/contracts";
import {
  isFeedbackTransition,
  isSdlcStage,
  nextStage,
  nodeDisplayStatus,
  previousStage,
  REJECTION_RETURNS_TO,
  SDLC_LIFECYCLE,
  SDLC_STAGES,
  stageDefinition,
  stageFromSlug,
  stageIndex,
  stageStatus,
} from "@/lib/sdlc/lifecycle";

/**
 * The lifecycle table is data, and data that nothing checks drifts.
 *
 * These are not tests of an algorithm — they are the invariants that make the
 * table usable by everything downstream: the migration's enum, the template's
 * stage labels, the navigation's numbering, and the orchestrator's return
 * table. Each one has a specific way of being wrong that would not be visible
 * by reading.
 */
describe("the ten-stage lifecycle", () => {
  it("names exactly the ten stages, in the order the product presents them", () => {
    expect([...SDLC_STAGES]).toEqual([
      "REQUIREMENT", "DISCOVER", "EVALUATE", "DECIDE", "ARCHITECT",
      "BUILD", "REVIEW", "TEST", "DEPLOY", "MONITOR",
    ]);
  });

  it("defines every stage once, numbered 1 through 10 in order", () => {
    expect(SDLC_LIFECYCLE).toHaveLength(SDLC_STAGES.length);
    expect(SDLC_LIFECYCLE.map((stage) => stage.stage)).toEqual([...SDLC_STAGES]);
    expect(SDLC_LIFECYCLE.map((stage) => stage.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("gives every stage a distinct slug that resolves back to it", () => {
    const slugs = SDLC_LIFECYCLE.map((stage) => stage.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const definition of SDLC_LIFECYCLE) {
      expect(stageFromSlug(definition.slug)).toBe(definition);
      // Case and surrounding space come from a URL, not from us.
      expect(stageFromSlug(` ${definition.slug.toUpperCase()} `)).toBe(definition);
    }
    expect(stageFromSlug("nonesuch")).toBeNull();
  });

  it("gives every stage a purpose, a product and a real capability", () => {
    for (const definition of SDLC_LIFECYCLE) {
      expect(definition.purpose.length, definition.stage).toBeGreaterThan(20);
      expect(definition.produces.length, definition.stage).toBeGreaterThan(20);
      expect(definition.artifact, definition.stage).toMatch(/package$/);
      expect(NODE_CAPABILITIES, definition.stage).toContain(definition.capability);
    }
  });

  it("never sends a rejection forward", () => {
    // A return table that pointed forward would turn a repair into progress:
    // the work would be sent to a stage it had not reached, and the feedback
    // edge validating it would be recorded as an ordinary dependency nothing
    // ever waits on.
    for (const stage of SDLC_STAGES) {
      const returnsTo = REJECTION_RETURNS_TO[stage];
      expect(stageIndex(returnsTo), `${stage} returns to ${returnsTo}`)
        .toBeLessThanOrEqual(stageIndex(stage));
      expect(isFeedbackTransition(stage, returnsTo)).toBe(true);
    }
  });

  it("walks forward and backward and stops at both ends", () => {
    expect(previousStage("REQUIREMENT")).toBeNull();
    expect(nextStage("REQUIREMENT")).toBe("DISCOVER");
    expect(nextStage("MONITOR")).toBeNull();
    expect(previousStage("MONITOR")).toBe("DEPLOY");
    for (let index = 1; index < SDLC_STAGES.length; index += 1) {
      expect(nextStage(SDLC_STAGES[index - 1])).toBe(SDLC_STAGES[index]);
      expect(previousStage(SDLC_STAGES[index])).toBe(SDLC_STAGES[index - 1]);
    }
  });

  it("keeps the two human gates on the two irreversible stages", () => {
    const human = SDLC_LIFECYCLE.filter((stage) => stage.gate === "HUMAN").map((s) => s.stage);
    expect(human).toEqual(["ARCHITECT", "DEPLOY"]);
  });

  it("requires anchored evidence wherever a claim is about the outside world", () => {
    const anchored = SDLC_LIFECYCLE.filter((stage) => stage.requiresAnchor).map((s) => s.stage);
    // DISCOVER is here because every one of its claims — that a package exists,
    // that its licence is what it says — is a claim a model can produce
    // fluently and wrongly.
    expect(anchored).toEqual(["DISCOVER", "TEST", "DEPLOY", "MONITOR"]);
  });

  it("narrows an unknown string", () => {
    expect(isSdlcStage("BUILD")).toBe(true);
    // The eight-stage vocabulary, which the migration maps away and nothing
    // should still be producing.
    expect(isSdlcStage("IMPLEMENTATION")).toBe(false);
    expect(isSdlcStage(null)).toBe(false);
    expect(isSdlcStage(6)).toBe(false);
  });

  it("throws rather than guessing at a stage it has no definition for", () => {
    // @ts-expect-error deliberately outside the union
    expect(() => stageDefinition("PRD")).toThrow(/No definition/);
  });
});

describe("a node's display status", () => {
  it("lets an open gate outrank the execution state", () => {
    expect(nodeDisplayStatus({ state: "COMPLETED", stage: "TEST", gateOpen: true })).toBe("review");
  });

  it("calls a finished deploy deployed and everything else passed", () => {
    expect(nodeDisplayStatus({ state: "COMPLETED", stage: "DEPLOY" })).toBe("deployed");
    expect(nodeDisplayStatus({ state: "COMPLETED", stage: "TEST" })).toBe("passed");
    expect(nodeDisplayStatus({ state: "COMPLETED" })).toBe("passed");
  });

  it("maps each execution state to something a reader can act on", () => {
    expect(nodeDisplayStatus({ state: "PENDING" })).toBe("queued");
    expect(nodeDisplayStatus({ state: "READY" })).toBe("queued");
    expect(nodeDisplayStatus({ state: "RUNNING" })).toBe("running");
    expect(nodeDisplayStatus({ state: "VERIFYING" })).toBe("review");
    expect(nodeDisplayStatus({ state: "BLOCKED" })).toBe("blocked");
    expect(nodeDisplayStatus({ state: "FAILED" })).toBe("failed");
    expect(nodeDisplayStatus({ state: "CANCELLED" })).toBe("failed");
    expect(nodeDisplayStatus({ state: "SKIPPED" })).toBe("skipped");
    expect(nodeDisplayStatus({ state: "something new" })).toBe("queued");
  });
});

describe("a stage's rolled-up status", () => {
  it("is Not Started when the stage has no nodes in this run", () => {
    expect(stageStatus({ statuses: [] })).toBe("Not Started");
  });

  it("reports the worst state, not the most common one", () => {
    // The specific failure this prevents: nine passed nodes and one failed
    // rendering as a green stage.
    expect(stageStatus({ statuses: ["passed", "passed", "failed"] })).toBe("Failed");
    expect(stageStatus({ statuses: ["passed", "review"] })).toBe("Reviewing");
    expect(stageStatus({ statuses: ["passed", "running"] })).toBe("Running");
    expect(stageStatus({ statuses: ["passed", "blocked"] })).toBe("Waiting");
    expect(stageStatus({ statuses: ["passed", "queued"] })).toBe("Queued");
  });

  it("puts a failure ahead of an open gate, and repair ahead of both", () => {
    expect(stageStatus({ statuses: ["review", "failed"] })).toBe("Failed");
    expect(stageStatus({ statuses: ["review", "failed"], repairing: true })).toBe("Repairing");
  });

  it("separates a stage that passed from a lifecycle that finished", () => {
    expect(stageStatus({ statuses: ["passed", "skipped"] })).toBe("Passed");
    expect(stageStatus({ statuses: ["deployed"], isFinalStage: true })).toBe("Complete");
  });
});
