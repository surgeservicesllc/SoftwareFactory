import { describe, expect, it } from "vitest";

import {
  assignmentConfigFromRow,
  assignmentConfigSchema,
  configFromPreset,
  elevatedPermissions,
  hasElevatedPermissions,
  IncoherentAssignmentError,
  LEAST_PRIVILEGE_CONFIG,
  MAX_CONCURRENT_TASKS,
  normalizeAssignmentConfig,
  ROLE_PRESETS,
  toDatabaseConfiguration,
} from "@/lib/bots/assignment-config";

describe("an assignment nobody configured", () => {
  it("is the narrowest useful grant", () => {
    // Every widening below has to be something a person chose. If this ever
    // drifts, every bot in the product silently gains authority.
    expect(normalizeAssignmentConfig()).toMatchObject({
      repositoryAccess: "read",
      canOpenPullRequest: false,
      canMergePullRequest: false,
      pipelineAccess: "none",
      environmentAccess: "none",
      requiresHumanApproval: true,
      maxConcurrentTasks: 1,
      priority: 2,
    });
  });

  it("is not elevated, so the review step has nothing to warn about", () => {
    expect(hasElevatedPermissions(LEAST_PRIVILEGE_CONFIG)).toBe(false);
    expect(elevatedPermissions(LEAST_PRIVILEGE_CONFIG)).toEqual([]);
  });
});

describe("authority is nested", () => {
  it("refuses opening pull requests without repository write", () => {
    expect(() =>
      normalizeAssignmentConfig({ repositoryAccess: "read", canOpenPullRequest: true }),
    ).toThrow(IncoherentAssignmentError);
  });

  it("refuses merging without being able to open", () => {
    expect(() =>
      normalizeAssignmentConfig({
        repositoryAccess: "write",
        canOpenPullRequest: false,
        canMergePullRequest: true,
      }),
    ).toThrow(/open a pull request before it can merge/i);
  });

  it("refuses merge authority that waives approval, rather than quietly restoring it", () => {
    // Repairing this would store a grant nobody reviewed under a label they
    // did agree to, and leave no trace that it happened.
    expect(() =>
      normalizeAssignmentConfig({
        repositoryAccess: "write",
        canOpenPullRequest: true,
        canMergePullRequest: true,
        requiresHumanApproval: false,
      }),
    ).toThrow(/needs a person to approve/i);
  });

  it("refuses production access that waives approval", () => {
    expect(() =>
      normalizeAssignmentConfig({
        environmentAccess: "production",
        requiresHumanApproval: false,
      }),
    ).toThrow(/production access always needs a person/i);
  });

  it("accepts elevated authority that keeps its human", () => {
    const config = normalizeAssignmentConfig({
      repositoryAccess: "write",
      canOpenPullRequest: true,
      canMergePullRequest: true,
      requiresHumanApproval: true,
    });

    expect(config.canMergePullRequest).toBe(true);
    expect(elevatedPermissions(config)).toContain("Can merge pull requests, with approval");
  });
});

describe("the role presets", () => {
  it("offers the seven the owner named", () => {
    expect(ROLE_PRESETS.map((entry) => entry.id)).toEqual([
      "developer",
      "reviewer",
      "tester",
      "security",
      "devops",
      "research",
      "documentation",
    ]);
  });

  it("produces a coherent configuration for every one of them", () => {
    // A preset that cannot be normalized would fail at assignment time, in the
    // one path a person is most likely to take.
    for (const entry of ROLE_PRESETS) {
      expect(() => configFromPreset(entry.id)).not.toThrow();
      expect(configFromPreset(entry.id).preset).toBe(entry.id);
    }
  });

  it("gives write access only to the presets that actually build", () => {
    const writers = ROLE_PRESETS.filter((entry) => entry.config.repositoryAccess === "write");
    expect(writers.map((entry) => entry.id)).toEqual(["developer", "tester", "documentation"]);
  });

  it("keeps a reviewer unable to write and a researcher out of the repository", () => {
    // The labels are the promise; these are the grants behind them.
    expect(configFromPreset("reviewer")).toMatchObject({
      repositoryAccess: "read",
      canOpenPullRequest: false,
    });
    expect(configFromPreset("research").repositoryAccess).toBe("none");
  });

  it("never hands a preset autonomous merge or production authority", () => {
    for (const entry of ROLE_PRESETS) {
      const config = configFromPreset(entry.id);
      expect(config.canMergePullRequest).toBe(false);
      expect(config.environmentAccess).not.toBe("production");
      expect(config.requiresHumanApproval).toBe(true);
    }
  });

  it("refuses an unknown preset instead of falling back to something", () => {
    expect(() => configFromPreset("superuser")).toThrow(IncoherentAssignmentError);
  });
});

