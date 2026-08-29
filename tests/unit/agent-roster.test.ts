import { describe, expect, it } from "vitest";

import { CAPABILITY_MODEL_TIER, NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { CAPABILITY_TASK_KIND } from "@/lib/graph/provider-bridge";
import { stageForCapability } from "@/lib/graph/templates";
import {
  AGENT_ROLE_IDS,
  AGENT_ROLES,
  approvalBoundRoles,
  findAgentRole,
  roleMayWrite,
  rolesForCapability,
  rolesForStage,
} from "@/lib/sdlc/agent-roster";
import { stageDefinition } from "@/lib/sdlc/lifecycle";

describe("agent roster", () => {
  it("names the eleven roles the platform promises", () => {
    expect(AGENT_ROLES).toHaveLength(11);
    expect(AGENT_ROLES.map((role) => role.id)).toEqual([...AGENT_ROLE_IDS]);
  });

  it("gives every role a capability the graph engine actually knows", () => {
    for (const role of AGENT_ROLES) {
      expect(NODE_CAPABILITIES).toContain(role.capability);
      expect(CAPABILITY_MODEL_TIER[role.capability]).toBeDefined();
      expect(CAPABILITY_TASK_KIND[role.capability]).toBeDefined();
    }
  });

  it("places every role in the stage its capability maps to", () => {
    for (const role of AGENT_ROLES) {
      expect(stageForCapability(role.capability)).toBe(role.stage);
    }
  });

  it("finds a role by id and refuses an unknown one", () => {
    expect(findAgentRole("deployment")?.label).toBe("Deployment");
    expect(findAgentRole("architect")).toBeNull();
    expect(findAgentRole(null)).toBeNull();
    expect(findAgentRole(undefined)).toBeNull();
  });

  /*
   * The point of the role/capability split. If these ever collapse into one
   * role each, someone has turned a bounded-context distinction into a naming
   * one, and frontend work can write backend files again.
   */
  it("shares one implementation capability across three distinct roles", () => {
    const implementers = rolesForCapability("implementation");
    expect(implementers.map((role) => role.id).sort()).toEqual([
      "backend",
      "frontend",
      "integration",
    ]);

    // Same kind of thinking, different reach. If these ever diverge in
    // capability, the split has become a label again.
    const frontend = findAgentRole("frontend");
    const backend = findAgentRole("backend");
    const integration = findAgentRole("integration");
    expect(frontend?.capability).toBe(backend?.capability);
    expect(integration?.capability).toBe(backend?.capability);
    expect(frontend?.reads).not.toEqual(backend?.reads);
    expect(integration?.reads).not.toEqual(frontend?.reads);
  });

  it("keeps schema changes away from every role but the database one", () => {
    for (const role of AGENT_ROLES) {
      if (role.id === "database") continue;
      expect(roleMayWrite(role, "migration")).toBe(false);
      expect(roleMayWrite(role, "database_table")).toBe(false);
    }
    const database = findAgentRole("database");
    expect(database).not.toBeNull();
    expect(roleMayWrite(database!, "migration")).toBe(true);
  });

  it("lets only deployment change a running environment", () => {
    const writers = AGENT_ROLES.filter((role) =>
      roleMayWrite(role, "deployment_environment"),
    );
    expect(writers.map((role) => role.id)).toEqual(["deployment"]);
  });

  it("makes the read-only roles genuinely read-only", () => {
    for (const id of ["research", "security", "code_review"] as const) {
      expect(findAgentRole(id)?.writes).toEqual([]);
    }
  });

  it("binds deployment and schema work to human approval", () => {
    expect(approvalBoundRoles().map((role) => role.id).sort()).toEqual([
      "database",
      "deployment",
    ]);
    expect(findAgentRole("deployment")?.defaultRisk).toBe("RED");
    expect(findAgentRole("database")?.defaultRisk).toBe("YELLOW");
  });

  it("groups roles by the stage they serve", () => {
    expect(rolesForStage("REVIEW").map((role) => role.id).sort()).toEqual([
      "code_review",
      "security",
    ]);
    expect(rolesForStage("DEPLOYMENT").map((role) => role.id)).toEqual(["deployment"]);
    expect(rolesForStage("GOAL")).toEqual([]);
  });
});

describe("the capabilities the roster added", () => {
  /*
   * The defect this closed: DEPLOYMENT had no capability of its own and
   * borrowed `implementation`, so the one stage that changes what users are
   * running was tiered and prompted as though it were writing a feature.
   */
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

  it("asks a provider for a release verdict, not a release proposal", () => {
    expect(CAPABILITY_TASK_KIND.deployment).toBe("qa_assessment");
    expect(CAPABILITY_TASK_KIND.database).toBe("implementation_proposal");
  });

  it("builds schema work inside the implementation stage", () => {
    expect(stageForCapability("database")).toBe("IMPLEMENTATION");
  });

  /*
   * The bar for a capability is behaving differently. Integration was briefly
   * given one and it earned nothing: same tier, same task kind, same stage as
   * implementation. This asserts the two capabilities that did earn theirs are
   * the only ones added, so the next specialist has to clear the same bar.
   */
  it("adds only the capabilities that actually behave differently", () => {
    expect(NODE_CAPABILITIES).toContain("database");
    expect(NODE_CAPABILITIES).toContain("deployment");
    expect(NODE_CAPABILITIES).not.toContain("integration");
    expect(NODE_CAPABILITIES).not.toContain("frontend");
    expect(NODE_CAPABILITIES).not.toContain("backend");
  });
});
