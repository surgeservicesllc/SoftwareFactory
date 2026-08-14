import { describe, expect, it } from "vitest";

import {
  selectAutopilotWork,
  type BacklogCandidate,
} from "@/lib/autonomy/autopilot";
import {
  AUTOMATIC_ACTIONS,
  resolveEffectiveControls,
  type AutonomyControls,
} from "@/lib/autonomy/controls";

const allOn: AutonomyControls = {
  autonomousMode: true,
  maximumAutonomousRisk: "YELLOW",
  actions: Object.fromEntries(AUTOMATIC_ACTIONS.map((a) => [a, true])) as AutonomyControls["actions"],
};

/** Controls with planning permitted, so selection itself can be exercised. */
const planningEnabled = resolveEffectiveControls(allOn, allOn, {
  killSwitchActive: false,
  emergencyStopActive: false,
  releaseFrozen: false,
  executorConnected: true,
});

const heldOff = resolveEffectiveControls(allOn, allOn, {
  killSwitchActive: true,
  emergencyStopActive: false,
  releaseFrozen: false,
  executorConnected: false,
});

function item(overrides: Partial<BacklogCandidate> & { id: string }): BacklogCandidate {
  return {
    title: `Work ${overrides.id}`,
    priority: "P2",
    risk: "GREEN",
    projectId: "project-1",
    ...overrides,
  };
}

