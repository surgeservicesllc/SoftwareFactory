import { describe, expect, it } from "vitest";

import {
  assignmentIsConfigured,
  assignmentPostingIsConfigured,
  LEAST_PRIVILEGE_CONFIG,
  normalizeAssignmentConfig,
} from "@/lib/bots/assignment-config";

/**
 * "Configured" has to be able to be false.
 *
 * The AI Factory's Configure Bot Settings step derived this from
 * `roleId || responsibilities.length`. `bot_assignments.role_id` is NOT NULL,
 * so the first half was true of every assignment that can exist, and the API
 * nests `responsibilities` under `config`, so the second half read `undefined`.
 * The step was marked done the instant a bot was assigned.
 */
describe("whether a posting has actually been configured", () => {
  it("is false for the posting the database creates with no settings", () => {
    expect(assignmentIsConfigured(LEAST_PRIVILEGE_CONFIG)).toBe(false);
    expect(assignmentIsConfigured(normalizeAssignmentConfig({}))).toBe(false);
  });

  it("is true for each thing a person can choose, one at a time", () => {
    const choices = [
      { preset: "reviewer" },
      { responsibilities: ["Review migrations"] },
      { instructions: "Read the diff first." },
      { tools: ["read_repository"] },
      { repositoryAccess: "none" as const },
      { branchStrategy: "shared_project_branch" as const },
      { pipelineAccess: "assigned" as const },
      { maxConcurrentTasks: 3 },
      { priority: 0 },
    ];
    for (const choice of choices) {
      expect(
        assignmentIsConfigured({ ...LEAST_PRIVILEGE_CONFIG, ...choice }),
        `${JSON.stringify(choice)} should count as configured`,
      ).toBe(true);
    }
  });

  it("does not count whitespace as an instruction", () => {
    expect(assignmentIsConfigured({ ...LEAST_PRIVILEGE_CONFIG, instructions: "   " })).toBe(false);
  });

  it("counts a widened grant, since that is the choice most worth surfacing", () => {
    // canOpenPullRequest requires repository write, so the coherent shape is
    // the one the normalizer produces rather than a hand-set flag.
    const widened = normalizeAssignmentConfig({ repositoryAccess: "write", canOpenPullRequest: true });
    expect(assignmentIsConfigured(widened)).toBe(true);
  });

  it("counts model and work-effort choices stored beside the config", () => {
    expect(assignmentPostingIsConfigured({
      config: LEAST_PRIVILEGE_CONFIG,
      model: "gpt-5.4",
      workEffort: "medium",
    })).toBe(true);
    expect(assignmentPostingIsConfigured({
      config: LEAST_PRIVILEGE_CONFIG,
      model: null,
      workEffort: "high",
    })).toBe(true);
    expect(assignmentPostingIsConfigured({
      config: LEAST_PRIVILEGE_CONFIG,
      model: null,
      workEffort: "medium",
    })).toBe(false);
  });
});
