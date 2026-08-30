// @vitest-environment node

import { describe, expect, it } from "vitest";

import { SPECIALISTS, specialistForNode } from "@/lib/factory/specialists";
import { NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

/**
 * The role system must be derivable, never guessed: every assignment comes
 * from a capability the engine records, a stage default, or the words in the
 * node's own key — and a node nothing matches gets no role at all.
 */

describe("the specialist catalogue", () => {
  it("names the directive's eleven specialists, each with a mission and bounded IO", () => {
    expect(SPECIALISTS.map((s) => s.key)).toEqual([
      "research", "product", "architecture", "frontend", "backend",
      "database", "security", "integration", "qa", "code_review", "deployment",
    ]);
    for (const specialist of SPECIALISTS) {
      expect(specialist.mission.length, `${specialist.key} mission`).toBeGreaterThan(10);
      expect(specialist.receives.length, `${specialist.key} receives`).toBeGreaterThan(10);
      expect(specialist.produces.length, `${specialist.key} produces`).toBeGreaterThan(10);
    }
  });

  it("binds only to capabilities the engine actually has", () => {
    const known = new Set<string>(NODE_CAPABILITIES);
    for (const specialist of SPECIALISTS) {
      for (const capability of specialist.capabilities) {
        expect(known.has(capability), `${specialist.key} claims unknown capability ${capability}`).toBe(true);
      }
    }
  });

  it("binds only to stages the lifecycle actually has", () => {
    const known = new Set<string>(SDLC_STAGES);
    for (const specialist of SPECIALISTS) {
      for (const stage of specialist.stages) {
        expect(known.has(stage), `${specialist.key} claims unknown stage ${stage}`).toBe(true);
      }
    }
  });
});

describe("specialistForNode", () => {
  it("assigns by exact capability", () => {
    expect(specialistForNode({ capability: "security_review" })?.key).toBe("security");
    expect(specialistForNode({ capability: "qa" })?.key).toBe("qa");
    expect(specialistForNode({ capability: "synthesis" })?.key).toBe("integration");
    expect(specialistForNode({ capability: "review" })?.key).toBe("code_review");
    expect(specialistForNode({ capability: "discovery" })?.key).toBe("research");
    expect(specialistForNode({ capability: "planning" })?.key).toBe("product");
    expect(specialistForNode({ capability: "architecture" })?.key).toBe("architecture");
  });

  it("tells the engineering bench apart by the words in the node's own key", () => {
    expect(specialistForNode({ capability: "implementation", node_key: "build-ui-page" })?.key).toBe("frontend");
    expect(specialistForNode({ capability: "implementation", node_key: "schema-migration" })?.key).toBe("database");
    expect(specialistForNode({ capability: "implementation", node_key: "api-endpoint" })?.key).toBe("backend");
    // No distinguishing word: the backend seat, never a guess between three.
    expect(specialistForNode({ capability: "implementation", node_key: "implement" })?.key).toBe("backend");
  });

  it("falls back to the stage default, and to no role at all", () => {
    expect(specialistForNode({ capability: null, lifecycle_stage: "DEPLOYMENT" })?.key).toBe("deployment");
    expect(specialistForNode({ capability: null, lifecycle_stage: "MONITORING" })?.key).toBe("deployment");
    expect(specialistForNode({ capability: null, lifecycle_stage: "GOAL" })?.key).toBe("product");
    // Nothing recorded → no role: the caller shows the executor alone.
    expect(specialistForNode({ capability: null, lifecycle_stage: null })).toBeNull();
    expect(specialistForNode({})).toBeNull();
  });

  it("covers every lifecycle stage one way or another", () => {
    for (const stage of SDLC_STAGES) {
      const assigned = specialistForNode({ capability: null, lifecycle_stage: stage });
      // EVALUATION and DECISION ride their capabilities' owners via stage
      // defaults too — no stage of a real run renders without a role when
      // the engine recorded a stage.
      expect(assigned, `stage ${stage} has no specialist`).not.toBeNull();
    }
  });
});
