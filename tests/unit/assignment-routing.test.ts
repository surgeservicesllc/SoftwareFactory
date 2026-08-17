import { describe, expect, it } from "vitest";

import {
  configFromPreset,
  LEAST_PRIVILEGE_CONFIG,
  normalizeAssignmentConfig,
  type AssignmentConfig,
} from "@/lib/bots/assignment-config";
import {
  dispatchWorkAcrossBots,
  routeWorkToAssignedBot,
  type RoutableAssignment,
} from "@/lib/bots/assignment-routing";

function assignment(
  name: string,
  config: AssignmentConfig,
  overrides: Partial<RoutableAssignment> = {},
): RoutableAssignment {
  return {
    assignmentId: `as-${name}`,
    botId: `bot-${name}`,
    botName: name,
    roleId: "role-1",
    status: "active",
    config,
    inFlight: 0,
    assignedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

const developer = assignment("Code Master", configFromPreset("developer"));
const reviewer = assignment("Reviewer", configFromPreset("reviewer"));
const security = assignment("Security Guardian", configFromPreset("security"));
const devops = assignment("DevOps Pro", configFromPreset("devops"));

describe("permission decides who may take the work", () => {
  it("routes a code change only to a bot that can write", () => {
    const result = routeWorkToAssignedBot({
      assignments: [reviewer, security, developer],
      work: { kind: "code_change" },
    });

    expect(result.selected?.botName).toBe("Code Master");
    // The reason has to name the missing permission: told only "unavailable",
    // an operator changes the wrong thing.
    expect(result.refused.map((entry) => entry.code)).toContain("REPOSITORY_WRITE_REQUIRED");
  });

  it("never lets priority outvote a missing permission", () => {
    // Security is P0 and would win any ordering; it still cannot write.
    const result = routeWorkToAssignedBot({
      assignments: [security, developer],
      work: { kind: "code_change" },
    });

    expect(security.config.priority).toBeLessThan(developer.config.priority);
    expect(result.selected?.botName).toBe("Code Master");
  });

  it("refuses a merge that no assigned bot may perform", () => {
    const result = routeWorkToAssignedBot({
      assignments: [developer, reviewer],
      work: { kind: "pull_request_merge" },
    });

    expect(result.selected).toBeNull();
    expect(result.refused.map((entry) => entry.code)).toContain("MERGE_PERMISSION_REQUIRED");
  });

  it("lets analysis go to a bot with no repository access at all", () => {
    const research = assignment("Researcher", configFromPreset("research"));
    const result = routeWorkToAssignedBot({
      assignments: [research],
      work: { kind: "analysis" },
    });

    expect(result.selected?.botName).toBe("Researcher");
  });

  it("keeps production work away from every bot that cannot reach it", () => {
    const result = routeWorkToAssignedBot({
      assignments: [developer, devops, security],
      work: { kind: "production_change" },
    });

    expect(result.selected).toBeNull();
    expect(result.refused.every((entry) => entry.code === "PRODUCTION_ACCESS_REQUIRED")).toBe(true);
  });

  describe("pipeline scope", () => {
    it("lets a bot with access to every pipeline run any of them", () => {
      const result = routeWorkToAssignedBot({
        assignments: [devops],
        work: { kind: "pipeline_run", pipelineId: "deploy" },
      });
      expect(result.selected?.botName).toBe("DevOps Pro");
    });

    it("holds an assigned-scope bot to its own pipelines", () => {
      const result = routeWorkToAssignedBot({
        assignments: [security],
        work: { kind: "pipeline_run", pipelineId: "deploy", assignedPipelineIds: ["scan"] },
      });

      expect(result.selected).toBeNull();
      expect(result.refused[0].code).toBe("PIPELINE_OUT_OF_SCOPE");
    });

    it("treats an empty assigned scope as nothing, never as everything", () => {
      // Failing open here would make the narrower setting the wider one.
      const result = routeWorkToAssignedBot({
        assignments: [security],
        work: { kind: "pipeline_run", pipelineId: "scan", assignedPipelineIds: [] },
      });

      expect(result.selected).toBeNull();
      expect(result.refused[0].code).toBe("PIPELINE_OUT_OF_SCOPE");
    });

    it("refuses a bot with no pipeline access before considering scope", () => {
      const writer = assignment("Docs", configFromPreset("documentation"));
      const result = routeWorkToAssignedBot({
        assignments: [writer],
        work: { kind: "pipeline_run", pipelineId: "scan" },
      });

      expect(result.refused[0].code).toBe("PIPELINE_ACCESS_REQUIRED");
    });
  });
});

describe("status and capacity", () => {
  it("routes nothing to a paused bot", () => {
    const paused = assignment("Code Master", configFromPreset("developer"), { status: "paused" });
    const result = routeWorkToAssignedBot({
      assignments: [paused],
      work: { kind: "code_change" },
    });

    expect(result.selected).toBeNull();
    expect(result.refused[0].code).toBe("ASSIGNMENT_PAUSED");
  });

  it("routes nothing to a released bot", () => {
    const gone = assignment("Code Master", configFromPreset("developer"), { status: "released" });
    const result = routeWorkToAssignedBot({
      assignments: [gone],
      work: { kind: "code_change" },
    });

    expect(result.refused[0].code).toBe("ASSIGNMENT_RELEASED");
  });

  it("refuses a bot that is already at its limit, naming the numbers", () => {
    const full = assignment("Code Master", configFromPreset("developer"), { inFlight: 3 });
    const result = routeWorkToAssignedBot({
      assignments: [full],
      work: { kind: "code_change" },
    });

    expect(result.selected).toBeNull();
    expect(result.refused[0].code).toBe("AT_CONCURRENCY_LIMIT");
    expect(result.refused[0].reason).toMatch(/3 of 3/);
  });

  it("prefers urgency over idleness", () => {
    // A busy P0 bot still outranks an idle P3 one, or idleness quietly becomes
    // the priority system.
    const urgent = assignment("Urgent", normalizeAssignmentConfig({
      repositoryAccess: "write", priority: 0, maxConcurrentTasks: 5,
    }), { inFlight: 4, assignmentId: "as-urgent" });
    const idle = assignment("Idle", normalizeAssignmentConfig({
      repositoryAccess: "write", priority: 3, maxConcurrentTasks: 5,
    }), { inFlight: 0, assignmentId: "as-idle" });

    const result = routeWorkToAssignedBot({
      assignments: [idle, urgent],
      work: { kind: "code_change" },
    });

    expect(result.selected?.botName).toBe("Urgent");
  });

  it("balances across equal priority by who is carrying least", () => {
    const busy = assignment("Busy", configFromPreset("developer"), {
      inFlight: 2, assignmentId: "as-busy",
    });
    const free = assignment("Free", configFromPreset("developer"), {
      inFlight: 0, assignmentId: "as-free",
    });

    const result = routeWorkToAssignedBot({
      assignments: [busy, free],
      work: { kind: "code_change" },
    });

    expect(result.selected?.botName).toBe("Free");
  });

  it("orders identically whatever order the assignments arrive in", () => {
    const first = routeWorkToAssignedBot({
      assignments: [developer, reviewer, security],
      work: { kind: "analysis" },
    });
    const second = routeWorkToAssignedBot({
      assignments: [security, developer, reviewer],
      work: { kind: "analysis" },
    });

    expect(first.eligible.map((entry) => entry.botName)).toEqual(
      second.eligible.map((entry) => entry.botName),
    );
  });
});

describe("two bots never take the same files", () => {
  it("refuses a bot whose paths another bot is holding", () => {
    const second = assignment("Second", configFromPreset("developer"), {
      assignmentId: "as-second",
    });

    const result = routeWorkToAssignedBot({
      assignments: [second],
      work: { kind: "code_change", paths: ["src/app.ts"] },
      heldPaths: [
        { path: "src/app.ts", assignmentId: "as-Code Master", botName: "Code Master" },
      ],
    });

    expect(result.selected).toBeNull();
    expect(result.refused[0].code).toBe("PATH_HELD_BY_ANOTHER_BOT");
    expect(result.refused[0].reason).toMatch(/Code Master is already working on src\/app\.ts/);
  });

  it("lets a bot continue on a path it is holding itself", () => {
    // Its own hold is its own work continuing, not a conflict.
    const result = routeWorkToAssignedBot({
      assignments: [developer],
      work: { kind: "code_change", paths: ["src/app.ts"] },
      heldPaths: [
        { path: "src/app.ts", assignmentId: developer.assignmentId, botName: "Code Master" },
      ],
    });

    expect(result.selected?.botName).toBe("Code Master");
  });

  it("does not block work on untouched files", () => {
    const result = routeWorkToAssignedBot({
      assignments: [developer],
      work: { kind: "code_change", paths: ["src/other.ts"] },
      heldPaths: [{ path: "src/app.ts", assignmentId: "as-other", botName: "Other" }],
    });

    expect(result.selected?.botName).toBe("Code Master");
  });
});

describe("approval travels with the decision", () => {
  it("reports that the chosen bot's work needs a person", () => {
    const result = routeWorkToAssignedBot({
      assignments: [developer],
      work: { kind: "code_change" },
    });

    expect(result.requiresApproval).toBe(true);
  });

  it("returns approval-gated work rather than filtering it out", () => {
    // A decision nobody can see cannot be approved.
    const result = routeWorkToAssignedBot({
      assignments: [developer],
      work: { kind: "code_change" },
    });

    expect(result.selected).not.toBeNull();
  });

  it("reports no approval for a bot configured without it", () => {
    const unattended = assignment("Unattended", normalizeAssignmentConfig({
      repositoryAccess: "write", requiresHumanApproval: false,
    }));

    expect(
      routeWorkToAssignedBot({ assignments: [unattended], work: { kind: "code_change" } })
        .requiresApproval,
    ).toBe(false);
  });
});

describe("an empty or unusable roster", () => {
  it("says the project has no bots rather than blaming the work", () => {
    const result = routeWorkToAssignedBot({ assignments: [], work: { kind: "analysis" } });

    expect(result.selected).toBeNull();
    expect(result.reason).toMatch(/no bots are assigned/i);
  });

  it("distinguishes a full roster from an unpermitted one", () => {
    const result = routeWorkToAssignedBot({
      assignments: [reviewer],
      work: { kind: "code_change" },
    });

    expect(result.reason).toMatch(/permitted and free/i);
  });

  it("routes nothing on a least-privilege assignment that cannot write", () => {
    const narrow = assignment("Narrow", LEAST_PRIVILEGE_CONFIG);
    expect(
      routeWorkToAssignedBot({ assignments: [narrow], work: { kind: "code_change" } }).selected,
    ).toBeNull();
  });
});

describe("dispatching a batch across several bots", () => {
  it("spreads work over the bots that can take it", () => {
    const result = dispatchWorkAcrossBots({
      assignments: [
        assignment("One", configFromPreset("developer"), { assignmentId: "as-1" }),
        assignment("Two", configFromPreset("developer"), { assignmentId: "as-2" }),
      ],
      work: [
        { workId: "w1", item: { kind: "code_change" } },
        { workId: "w2", item: { kind: "code_change" } },
      ],
    });

    expect(result.dispatched).toHaveLength(2);
    // Routing both against the state at the start of the batch would hand the
    // same slot to two bots. The tallies are threaded forward instead.
    expect(new Set(result.dispatched.map((entry) => entry.assignment.assignmentId)).size).toBe(2);
  });

  it("stops handing out slots a bot no longer has", () => {
    const single = assignment("Solo", normalizeAssignmentConfig({
      repositoryAccess: "write", maxConcurrentTasks: 1,
    }));

    const result = dispatchWorkAcrossBots({
      assignments: [single],
      work: [
        { workId: "w1", item: { kind: "code_change" } },
        { workId: "w2", item: { kind: "code_change" } },
      ],
    });

    expect(result.dispatched).toHaveLength(1);
    expect(result.deferred).toEqual([
      { workId: "w2", reason: expect.stringMatching(/permitted and free/i) },
    ]);
  });

  it("stops two bots in one batch taking the same file", () => {
    const result = dispatchWorkAcrossBots({
      assignments: [
        assignment("One", configFromPreset("developer"), { assignmentId: "as-1" }),
        assignment("Two", configFromPreset("developer"), { assignmentId: "as-2" }),
      ],
      work: [
        { workId: "w1", item: { kind: "code_change", paths: ["src/app.ts"] } },
        { workId: "w2", item: { kind: "code_change", paths: ["src/app.ts"] } },
      ],
    });

    // The second item is held by the first bot's fresh claim, not by anything
    // that existed when the batch began.
    expect(result.dispatched).toHaveLength(1);
    expect(result.deferred[0].workId).toBe("w2");
  });

  it("blocks a second item on the same file even for the bot that took the first", () => {
    // A batch claim is not a continuation: the bot has capacity for both, so
    // without this it would run two tasks in parallel against one file and
    // overwrite itself. Only an existing lease is its own work carrying on.
    const solo = assignment("Solo", configFromPreset("developer"), { assignmentId: "as-solo" });

    const result = dispatchWorkAcrossBots({
      assignments: [solo],
      work: [
        { workId: "w1", item: { kind: "code_change", paths: ["src/app.ts"] } },
        { workId: "w2", item: { kind: "code_change", paths: ["src/app.ts"] } },
      ],
    });

    expect(result.dispatched.map((entry) => entry.workId)).toEqual(["w1"]);
    expect(result.deferred[0].reason).toMatch(/just given src\/app\.ts in this batch/);
  });

  it("still dispatches work on files nobody has claimed", () => {
    const result = dispatchWorkAcrossBots({
      assignments: [assignment("One", configFromPreset("developer"), { assignmentId: "as-1" })],
      work: [
        { workId: "w1", item: { kind: "code_change", paths: ["a.ts"] } },
        { workId: "w2", item: { kind: "code_change", paths: ["b.ts"] } },
      ],
    });

    expect(result.dispatched.map((entry) => entry.workId)).toEqual(["w1", "w2"]);
  });

  it("carries each item's approval requirement into the dispatch", () => {
    const result = dispatchWorkAcrossBots({
      assignments: [developer],
      work: [{ workId: "w1", item: { kind: "code_change" } }],
    });

    expect(result.dispatched[0].requiresApproval).toBe(true);
  });

  it("defers rather than dropping work no bot can take", () => {
    const result = dispatchWorkAcrossBots({
      assignments: [reviewer],
      work: [{ workId: "w1", item: { kind: "code_change" } }],
    });

    expect(result.dispatched).toEqual([]);
    expect(result.deferred[0].workId).toBe("w1");
  });
});
