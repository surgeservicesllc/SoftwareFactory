// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  classifyIntent,
  planForGoal,
  statedConstraints,
  templateForPlan,
} from "@/lib/sdlc/chief-of-staff";
import { GRAPH_TEMPLATES } from "@/lib/graph/templates";

/**
 * The Chief of Staff decides what runs when someone types a sentence.
 *
 * Two things are under test and they pull in opposite directions: that it
 * routes a whole-product request to the ten-phase path, and that it invents
 * nothing while doing so. The second is the one worth guarding — a planner
 * that emits plausible requirements from a vague sentence is fabricating
 * agreement, and it would read as competence.
 */

describe("routing a whole product to the ten-phase path", () => {
  it("sends a product request to full_lifecycle", () => {
    /*
     * The gap this closes: full_lifecycle is the richest template here and no
     * keyword routed to it. Running the whole path required knowing its key.
     */
    const plan = planForGoal("Build me a booking app for my salon");

    expect(plan.templateKey).toBe("full_lifecycle");
    expect(plan.wholeProduct).toBe(true);
    expect(plan.intent).toBe("build");
  });

  it("does not send a one-line change through ten phases", () => {
    // "Add a button" matches *build*, and putting it through discovery and
    // architecture gates would be ceremony, not care.
    const plan = planForGoal("Add a logout button to the settings page");

    expect(plan.wholeProduct).toBe(false);
    expect(plan.templateKey).toBe("feature_build");
  });

  it("explains itself in a sentence a non-technical person can read", () => {
    const plan = planForGoal("Create a marketplace platform for local growers");
    expect(plan.rationale).toMatch(/whole product/i);
    // No jargon a person would have to look up.
    expect(plan.rationale).not.toMatch(/\bDAG\b|\bnode\b|\btopology\b/);
  });
});

describe("intent classification", () => {
  it("reads the ordinary asks", () => {
    expect(planForGoal("Fix the broken checkout").intent).toBe("fix");
    expect(planForGoal("Audit our security posture").intent).toBe("audit");
    expect(planForGoal("Migrate the users table").intent).toBe("migrate");
    expect(planForGoal("Refactor the payment module").intent).toBe("improve");
    expect(planForGoal("Investigate yesterday's outage").intent).toBe("investigate");
  });

  it("prefers the failure when a request mentions both", () => {
    /*
     * "Fix the migration that broke" is a fix. The person is asking about the
     * failure, not asking for a migration — order in the rule list is the
     * policy, and this is the case that pins it.
     */
    const plan = planForGoal("Fix the migration that broke last night");
    expect(plan.intent).toBe("fix");
  });

  it("quotes what it matched, so a person can argue with the routing", () => {
    const { signals } = classifyIntent("Build me a dashboard");
    expect(signals[0]?.matched.toLowerCase()).toBe("build");
  });

  it("treats an unrecognised request as building something", () => {
    // The honest default: someone typing into a build tool wants something built.
    expect(planForGoal("A quiet place to track my reading").intent).toBe("build");
  });
});

describe("what it refuses to invent", () => {
  it("states no constraints when the request stated none", () => {
    /*
     * The load-bearing case. A planner that answers "Build me a booking app"
     * with "must support login, must be mobile responsive, must take payments"
     * has put three commitments in the requester's mouth. Empty is correct.
     */
    const plan = planForGoal("Build me a booking app");
    expect(plan.statedConstraints).toEqual([]);
  });

  it("quotes a constraint the request actually made", () => {
    const plan = planForGoal("Build a booking app using Next.js that must work offline");

    expect(plan.statedConstraints.some((c) => /next\.?js/i.test(c))).toBe(true);
    expect(plan.statedConstraints.some((c) => /must work offline/i.test(c))).toBe(true);
  });

  it("does not paraphrase a constraint into a requirement", () => {
    const plan = planForGoal("Build a store with Stripe");
    // The quoted text, not "the system must integrate a payment provider".
    expect(plan.statedConstraints.some((c) => c.toLowerCase().includes("stripe"))).toBe(true);
    for (const constraint of plan.statedConstraints) {
      expect(constraint.length).toBeLessThanOrEqual(90);
    }
  });

  it("carries the goal through verbatim", () => {
    // Every downstream surface shows this as "what this run is for".
    const goal = "  Build me a booking app for my salon  ";
    expect(planForGoal(goal).goal).toBe("Build me a booking app for my salon");
  });
});

describe("the plan is runnable", () => {
  it("names a template the registry actually holds, for every intent", () => {
    /*
     * A plan naming an unregistered template would fail at launch with a key
     * nobody typed. Driving every intent through the real registry is cheaper
     * than discovering one is missing in production.
     */
    const goals = [
      "Build me a booking app",
      "Add a button",
      "Fix the broken checkout",
      "Audit our security",
      "Migrate the users table",
      "Refactor payments",
      "Investigate the outage",
    ];
    for (const goal of goals) {
      const plan = planForGoal(goal);
      expect(templateForPlan(plan), `${goal} → ${plan.templateKey}`).not.toBeNull();
    }
  });

  it("routes to full_lifecycle, which the keyword suggester never could", () => {
    // grep -c full_lifecycle lib/graph/suggest.ts is 0; this is the new path.
    expect(GRAPH_TEMPLATES.some((t) => t.key === "full_lifecycle")).toBe(true);
    expect(planForGoal("Build me a SaaS platform").templateKey).toBe("full_lifecycle");
  });
});

describe("statedConstraints on its own", () => {
  it("finds nothing in a bare sentence", () => {
    expect(statedConstraints("make me a thing")).toEqual([]);
  });

  it("is bounded, so a pasted essay cannot flood the plan", () => {
    const essay = Array.from({ length: 40 }, (_, i) => `must do thing ${i}`).join(". ");
    expect(statedConstraints(essay).length).toBeLessThanOrEqual(12);
  });
});