describe("the schema bounds", () => {
  it("rejects an unknown field rather than dropping it", () => {
    expect(assignmentConfigSchema.safeParse({ repositoryAccess: "admin" }).success).toBe(false);
    expect(assignmentConfigSchema.safeParse({ escalate: true }).success).toBe(false);
  });

  it("rejects concurrency and priority outside their ladders", () => {
    expect(
      assignmentConfigSchema.safeParse({ maxConcurrentTasks: MAX_CONCURRENT_TASKS + 1 }).success,
    ).toBe(false);
    expect(assignmentConfigSchema.safeParse({ priority: 4 }).success).toBe(false);
    expect(assignmentConfigSchema.safeParse({ priority: -1 }).success).toBe(false);
  });

  it("rejects an over-long instruction and an over-full responsibility list", () => {
    expect(assignmentConfigSchema.safeParse({ instructions: "x".repeat(4001) }).success).toBe(
      false,
    );
    expect(
      assignmentConfigSchema.safeParse({
        responsibilities: Array.from({ length: 13 }, (_, index) => `Duty ${index}`),
      }).success,
    ).toBe(false);
  });

  it("accepts a full, valid configuration", () => {
    const parsed = assignmentConfigSchema.safeParse({
      preset: "developer",
      responsibilities: ["Implement features"],
      instructions: "Prefer small pull requests.",
      repositoryAccess: "write",
      branchStrategy: "per_task_branch",
      canOpenPullRequest: true,
      canMergePullRequest: false,
      pipelineAccess: "all",
      environmentAccess: "preview",
      tools: ["github"],
      requiresHumanApproval: true,
      maxConcurrentTasks: 3,
      priority: 1,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("crossing into and back out of the database", () => {
  it("sends snake_case columns the migration recognizes", () => {
    const payload = toDatabaseConfiguration(configFromPreset("developer"));

    expect(payload).toMatchObject({
      preset: "developer",
      repository_access: "write",
      can_open_pull_request: true,
      requires_human_approval: true,
    });
    // A camelCase key would be ignored by the SQL normalizer and the grant
    // would silently fall back to the default — the failure that looks like
    // "the wizard did nothing".
    expect(Object.keys(payload).some((key) => /[A-Z]/.test(key))).toBe(false);
  });

  it("round-trips a configuration without changing it", () => {
    const original = configFromPreset("devops");
    expect(assignmentConfigFromRow(toDatabaseConfiguration(original))).toEqual(original);
  });

  it("reads a row written before the configuration columns as least privilege", () => {
    // An older assignment must not become more powerful by being displayed.
    expect(assignmentConfigFromRow({})).toMatchObject({
      repositoryAccess: "read",
      canOpenPullRequest: false,
      pipelineAccess: "none",
      environmentAccess: "none",
      requiresHumanApproval: true,
      maxConcurrentTasks: 1,
    });
  });

  it("treats an unreadable stored value as the narrow option, never the wide one", () => {
    const config = assignmentConfigFromRow({
      repository_access: "superuser",
      pipeline_access: "everything",
      environment_access: "prod",
      requires_human_approval: null,
      max_concurrent_tasks: 9999,
      priority: 99,
    });

    expect(config.repositoryAccess).toBe("read");
    expect(config.pipelineAccess).toBe("none");
    expect(config.environmentAccess).toBe("none");
    expect(config.requiresHumanApproval).toBe(true);
    expect(config.maxConcurrentTasks).toBe(MAX_CONCURRENT_TASKS);
    expect(config.priority).toBe(2);
  });

  it("drops non-string entries from a stored list rather than rendering them", () => {
    const config = assignmentConfigFromRow({ responsibilities: ["Real", 42, null] });
    expect(config.responsibilities).toEqual(["Real"]);
  });
});
