import { describe, expect, it } from "vitest";

import { detectIntent, planCommand, type PlanningContext } from "@/lib/orchestrator/planner";

function context(overrides: Partial<PlanningContext> = {}): PlanningContext {
  return {
    prompt: "Fix mobile navigation",
    requestedRisk: "green",
    projectName: "SoftwareFactory",
    repositoryConnected: true,
    providerConnected: true,
    executionEnabled: true,
    ...overrides,
  };
}

describe("orchestrator planner", () => {
  it("keeps ordinary work as a single task", () => {
    const plan = planCommand(context({ prompt: "Fix mobile navigation" }));

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].agentRole).toBe("frontend");
    expect(plan.tasks[0].workType).toBe("code_change");
    expect(plan.requiresOwnerAction).toBe(false);
  });

  it("decomposes a broad programme into dependent tasks", () => {
    const plan = planCommand(context({ prompt: "Get this project production ready" }));

    expect(plan.tasks.length).toBeGreaterThan(3);
    const audit = plan.tasks.find((task) => task.key === "repo_audit");
    const security = plan.tasks.find((task) => task.key === "security_audit");
    expect(audit?.dependsOn).toBeNull();
    expect(security?.dependsOn).toBe("repo_audit");
    // Every dependency must name a task that exists in the same plan.
    const keys = new Set(plan.tasks.map((task) => task.key));
    for (const task of plan.tasks) {
      if (task.dependsOn) expect(keys.has(task.dependsOn)).toBe(true);
    }
  });

  it("is deterministic for the same command", () => {
    const first = planCommand(context({ prompt: "Audit the entire repository" }));
    const second = planCommand(context({ prompt: "Audit the entire repository" }));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("treats the declared risk as a floor, never a discount", () => {
    const raised = planCommand(context({ prompt: "Fix mobile navigation", requestedRisk: "yellow" }));
    expect(raised.risk).toBe("yellow");
    expect(raised.tasks.every((task) => task.risk === "yellow")).toBe(true);
  });

  it("escalates to RED on a credential signal even when GREEN was requested", () => {
    const plan = planCommand(context({ prompt: "Rotate the API key for the billing service" }));

    expect(plan.risk).toBe("red");
    expect(plan.requiresOwnerAction).toBe(true);
    expect(plan.ownerActionReason).toContain("RED work requires explicit owner approval");
    expect(plan.tasks.every((task) => task.risk === "red")).toBe(true);
  });

  it("escalates on authentication and DNS signals", () => {
    expect(planCommand(context({ prompt: "Change the session cookie behavior" })).risk).toBe("red");
    expect(planCommand(context({ prompt: "Point the domain nameserver at the new host" })).risk).toBe("red");
  });

  it("names every readiness gap that blocks execution", () => {
    const plan = planCommand(
      context({ repositoryConnected: false, providerConnected: false, executionEnabled: false }),
    );

    expect(plan.requiresOwnerAction).toBe(true);
    expect(plan.ownerActionReason).toContain("no live GitHub connection");
    expect(plan.ownerActionReason).toContain("no worker provider is connected");
    expect(plan.ownerActionReason).toContain("commanded execution is OFF");
  });

  it("assigns the specialist role the objective implies", () => {
    expect(planCommand(context({ prompt: "Fix all failing tests" })).tasks[0].agentRole).toBe("qa");
    expect(planCommand(context({ prompt: "Review security" })).tasks[0].agentRole).toBe("security");
    expect(planCommand(context({ prompt: "Add an index to the database" })).tasks[0].agentRole).toBe("database");
    expect(planCommand(context({ prompt: "Plan the next sprint" })).tasks[0].agentRole).toBe("product");
    expect(planCommand(context({ prompt: "Review this PR" })).tasks[0].agentRole).toBe("architect");
  });

  it("gives investigation work a review validation plan and code work a full one", () => {
    const investigation = planCommand(context({ prompt: "Audit the entire repository" }));
    const code = planCommand(context({ prompt: "Fix mobile navigation" }));

    expect(investigation.tasks[0].validationPlan).not.toContain("production build");
    expect(code.tasks[0].validationPlan).toContain("production build");
    expect(code.tasks[0].validationPlan).toContain("lint");
  });

  it("falls back to general engineering work for an unrecognized command", () => {
    const intent = detectIntent("Do the thing we discussed yesterday");
    expect(intent.id).toBe("general_engineering");
  });

  it("always records acceptance criteria for every planned task", () => {
    const plan = planCommand(context({ prompt: "Get this project production ready" }));
    expect(plan.tasks.every((task) => task.acceptanceCriteria.trim().length > 0)).toBe(true);
  });
});
