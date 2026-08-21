import { describe, expect, it } from "vitest";

import {
  buildFactoryBriefing,
  type BriefingInput,
  type BriefingTask,
} from "@/lib/dashboard/factory-briefing";

function task(id: string, status: string, overrides: Partial<BriefingTask> = {}): BriefingTask {
  return {
    id,
    title: `Task ${id}`,
    status,
    risk: "green",
    requiresOwnerApproval: false,
    priority: 50,
    createdAt: "2026-08-20T12:00:00Z",
    dependencyCount: 0,
    project: { id: "project-1", name: "Atlas" },
    agent: null,
    command: null,
    latestRun: null,
    pullRequest: null,
    ...overrides,
  };
}

function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    tasks: [],
    runs: [],
    graphRuns: [],
    inboxMessages: [],
    incidents: [],
    connections: [],
    agents: [],
    worker: null,
    ...overrides,
  };
}

function keys(briefing: ReturnType<typeof buildFactoryBriefing>) {
  return {
    needs: briefing.needsYou.items.map((item) => item.key),
    underway: briefing.underway.items.map((item) => item.key),
    finished: briefing.recentlyFinished.items.map((item) => item.key),
    next: briefing.upNext.items.map((item) => item.key),
  };
}

describe("buildFactoryBriefing", () => {
  it("uses non-sensitive fallback labels when briefing projections omit prompt-derived task titles", () => {
    const briefing = buildFactoryBriefing(input({
      tasks: [task("private-title", "queued", { title: undefined })],
      runs: [{
        id: "standalone-private-title",
        status: "failed",
        startedAt: "2026-08-21T12:00:00Z",
        completedAt: "2026-08-21T12:01:00Z",
        createdAt: "2026-08-21T12:00:00Z",
        project: null,
        task: { id: "unlinked-task" },
        agent: null,
      }],
    }));

    expect(briefing.upNext.items[0]?.title).toBe("Work item");
    expect(briefing.needsYou.items[0]?.title).toBe("Recorded run");
  });

  it("places every represented record in one lane and folds a linked run into its task", () => {
    const briefing = buildFactoryBriefing(input({
      tasks: [
        task("approval", "awaiting_approval", {
          command: { id: "command-linked" },
          latestRun: { id: "run-linked", status: "queued" },
          requiresOwnerApproval: true,
          risk: "red",
        }),
        task("active", "in_progress", { agent: { id: "agent-1", name: "Frontend" } }),
        task("done", "completed", { pullRequest: { number: 42, url: "https://github.com/acme/atlas/pull/42" } }),
        task("queued", "queued"),
        task("blocked", "blocked", {
          dependencyCount: 2,
          requiresOwnerApproval: true,
          risk: "red",
        }),
        task("failed", "failed", { requiresOwnerApproval: true, risk: "red" }),
        task("cancelled", "cancelled"),
      ],
      runs: [
        {
          id: "run-linked", status: "queued", startedAt: null, completedAt: null,
          createdAt: "2026-08-20T12:00:00Z", project: null,
          task: { id: "approval", title: "Task approval" }, agent: null,
        },
        {
          id: "run-standalone", status: "succeeded", startedAt: "2026-08-20T12:00:00Z",
          completedAt: "2026-08-20T12:05:00Z", createdAt: "2026-08-20T12:00:00Z",
          project: null, task: null, agent: null,
        },
        {
          id: "run-cancelled", status: "cancelled", startedAt: null, completedAt: null,
          createdAt: "2026-08-20T12:00:00Z", project: null, task: null, agent: null,
        },
      ],
      graphRuns: [
        { graphRunId: "planned", goal: "Plan", topology: "MAP_REDUCE", state: "PLANNED", startedAt: null, completedAt: null },
        { graphRunId: "running", goal: "Run", topology: "PARALLEL", state: "RUNNING", startedAt: "2026-08-20T12:00:00Z", completedAt: null },
        { graphRunId: "complete", goal: "Done", topology: "PARALLEL", state: "COMPLETED", startedAt: "2026-08-20T12:00:00Z", completedAt: "2026-08-20T12:04:00Z" },
        { graphRunId: "partial", goal: "Partial", topology: "PARALLEL", state: "PARTIAL", startedAt: "2026-08-20T12:00:00Z", completedAt: "2026-08-20T12:03:00Z" },
        { graphRunId: "cancelled", goal: "Cancelled", topology: "PARALLEL", state: "CANCELLED", startedAt: null, completedAt: null },
      ],
      inboxMessages: [
        { id: "open", status: "open", kind: "multiple_choice", agentName: "Architect", createdAt: "2026-08-20T12:00:00Z" },
        { id: "answered", status: "answered", kind: "text", agentName: "QA", createdAt: "2026-08-20T12:00:00Z" },
      ],
      incidents: [
        { id: "incident-open", title: "Checkout outage", projectName: "Store", severity: "sev1", status: "open", impact: "Customers cannot pay.", resolvedAt: null, ownerAttentionRequired: true },
        { id: "incident-resolved", title: "Old issue", projectName: "Store", severity: "sev2", status: "resolved", impact: null, resolvedAt: "2026-08-20T10:00:00Z", ownerAttentionRequired: true },
      ],
      connections: [
        { id: "connection-error", name: "Acme", status: "error", statusReason: "Installation suspended." },
        { id: "connection-ok", name: "Good", status: "connected", statusReason: null },
      ],
    }), { sectionLimit: 20 });

    const lanes = keys(briefing);
    expect(lanes.needs).toEqual(expect.arrayContaining([
      "task:approval", "task:failed", "graph:partial", "inbox:open",
      "incident:incident-open", "connection:connection-error",
    ]));
    expect(briefing.needsYou.items.find((item) => item.key === "task:failed"))
      .toMatchObject({ label: "Failed", actionLabel: "Inspect run" });
    expect(briefing.upNext.items.find((item) => item.key === "task:blocked"))
      .toMatchObject({ label: "Gated", actionLabel: "Open backlog" });
    expect(briefing.needsYou.items.find((item) => item.key === "task:approval"))
      .toMatchObject({ label: "Decision", actionLabel: "Review request" });
    expect(lanes.underway).toEqual(expect.arrayContaining(["task:active", "graph:running"]));
    expect(lanes.finished).toEqual(expect.arrayContaining(["task:done", "run:run-standalone", "graph:complete"]));
    expect(lanes.next).toEqual(expect.arrayContaining(["task:queued", "task:blocked", "graph:planned"]));

    const all = [...lanes.needs, ...lanes.underway, ...lanes.finished, ...lanes.next];
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("run:run-linked");
    expect(all).not.toContain("inbox:answered");
    expect(all).not.toContain("incident:incident-resolved");
    expect(briefing.omittedCancelled).toBe(3);
  });

  it("keeps a linked latest-run failure visible through a non-terminal task", () => {
    const briefing = buildFactoryBriefing(input({
      tasks: [task("advisory", "backlog", {
        latestRun: { id: "advisory-run", status: "failed" },
      })],
      runs: [{
        id: "advisory-run",
        status: "failed",
        startedAt: "2026-08-21T12:00:00Z",
        completedAt: "2026-08-21T12:01:00Z",
        createdAt: "2026-08-21T12:00:00Z",
        project: { id: "project-1", name: "Atlas" },
        task: { id: "advisory", title: "Task advisory" },
        agent: null,
      }],
    }));

    expect(briefing.needsYou.items).toEqual([
      expect.objectContaining({
        key: "task:advisory",
        label: "Run failed",
        occurredAt: "2026-08-21T12:01:00Z",
      }),
    ]);
    expect(briefing.upNext.items).toHaveLength(0);
    expect(briefing.needsYou.items.map((item) => item.key)).not.toContain("run:advisory-run");
  });

  it("sorts finished work by completion recency and never substitutes task creation time", () => {
    const briefing = buildFactoryBriefing(input({
      tasks: [
        task("old-high", "completed", {
          priority: 100,
          createdAt: "2026-08-21T11:00:00Z",
          latestRun: { id: "old-run", status: "succeeded" },
        }),
        task("new-low", "completed", {
          priority: 1,
          createdAt: "2026-08-01T11:00:00Z",
          latestRun: { id: "new-run", status: "succeeded" },
        }),
        task("no-evidence", "completed", {
          priority: 50,
          createdAt: "2026-08-21T13:00:00Z",
        }),
      ],
      runs: [
        {
          id: "old-run", status: "succeeded", startedAt: "2026-08-20T10:00:00Z",
          completedAt: "2026-08-20T10:05:00Z", createdAt: "2026-08-20T10:00:00Z",
          project: null, task: { id: "old-high", title: "Task old-high" }, agent: null,
        },
        {
          id: "new-run", status: "succeeded", startedAt: "2026-08-21T10:00:00Z",
          completedAt: "2026-08-21T10:05:00Z", createdAt: "2026-08-21T10:00:00Z",
          project: null, task: { id: "new-low", title: "Task new-low" }, agent: null,
        },
      ],
    }), { sectionLimit: 20 });

    expect(briefing.recentlyFinished.items.map((item) => item.key)).toEqual([
      "task:new-low",
      "task:old-high",
      "task:no-evidence",
    ]);
    expect(briefing.recentlyFinished.items.find((item) => item.key === "task:no-evidence")?.occurredAt)
      .toBeNull();
  });

  it("keeps WARN graph verification evidence finished while BLOCK, REJECT, and unknown verdicts fail visibly", () => {
    const briefing = buildFactoryBriefing(input({
      graphRuns: [
        {
          graphRunId: "blocked", goal: "Security review", topology: "PARALLEL",
          state: "COMPLETED", startedAt: "2026-08-21T10:00:00Z",
          completedAt: "2026-08-21T10:05:00Z", verifications: [{ verdict: "BLOCK" }],
        },
        {
          graphRunId: "rejected", goal: "Quality review", topology: "PARALLEL",
          state: "COMPLETED", startedAt: "2026-08-21T11:00:00Z",
          completedAt: "2026-08-21T11:05:00Z", verifications: [{ verdict: "REJECT" }],
        },
        {
          graphRunId: "passed", goal: "Passed review", topology: "PARALLEL",
          state: "COMPLETED", startedAt: "2026-08-21T12:00:00Z",
          completedAt: "2026-08-21T12:05:00Z", verifications: [{ verdict: "PASS" }],
        },
        {
          graphRunId: "warned", goal: "Review with a warning", topology: "PARALLEL",
          state: "COMPLETED", startedAt: "2026-08-21T13:00:00Z",
          completedAt: "2026-08-21T13:05:00Z", verifications: [{ verdict: "WARN" }],
        },
        {
          graphRunId: "unknown-verdict", goal: "Review with an unknown verdict", topology: "PARALLEL",
          state: "COMPLETED", startedAt: "2026-08-21T14:00:00Z",
          completedAt: "2026-08-21T14:05:00Z", verifications: [{ verdict: "MAYBE" }],
        },
      ],
    }), { sectionLimit: 20 });

    expect(briefing.needsYou.items.map((item) => item.key)).toEqual(expect.arrayContaining([
      "graph:blocked",
      "graph:rejected",
      "graph:unknown-verdict",
    ]));
    expect(briefing.needsYou.items.map((item) => item.key)).not.toContain("graph:warned");
    expect(briefing.needsYou.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "graph:blocked", label: "Verification finding" }),
      expect.objectContaining({ key: "graph:rejected", label: "Verification finding" }),
    ]));
    expect(briefing.recentlyFinished.items.map((item) => item.key)).toEqual([
      "graph:warned",
      "graph:passed",
    ]);
  });

  it("sorts deterministically, caps each lane, and discloses the full total", () => {
    const briefing = buildFactoryBriefing(input({
      tasks: [
        task("low", "queued", { priority: 10, createdAt: "2026-08-21T12:00:00Z" }),
        task("high-old", "queued", { priority: 90, createdAt: "2026-08-20T12:00:00Z" }),
        task("high-new", "queued", { priority: 90, createdAt: "2026-08-21T12:00:00Z" }),
      ],
    }), { sectionLimit: 2 });

    expect(briefing.upNext.total).toBe(3);
    expect(briefing.upNext.items.map((item) => item.key)).toEqual(["task:high-new", "task:high-old"]);
  });

  it("shows the logical coordinator and raises a stale worker only when work is waiting", () => {
    const worker = {
      connectionStatus: "stale" as const,
      statusLabel: "Worker Stale",
      lastHeartbeatAt: "2026-08-21T12:00:00Z",
      activeWorkers: 0,
      availableWorkers: 0,
      staleAfterSeconds: 90,
    };
    const briefing = buildFactoryBriefing(input({
      tasks: [task("queued", "queued")],
      agents: [
        { id: "lead", name: "Orchestrator", role: "orchestrator", status: "busy" },
        { id: "qa", name: "QA", role: "qa", status: "idle" },
      ],
      worker,
    }), { sectionLimit: 10 });

    expect(briefing.crew).toMatchObject({
      liaison: { id: "lead", name: "Orchestrator" },
      activeAgents: 1,
      totalAgents: 2,
      worker,
    });
    expect(briefing.needsYou.items.map((item) => item.key)).toContain("worker:waiting-work");
    const queuedWorkerAlert = briefing.needsYou.items.find((item) => item.key === "worker:waiting-work");
    expect(`${queuedWorkerAlert?.title} ${queuedWorkerAlert?.detail}`).not.toMatch(/\bsafely\b/i);

    for (const connectionStatus of ["stale", "not_connected"] as const) {
      const active = buildFactoryBriefing(input({
        tasks: [task(`active-${connectionStatus}`, "in_progress")],
        worker: {
          ...worker,
          connectionStatus,
          statusLabel: connectionStatus === "stale" ? "Worker Stale" : "Worker Not Connected",
          lastHeartbeatAt: connectionStatus === "stale" ? worker.lastHeartbeatAt : null,
        },
      }), { sectionLimit: 10 });
      const activeWorkerAlert = active.needsYou.items.find((item) => item.key === "worker:waiting-work");
      expect(activeWorkerAlert).toBeDefined();
      const activeCopy = `${activeWorkerAlert?.title} ${activeWorkerAlert?.detail}`;
      expect(activeCopy).toMatch(/Phase 1C/i);
      expect(activeCopy).not.toMatch(/queued work stays|active work (?:is|remains) queued/i);
      expect(activeCopy).not.toMatch(/\bsafely\b/i);
      expect(activeCopy).toMatch(/active|running|in progress|recorded work/i);
    }

    const idle = buildFactoryBriefing(input({ worker }), { sectionLimit: 10 });
    expect(idle.needsYou.items).toHaveLength(0);

    const graphOnly = buildFactoryBriefing(input({
      graphRuns: [{
        graphRunId: "planned", goal: "Graph-only work", topology: "PARALLEL",
        state: "PLANNED", startedAt: null, completedAt: null,
      }],
      worker,
    }), { sectionLimit: 10 });
    expect(graphOnly.needsYou.items.map((item) => item.key)).not.toContain("worker:waiting-work");
    expect(graphOnly.upNext.items.map((item) => item.key)).toContain("graph:planned");
  });

  it("fails unknown lifecycle values into an inspectable lane instead of treating them as clear", () => {
    const briefing = buildFactoryBriefing(input({ tasks: [task("future", "teleported")] }));
    expect(briefing.needsYou.items[0]).toMatchObject({
      key: "task:future",
      label: "Unknown state",
    });
  });
});