describe("ordering", () => {
  it("takes higher priority first", () => {
    const selection = selectAutopilotWork({
      candidates: [
        item({ id: "c", priority: "P3" }),
        item({ id: "a", priority: "P0" }),
        item({ id: "b", priority: "P1" }),
      ],
      controls: planningEnabled,
    });

    expect(selection.queue.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(selection.next?.id).toBe("a");
  });

  it("takes the safer item first within a priority", () => {
    const selection = selectAutopilotWork({
      candidates: [
        item({ id: "risky", priority: "P1", risk: "YELLOW" }),
        item({ id: "safe", priority: "P1", risk: "GREEN" }),
      ],
      controls: planningEnabled,
    });

    expect(selection.queue.map((entry) => entry.id)).toEqual(["safe", "risky"]);
  });

  it("is deterministic when priority and risk tie", () => {
    const selection = selectAutopilotWork({
      candidates: [item({ id: "b" }), item({ id: "a" })],
      controls: planningEnabled,
    });

    expect(selection.queue.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("returns no next item for an empty backlog", () => {
    const selection = selectAutopilotWork({ candidates: [], controls: planningEnabled });

    expect(selection.next).toBeNull();
    expect(selection.heldByControls).toBe(false);
  });
});

describe("dependencies", () => {
  it("holds work whose dependency is unfinished", () => {
    const selection = selectAutopilotWork({
      candidates: [
        item({ id: "first" }),
        item({ id: "second", dependsOn: ["first"] }),
      ],
      controls: planningEnabled,
    });

    expect(selection.queue.map((entry) => entry.id)).toEqual(["first"]);
    expect(selection.excluded).toContainEqual(
      expect.objectContaining({ id: "second", reason: "UNMET_DEPENDENCY" }),
    );
  });

  it("releases work once its dependency is complete", () => {
    const selection = selectAutopilotWork({
      candidates: [
        item({ id: "first", completed: true }),
        item({ id: "second", dependsOn: ["first"] }),
      ],
      controls: planningEnabled,
    });

    expect(selection.queue.map((entry) => entry.id)).toEqual(["second"]);
  });

  it("refuses a dependency that is not in the backlog rather than assuming it is done", () => {
    const selection = selectAutopilotWork({
      candidates: [item({ id: "orphan", dependsOn: ["ghost"] })],
      controls: planningEnabled,
    });

    expect(selection.queue).toEqual([]);
    expect(selection.excluded[0]).toMatchObject({ id: "orphan", reason: "UNKNOWN_DEPENDENCY" });
  });

  it("holds a whole dependency chain behind its first unfinished link", () => {
    const selection = selectAutopilotWork({
      candidates: [
        item({ id: "a" }),
        item({ id: "b", dependsOn: ["a"] }),
        item({ id: "c", dependsOn: ["b"] }),
      ],
      controls: planningEnabled,
    });

    expect(selection.queue.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("exclusions", () => {
  it("skips completed and parked work, and says which is which", () => {
    const selection = selectAutopilotWork({
      candidates: [
        item({ id: "done", completed: true }),
        item({ id: "parked", blocked: true }),
        item({ id: "live" }),
      ],
      controls: planningEnabled,
    });

    expect(selection.queue.map((entry) => entry.id)).toEqual(["live"]);
    expect(selection.excluded).toContainEqual(
      expect.objectContaining({ id: "done", reason: "ALREADY_COMPLETE" }),
    );
    expect(selection.excluded).toContainEqual(
      expect.objectContaining({ id: "parked", reason: "MANUALLY_BLOCKED" }),
    );
  });

  it("refuses work above the risk ceiling", () => {
    const selection = selectAutopilotWork({
      candidates: [item({ id: "red", risk: "RED" })],
      controls: planningEnabled,
    });

    expect(selection.queue).toEqual([]);
    expect(selection.excluded[0].reason).toBe("ABOVE_RISK_CEILING");
  });

  it.each(["degraded", "critical", "paused"] as const)(
    "does not pick up new work while a project is %s",
    (health) => {
      const selection = selectAutopilotWork({
        candidates: [item({ id: "work", priority: "P0" })],
        controls: planningEnabled,
        projectHealth: { "project-1": health },
      });

      expect(selection.queue).toEqual([]);
      expect(selection.excluded[0].reason).toBe("PROJECT_UNHEALTHY");
    },
  );

  it("still picks up work when the project is healthy or merely unknown", () => {
    for (const health of ["healthy", "unknown"] as const) {
      const selection = selectAutopilotWork({
        candidates: [item({ id: "work" })],
        controls: planningEnabled,
        projectHealth: { "project-1": health },
      });
      expect(selection.queue).toHaveLength(1);
    }
  });

  it("only applies health to the project it belongs to", () => {
    const selection = selectAutopilotWork({
      candidates: [
        item({ id: "sick", projectId: "project-1" }),
        item({ id: "well", projectId: "project-2" }),
      ],
      controls: planningEnabled,
      projectHealth: { "project-1": "critical" },
    });

    expect(selection.queue.map((entry) => entry.id)).toEqual(["well"]);
  });

  it("gives every exclusion a readable detail", () => {
    const selection = selectAutopilotWork({
      candidates: [item({ id: "done", completed: true }), item({ id: "red", risk: "RED" })],
      controls: planningEnabled,
    });

    for (const entry of selection.excluded) {
      expect(entry.detail.length).toBeGreaterThan(0);
      expect(entry.detail).toMatch(/\.$/);
    }
  });
});

describe("the controls hold the whole backlog", () => {
  it("selects nothing while planning is not enabled", () => {
    const selection = selectAutopilotWork({
      candidates: [item({ id: "a", priority: "P0" }), item({ id: "b" })],
      controls: heldOff,
    });

    expect(selection.queue).toEqual([]);
    expect(selection.next).toBeNull();
    expect(selection.excluded.every((entry) => entry.reason === "PLANNING_NOT_ENABLED")).toBe(true);
  });

  it("distinguishes 'held off' from 'nothing eligible'", () => {
    const held = selectAutopilotWork({ candidates: [item({ id: "a" })], controls: heldOff });
    expect(held.heldByControls).toBe(true);

    // An empty queue for a different reason is not the controls holding it.
    const ineligible = selectAutopilotWork({
      candidates: [item({ id: "a", completed: true })],
      controls: planningEnabled,
    });
    expect(ineligible.heldByControls).toBe(false);
  });
});
