import { describe, expect, it } from "vitest";

import { CAPABILITY_MODEL_TIER, NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { CAPABILITY_TASK_KIND } from "@/lib/graph/provider-bridge";
import { stageForCapability } from "@/lib/graph/templates";
import { SPECIALISTS } from "@/lib/factory/specialists";
import { stageDefinition } from "@/lib/sdlc/lifecycle";

/**
 * The two build-side capabilities, and the defect that motivated them.
 *
 * The factory's eleven specialists (lib/factory/specialists.ts) name a role
 * per job and map each onto the engine's capabilities. That mapping was
 * missing two facts underneath it: schema work and releasing were not
 * capabilities at all, so a DEPLOYMENT node borrowed `implementation` and was
 * tiered, prompted and risk-scored as though it were writing a feature.
 *
 * These tests hold the two additions to the bar that justifies them —
 * behaving differently, not being differently named. Frontend, backend and
 * integration deliberately did NOT become capabilities: all three are the
 * same reasoning at the same tier against the same task kind, and the
 * specialists module already distinguishes them as roles.
 */

describe("the capabilities the specialists needed underneath them", () => {
  it("gives the deployment stage its own capability", () => {
    expect(stageDefinition("DEPLOYMENT").capability).toBe("deployment");
    expect(stageForCapability("deployment")).toBe("DEPLOYMENT");
  });

  it("keeps the deployment stage behind a human gate", () => {
    expect(stageDefinition("DEPLOYMENT").gate).toBe("HUMAN");
  });

  it("does not run schema or release judgement on a cheap model", () => {
    expect(CAPABILITY_MODEL_TIER.database).toBe("STRONG");
    expect(CAPABILITY_MODEL_TIER.deployment).toBe("STRONG");
  });

  /*
   * A deploy step does not propose a change — the change exists and was
   * reviewed. It judges whether the preconditions to release hold, which is
   * the shape `qa_assessment` already asks for.
   */
  it("asks a provider for a release verdict, not a release proposal", () => {
    expect(CAPABILITY_TASK_KIND.deployment).toBe("qa_assessment");
    expect(CAPABILITY_TASK_KIND.database).toBe("implementation_proposal");
  });

  it("builds schema work inside the implementation stage", () => {
    expect(stageForCapability("database")).toBe("IMPLEMENTATION");
  });

  it("adds only the capabilities that actually behave differently", () => {
    expect(NODE_CAPABILITIES).toContain("database");
    expect(NODE_CAPABILITIES).toContain("deployment");
    // Roles, not capabilities — same tier, same task kind, same stage.
    expect(NODE_CAPABILITIES).not.toContain("frontend");
    expect(NODE_CAPABILITIES).not.toContain("backend");
    expect(NODE_CAPABILITIES).not.toContain("integration");
  });

  /*
   * The join that must hold: every capability a specialist claims has to be
   * one the engine actually defines, or the role owns nothing.
   */
  it("leaves every specialist's claimed capability real", () => {
    for (const specialist of SPECIALISTS) {
      for (const capability of specialist.capabilities) {
        expect(NODE_CAPABILITIES, `${specialist.key} claims ${capability}`)
          .toContain(capability);
      }
    }
  });
});
